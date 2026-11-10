import { createFileRoute } from "@tanstack/react-router";

const CODINGFLEET_TOOLS = "https://www.codingfleet.com/api/tools";
const GITHUB_API = "https://api.github.com";
const MAX_TOOLS = 20;
const WRITE_TOOLS = new Set(["github_create_issue", "github_update_issue"]);

function allowedRepositories(): Set<string> {
  const configured = process.env.GITHUB_ALLOWED_REPOS?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return new Set(configured?.length ? configured : ["appleid7899067-netizen/bosses"]);
}

function assertRepositoryAllowed(owner: string, repo: string) {
  const fullName = owner + "/" + repo;
  if (!allowedRepositories().has(fullName.toLowerCase())) throw new Error("GitHub repository is not allowlisted.");
}

function isMcpAuthorized(request: Request): boolean {
  const configured = process.env.MCP_SHARED_SECRET;
  const supplied = request.headers.get("x-mcp-secret");
  return Boolean(configured && supplied && supplied === configured);
}

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  endpoint?: string;
  slug?: string;
};

function nativeTools(): Tool[] {
  return [
    {
      name: "github_get_repo",
      description: "Read public GitHub repository metadata.",
      inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"], additionalProperties: false },
    },
    {
      name: "github_get_file",
      description: "Read a file from a public GitHub repository.",
      inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } }, required: ["owner", "repo", "path"], additionalProperties: false },
    },
    {
      name: "github_list_commits",
      description: "Read recent commits from a public GitHub repository.",
      inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, per_page: { type: "integer", minimum: 1, maximum: 20 } }, required: ["owner", "repo"], additionalProperties: false },
    },
    {
      name: "github_list_issues",
      description: "Read issues from a public GitHub repository, including issue metadata and state.",
      inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, state: { type: "string", enum: ["open", "closed", "all"] }, per_page: { type: "integer", minimum: 1, maximum: 30 }, page: { type: "integer", minimum: 1 } }, required: ["owner", "repo"], additionalProperties: false },
    },
    {
      name: "github_list_pull_requests",
      description: "Read pull requests from a public GitHub repository, including review and merge metadata.",
      inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, state: { type: "string", enum: ["open", "closed", "all"] }, per_page: { type: "integer", minimum: 1, maximum: 30 }, page: { type: "integer", minimum: 1 } }, required: ["owner", "repo"], additionalProperties: false },
    },
    {
      name: "github_create_issue",
      description: "Create an issue in a GitHub repository using the configured server token.",
      inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, title: { type: "string", minLength: 1, maxLength: 256 }, body: { type: "string" }, labels: { type: "array", items: { type: "string" }, maxItems: 20 }, assignees: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["owner", "repo", "title"], additionalProperties: false },
    },
    {
      name: "github_update_issue",
      description: "Update an existing GitHub issue using the configured server token.",
      inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, issue_number: { type: "integer", minimum: 1 }, title: { type: "string", minLength: 1, maxLength: 256 }, body: { type: "string" }, state: { type: "string", enum: ["open", "closed"] }, state_reason: { type: "string", enum: ["completed", "reopened", "not_planned", "duplicate"] }, labels: { type: "array", items: { type: "string" }, maxItems: 20 }, assignees: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["owner", "repo", "issue_number"], additionalProperties: false },
    },
  ];
}

async function codingFleetTools(): Promise<Tool[]> {
  try {
    const response = await fetch(CODINGFLEET_TOOLS, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const data = await response.json() as unknown;
    const raw = Array.isArray(data) ? data : data && typeof data === "object" ? ((data as Record<string, unknown>).tools ?? (data as Record<string, unknown>).data ?? []) : [];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const name = String(item.name ?? item.slug ?? item.id ?? "").trim();
      if (!name) return [];
      const schema = item.input_schema ?? item.inputSchema ?? item.parameters;
      const inputSchema = schema && typeof schema === "object" && !Array.isArray(schema) ? schema as Record<string, unknown> : { type: "object", properties: {} };
      const endpoint = typeof item.endpoint === "string" ? item.endpoint : typeof item.url === "string" ? item.url : undefined;
      return [{ name, description: String(item.description ?? `Tool: ${name}`), inputSchema, endpoint, slug: typeof item.slug === "string" ? item.slug : name }];
    });
  } catch {
    return [];
  }
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

async function githubCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const owner = String(args.owner ?? "").trim();
  const repo = String(args.repo ?? "").trim();
  if (!owner || !repo) throw new Error("GitHub requires owner and repo.");
  assertRepositoryAllowed(owner, repo);
  const isWrite = WRITE_TOOLS.has(name);
  if (isWrite && process.env.MCP_WRITE_ENABLED !== "true") throw new Error("GitHub write tools are disabled.");
  let path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let method = "GET";
  let requestBody: Record<string, unknown> | undefined;
  if (name === "github_get_file") {
    const file = String(args.path ?? "").replace(/^\/+/, "");
    if (!file) throw new Error("GitHub file path is required.");
    path += `/contents/${file.split("/").map(encodeURIComponent).join("/")}`;
    if (args.ref) path += `?ref=${encodeURIComponent(String(args.ref))}`;
  } else if (name === "github_list_commits") {
    const perPage = boundedNumber(args.per_page, 10, 1, 20);
    path += `/commits?per_page=${perPage}`;
  } else if (name === "github_list_issues" || name === "github_list_pull_requests") {
    const state = String(args.state ?? "open");
    if (!["open", "closed", "all"].includes(state)) throw new Error("GitHub state must be open, closed, or all.");
    const perPage = boundedNumber(args.per_page, 20, 1, 30);
    const page = boundedNumber(args.page, 1, 1, 1000);
    const resource = name === "github_list_issues" ? "issues" : "pulls";
    path += `/${resource}?state=${encodeURIComponent(state)}&per_page=${perPage}&page=${page}`;
  } else if (name === "github_create_issue") {
    const title = String(args.title ?? "").trim();
    if (!title) throw new Error("GitHub issue title is required.");
    method = "POST";
    path += "/issues";
    requestBody = { title, ...(typeof args.body === "string" ? { body: args.body } : {}), ...(Array.isArray(args.labels) ? { labels: args.labels } : {}), ...(Array.isArray(args.assignees) ? { assignees: args.assignees } : {}) };
  } else if (name === "github_update_issue") {
    const issueNumber = boundedNumber(args.issue_number, 0, 1, 2147483647);
    if (!issueNumber) throw new Error("GitHub issue_number must be a positive integer.");
    const update: Record<string, unknown> = {};
    if (typeof args.title === "string") update.title = args.title.trim();
    if (typeof args.body === "string") update.body = args.body;
    if (typeof args.state === "string") update.state = args.state;
    if (typeof args.state_reason === "string") update.state_reason = args.state_reason;
    if (Array.isArray(args.labels)) update.labels = args.labels;
    if (Array.isArray(args.assignees)) update.assignees = args.assignees;
    if (!Object.keys(update).length) throw new Error("At least one issue field is required to update.");
    method = "PATCH";
    path += `/issues/${issueNumber}`;
    requestBody = update;
  }
  const token = process.env.GITHUB_TOKEN;
  if (isWrite && !token) throw new Error("GitHub write tools require the GITHUB_TOKEN server environment variable.");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
  if (isWrite && token) headers.Authorization = `Bearer ${token}`;
  if (requestBody) headers["Content-Type"] = "application/json";
  const response = await fetch(`${GITHUB_API}${path}`, { method, headers, body: requestBody ? JSON.stringify(requestBody) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function codingFleetCall(tool: Tool, args: Record<string, unknown>): Promise<unknown> {
  if (!tool.endpoint) throw new Error(`Tool ${tool.name} has no callable endpoint.`);
  const endpoint = new URL(tool.endpoint, CODINGFLEET_TOOLS).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ tool: tool.slug ?? tool.name, arguments: args }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${tool.name} HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "GET") {
    return Response.json({ ok: true, name: "Bossnu-CodingFleet MCP", version: "1.0.0", protocol: "MCP", endpoint: "/api/mcp" });
  }
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ jsonrpc: "2.0", error: { code: -32700, message: "Invalid JSON" } }, { status: 400 }); }
  const id = body.id ?? null;
  const method = String(body.method ?? "");

  try {
    if (method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Bossnu-CodingFleet", version: "1.0.0" } } });
    }
    if (method === "notifications/initialized") return new Response(null, { status: 202 });

    const tools = [...nativeTools(), ...(await codingFleetTools())].slice(0, MAX_TOOLS);
    if (method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id, result: { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) } });
    }
    if (method === "tools/call") {
      if (!isMcpAuthorized(request)) return Response.json({ jsonrpc: "2.0", id, error: { code: -32001, message: "MCP authentication is required." } }, { status: 401 });
      const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : {};
      const name = String(params.name ?? "");
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } }, { status: 400 });
      const result = name.startsWith("github_") ? await githubCall(name, args) : await codingFleetCall(tool, args);
      return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }], structuredContent: result } });
    }
    return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }, { status: 404 });
  } catch (error) {
    return Response.json({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/mcp")({
  server: { handlers: { GET: ({ request }) => handleMcp(request), POST: ({ request }) => handleMcp(request) } },
});
