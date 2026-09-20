import { ensurePuter, extractText } from "@/lib/puter";
import { runInSandbox } from "@/lib/sandbox";
import { executeAuthenticatedGitHubTool } from "@/lib/github-tool-bridge";

export type CodingFleetTool = {
  name?: string;
  id?: string;
  slug?: string;
  description?: string;
  input_schema?: unknown;
  inputSchema?: unknown;
  parameters?: unknown;
  endpoint?: unknown;
  url?: unknown;
  method?: unknown;
  mcpServer?: string;
  mcpToolName?: string;
  pluginSource?: string;
  pluginName?: string;
  githubSource?: boolean;
  [key: string]: unknown;
};

type ToolCall = { id?: string; name: string; arguments: Record<string, unknown> };
type PuterFunctionTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

const TOOLS_URL = "https://www.codingfleet.com/api/tools";
const PLUGINS_URL = "https://bosses690.vercel.app/plugins";
const GITHUB_API = "https://api.github.com";
const PUBLIC_MCP_SERVERS = ["https://api.keenable.ai/mcp"] as const;
const TOOL_LIMIT = 20;
const MAX_TOOL_ROUNDS = 12;
const DEFAULT_MODELS = ["gpt-5.6-luna", "claude-sonnet-4-6", "gemini-3.1-flash-lite"] as const;
const CODINGFLEET_BASE = "https://www.codingfleet.com/api";
let cachedTools: CodingFleetTool[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeTools(value: unknown): CodingFleetTool[] {
  const raw = Array.isArray(value) ? value : value && typeof value === "object"
    ? ((value as Record<string, unknown>).tools ?? (value as Record<string, unknown>).data ?? []) : [];
  return Array.isArray(raw) ? raw.filter((tool): tool is CodingFleetTool => !!tool && typeof tool === "object").slice(0, TOOL_LIMIT) : [];
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function toolName(tool: CodingFleetTool) { return String(tool.name ?? tool.slug ?? tool.id ?? "").trim(); }
function toolParameters(tool: CodingFleetTool): Record<string, unknown> {
  const value = tool.input_schema ?? tool.inputSchema ?? tool.parameters;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { type: "object", properties: {} };
}

function normalizePluginEntries(value: unknown): CodingFleetTool[] {
  const raw = Array.isArray(value) ? value : value && typeof value === "object"
    ? ((value as Record<string, unknown>).plugins ?? (value as Record<string, unknown>).data ?? []) : [];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const plugin = entry as Record<string, unknown>;
    const name = String(plugin.name ?? plugin.slug ?? plugin.id ?? "").trim();
    const endpoint = plugin.endpoint ?? plugin.api ?? plugin.invokeUrl ?? plugin.url;
    if (!name || typeof endpoint !== "string" || !endpoint.trim()) return [];
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    return [{ name: `plugin_${safeName}`, description: String(plugin.description ?? `Plugin: ${name}`), inputSchema: plugin.input_schema ?? plugin.inputSchema ?? plugin.parameters ?? { type: "object", properties: {} }, endpoint, method: plugin.method, pluginSource: PLUGINS_URL, pluginName: name }];
  });
}

async function loadPluginTools(): Promise<CodingFleetTool[]> {
  const response = await fetch(PLUGINS_URL, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Plugin catalog unavailable: HTTP ${response.status}`);
  return normalizePluginEntries(await response.json());
}

function nativeSandboxTools(): CodingFleetTool[] {
  return [{
    name: "sandbox_run",
    description: "Run code in the trusted HTTPS sandbox and return stdout, stderr, exit code, duration, and success. Use this to reproduce errors and verify fixes.",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string", minLength: 1, maxLength: 40 },
        code: { type: "string", maxLength: 500000 },
        timeoutMs: { type: "integer", minimum: 100, maximum: 120000 }
      },
      required: ["language", "code"],
      additionalProperties: false
    },
    githubSource: false
  }];
}


function nativeWebTools(): CodingFleetTool[] {
  return [{
    name: "web_check",
    description: "Check a deployed website URL over HTTPS. Return final URL, HTTP status, response time, redirect chain, content type, and a short body preview. Use this after deployment or when diagnosing 500/502/503/timeout issues.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 8, maxLength: 2048 },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 30000 }
      },
      required: ["url"],
      additionalProperties: false
    }
  }];
}

async function executeWebCheck(args: Record<string, unknown>): Promise<unknown> {
  const rawUrl = String(args.url ?? "").trim();
  if (!/^https:\/\//i.test(rawUrl)) throw new Error("web_check only accepts HTTPS URLs.");
  let target: URL;
  try { target = new URL(rawUrl); } catch { throw new Error("web_check received an invalid URL."); }
  if (target.username || target.password) throw new Error("web_check does not allow URL credentials.");
  const hostname = target.hostname.toLowerCase().replace(/\\.$/, "");
  const blockedHostnames = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "metadata.google.internal"]);
  const isPrivateIpv4 = (host: string) => {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  };
  const isPrivateIpv6 = (host: string) => host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
  if (blockedHostnames.has(hostname) || hostname.endsWith(".local") || isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new Error("web_check blocked a private, local, or metadata host.");
  }
  const timeoutMs = Math.min(30000, Math.max(1000, Number(args.timeoutMs ?? 15000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1", "User-Agent": "Bossnu-WebCheck/1.0" }
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      responseTimeMs: Date.now() - started,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      bodyPreview: text.slice(0, 1200)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      responseTimeMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function nativeAuthenticatedGitHubTools(): CodingFleetTool[] {
  return [
    { name: "github_write_file", description: "Write/update a repository file using the installed GitHub App. This creates a real Git commit on the target branch.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, content: { type: "string" }, message: { type: "string" }, sha: { type: "string" }, branch: { type: "string" } }, required: ["owner", "repo", "path", "content", "message"], additionalProperties: false }, githubSource: true },
    { name: "github_create_branch", description: "Create a real Git branch from the default branch or a specified base ref.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, branch: { type: "string" }, from: { type: "string" } }, required: ["owner", "repo", "branch"], additionalProperties: false }, githubSource: true },
    { name: "github_create_pull_request", description: "Open a real GitHub Pull Request from a changed branch.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, head: { type: "string" }, base: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["owner", "repo", "head", "title"], additionalProperties: false }, githubSource: true },
    { name: "github_create_issue", description: "Create a real GitHub issue.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["owner", "repo", "title"], additionalProperties: false }, githubSource: true },
    { name: "github_actions", description: "Inspect recent GitHub Actions runs, including status, conclusion and commit SHA.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, branch: { type: "string" } }, required: ["owner", "repo"], additionalProperties: false }, githubSource: true },
    { name: "github_dispatch_workflow", description: "Dispatch a real GitHub Actions workflow.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, workflow: { type: "string" }, branch: { type: "string" }, inputs: { type: "object", additionalProperties: { type: "string" } } }, required: ["owner", "repo", "workflow"], additionalProperties: false }, githubSource: true },
    { name: "github_wait_for_workflow", description: "Wait for a GitHub Actions run and return verified completion.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, runId: { type: "integer" }, timeoutMs: { type: "integer" }, pollMs: { type: "integer" } }, required: ["owner", "repo", "runId"], additionalProperties: false }, githubSource: true },
    { name: "github_get_repo", description: "Read authenticated GitHub repository metadata.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"], additionalProperties: false }, githubSource: true }
  ];
}

function nativeGitSearchTools(): CodingFleetTool[] {
  const search = (name: string, description: string, qHint: string): CodingFleetTool => ({
    name, description: `${description} Use GitHub search syntax; ${qHint}.`,
    inputSchema: { type: "object", properties: { q: { type: "string", minLength: 1, maxLength: 256 }, per_page: { type: "integer", minimum: 1, maximum: 20 } }, required: ["q"], additionalProperties: false },
    githubSource: true
  });
  return [
    search("github_search_repositories", "Search GitHub repositories.", "examples: repo:name, user:owner, language:typescript"),
    search("github_search_code", "Search source code across repositories accessible to the GitHub App.", "examples: repo:owner/name path:src 502"),
    search("github_search_commits", "Search commits by message, author, repository, or date.", "examples: repo:owner/name fix 502"),
    search("github_search_issues", "Search issues and Pull Requests.", "examples: repo:owner/name is:open bug"),
    search("github_search_prs", "Search Pull Requests specifically.", "examples: repo:owner/name is:pr is:open"),
    search("github_search_branches", "Search repository branches by name.", "examples: owner/name feature")
  ];
}

function nativeGitHubTools(): CodingFleetTool[] {
  return [
    { name: "github_get_repo", description: "Read public GitHub repository metadata. No GitHub credential is required for public repositories.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"], additionalProperties: false }, githubSource: true },
    { name: "github_get_file", description: "Read a file from a public GitHub repository. No GitHub credential is required for public repositories.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } }, required: ["owner", "repo", "path"], additionalProperties: false }, githubSource: true },
    { name: "github_list_commits", description: "Read recent commits from a public GitHub repository. No GitHub credential is required for public repositories.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, per_page: { type: "integer", minimum: 1, maximum: 20 } }, required: ["owner", "repo"], additionalProperties: false }, githubSource: true },
  ];
}

