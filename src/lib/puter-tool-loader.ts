import { ensurePuter, extractText } from "@/lib/puter";

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

function nativeGitHubTools(): CodingFleetTool[] {
  return [
    { name: "github_get_repo", description: "Read public GitHub repository metadata. No GitHub credential is required for public repositories.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"], additionalProperties: false }, githubSource: true },
    { name: "github_get_file", description: "Read a file from a public GitHub repository. No GitHub credential is required for public repositories.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } }, required: ["owner", "repo", "path"], additionalProperties: false }, githubSource: true },
    { name: "github_list_commits", description: "Read recent commits from a public GitHub repository. No GitHub credential is required for public repositories.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, per_page: { type: "integer", minimum: 1, maximum: 20 } }, required: ["owner", "repo"], additionalProperties: false }, githubSource: true },
  ];
}

async function executeGitHubTool(tool: CodingFleetTool, args: Record<string, unknown>): Promise<unknown> {
  const owner = String(args.owner ?? "").trim();
  const repo = String(args.repo ?? "").trim();
  if (!owner || !repo) throw new Error("GitHub requires owner and repo.");
  let path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (toolName(tool) === "github_get_file") {
    const filePath = String(args.path ?? "").replace(/^\/+/, "");
    if (!filePath) throw new Error("GitHub file path is required.");
    path += `/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;
    if (args.ref) path += `?ref=${encodeURIComponent(String(args.ref))}`;
  } else if (toolName(tool) === "github_list_commits") {
    path += `/commits?per_page=${Math.min(20, Math.max(1, Number(args.per_page ?? 10)))}`;
  }
  const response = await fetch(`${GITHUB_API}${path}`, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function loadPublicMcpTools(): Promise<CodingFleetTool[]> {
  const loaded: CodingFleetTool[] = [];
  for (const server of PUBLIC_MCP_SERVERS) {
    try {
      const init = await fetch(server, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Bossnu-CodingFleet", version: "1.0.0" } } }) });
      if (!init.ok) continue;
      const sessionId = init.headers.get("mcp-session-id");
      const list = await fetch(server, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
      if (!list.ok) continue;
      const payload = await readJsonRpcResponse(list);
      const tools = (payload.result as Record<string, unknown> | undefined)?.tools;
      if (!Array.isArray(tools)) continue;
      for (const raw of tools) {
        if (!raw || typeof raw !== "object") continue;
        const t = raw as Record<string, unknown>; const name = String(t.name ?? "").trim(); if (!name) continue;
        loaded.push({ name: `mcp_${name}`, description: String(t.description ?? `Public MCP tool: ${name}`), inputSchema: t.inputSchema ?? { type: "object", properties: {} }, mcpServer: server, mcpToolName: name });
      }
    } catch {}
  }
  return loaded;
}

async function readJsonRpcResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text(); const trimmed = text.trim(); if (!trimmed) return {};
  if (trimmed.startsWith("data:")) { const line = trimmed.split(/\r?\n/).find((x) => x.startsWith("data:")); if (line) return JSON.parse(line.slice(5).trim()) as Record<string, unknown>; }
  return JSON.parse(trimmed) as Record<string, unknown>;
}

async function callPublicMcpTool(tool: CodingFleetTool, args: Record<string, unknown>): Promise<unknown> {
  const server = String(tool.mcpServer ?? ""), name = String(tool.mcpToolName ?? "");
  const init = await fetch(server, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Bossnu-CodingFleet", version: "1.0.0" } } }) });
  if (!init.ok) throw new Error(`MCP initialize failed: HTTP ${init.status}`);
  const sid = init.headers.get("mcp-session-id");
  const response = await fetch(server, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...(sid ? { "Mcp-Session-Id": sid } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) });
  if (!response.ok) throw new Error(`MCP tool ${name} failed: HTTP ${response.status}`);
  const payload = await readJsonRpcResponse(response); if (payload.error) throw new Error(JSON.stringify(payload.error)); return payload.result ?? payload;
}

export async function loadCodingFleetTools(forceRefresh = false): Promise<CodingFleetTool[]> {
  if (!forceRefresh && cachedTools && Date.now() - cachedAt < CACHE_TTL_MS) return cachedTools;
  const sources = await Promise.allSettled([
    fetch(TOOLS_URL, { headers: { Accept: "application/json" } }).then(async (r) => { if (!r.ok) throw new Error(`CodingFleet tools returned HTTP ${r.status}.`); return normalizeTools(await r.json()); }),
    loadPluginTools(),
    loadPublicMcpTools(),
  ]);
  const codingFleet = sources[0].status === "fulfilled" ? sources[0].value : [];
  const pluginTools = sources[1].status === "fulfilled" ? sources[1].value : [];
  const mcpTools = sources[2].status === "fulfilled" ? sources[2].value : [];
  const tools = [...codingFleet, ...pluginTools, ...nativeGitHubTools(), ...mcpTools].slice(0, TOOL_LIMIT);
  if (tools.length > 0) { cachedTools = tools; cachedAt = Date.now(); return tools; }
  if (cachedTools) return cachedTools;
  throw new Error("No callable tools are available.");
}

function toPuterTools(tools: CodingFleetTool[]): PuterFunctionTool[] { return tools.slice(0, TOOL_LIMIT).map((tool) => { const name = toolName(tool); if (!name) return null; return { type: "function" as const, function: { name, description: String(tool.description ?? `Tool: ${name}`), parameters: toolParameters(tool) } }; }).filter((tool): tool is PuterFunctionTool => tool !== null); }
function toolSummary(tools: CodingFleetTool[]): string { return tools.slice(0, TOOL_LIMIT).map((tool) => JSON.stringify({ name: toolName(tool), description: tool.description, input_schema: toolParameters(tool) })).join("\n"); }
function parseArguments(value: unknown): Record<string, unknown> { if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; if (typeof value === "string") { try { const p = JSON.parse(value); if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>; } catch {} } return {}; }
function extractToolCalls(value: unknown): ToolCall[] { const response = value as Record<string, unknown> | null; const message = response?.message as Record<string, unknown> | undefined; const raw = message?.tool_calls ?? response?.tool_calls ?? response?.toolCalls; if (!Array.isArray(raw)) return []; return raw.flatMap((item) => { if (!item || typeof item !== "object") return []; const call = item as Record<string, unknown>; const fn = call.function as Record<string, unknown> | undefined; const name = String(fn?.name ?? call.name ?? "").trim(); return name ? [{ id: typeof call.id === "string" ? call.id : undefined, name, arguments: parseArguments(fn?.arguments ?? call.arguments ?? call.input) }] : []; }); }
function assistantToolMessage(response: unknown): Record<string, unknown> | null { const message = (response as Record<string, unknown> | null)?.message; return message && typeof message === "object" ? message as Record<string, unknown> : null; }
function resolveEndpoint(tool: CodingFleetTool): string | null { const candidate = tool.endpoint ?? tool.url; if (typeof candidate !== "string" || !candidate.trim()) return null; try { return new URL(candidate, `${CODINGFLEET_BASE}/`).toString(); } catch { return null; } }

async function executePluginTool(tool: CodingFleetTool, args: Record<string, unknown>): Promise<unknown> { const endpoint = resolveEndpoint(tool); if (!endpoint) throw new Error(`Plugin ${toolName(tool)} has no callable endpoint.`); const method = String(tool.method ?? "POST").toUpperCase(); const response = await fetch(endpoint, { method, headers: { Accept: "application/json", "Content-Type": "application/json" }, ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify({ arguments: args }) }) }); const text = await response.text(); if (!response.ok) throw new Error(`Plugin ${String(tool.pluginName ?? toolName(tool))} returned HTTP ${response.status}: ${text.slice(0, 240)}`); try { return JSON.parse(text); } catch { return text; } }
async function executeTool(tool: CodingFleetTool, args: Record<string, unknown>): Promise<unknown> { if (tool.githubSource) return executeGitHubTool(tool, args); if (tool.mcpServer) return callPublicMcpTool(tool, args); if (tool.pluginSource) return executePluginTool(tool, args); const endpoint = resolveEndpoint(tool); if (!endpoint) throw new Error(`Tool ${toolName(tool)} has no callable HTTPS endpoint.`); const response = await fetch(endpoint, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ tool: tool.slug ?? toolName(tool), arguments: args }) }); const text = await response.text(); if (!response.ok) throw new Error(`Tool ${toolName(tool)} returned HTTP ${response.status}: ${text.slice(0, 240)}`); try { return JSON.parse(text); } catch { return text; } }

async function chatModel(messages: Array<Record<string, unknown>>, tools: CodingFleetTool[], model: string): Promise<{ text: string; response: unknown; toolCalls: ToolCall[] }> { const puter = await ensurePuter(); if (!puter.auth.isSignedIn()) await puter.auth.signIn(); const response = await puter.ai.chat(messages, { model, tools: toPuterTools(tools), normalize: true, stream: false }); return { text: extractText(response), response, toolCalls: extractToolCalls(response) }; }

export async function callWithFallback(prompt: string, tools: CodingFleetTool[], models: readonly string[] = DEFAULT_MODELS): Promise<{ ok: true; text: string; model: string; toolCalls: ToolCall[] } | { ok: false; error: string }> {
  let lastError = "No model succeeded.";
  for (const model of models) {
    try {
      const availableTools = tools.slice(0, TOOL_LIMIT);
      const system = ["You are Bossnu SlieLo Agent. Use available tools when they materially improve the answer. Never claim an external action succeeded unless the tool returned success.", "Available tools:", toolSummary(availableTools)].join("\n\n");
      const messages: Array<Record<string, unknown>> = [{ role: "system", content: system }, { role: "user", content: prompt }];
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const result = await chatModel(messages, availableTools, model);
        if (!result.toolCalls.length) return { ok: true, text: result.text, model, toolCalls: [] };
        const assistantMessage = assistantToolMessage(result.response);
        if (assistantMessage) messages.push(assistantMessage);
        for (const call of result.toolCalls) {
          const tool = availableTools.find((candidate) => toolName(candidate) === call.name);
          if (!tool) {
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: `Unknown tool: ${call.name}` }) });
            continue;
          }
          try {
            const output = await executeTool(tool, call.arguments);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: true, result: output }) });
          } catch (error) {
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) });
          }
        }
      }
      return { ok: false, error: `Agent reached the ${MAX_TOOL_ROUNDS}-round tool limit without producing a final answer.` };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: lastError };
}
