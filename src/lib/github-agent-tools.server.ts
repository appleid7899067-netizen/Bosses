import { ensurePuter, extractText } from "@/lib/puter";
import {
  githubActions,
  githubCreateBranch,
  githubCreateIssue,
  githubCreatePullRequest,
  githubDispatchWorkflow,
  githubGetFile,
  githubStatus,
  githubWorkflowDiagnostics,
  githubWaitForWorkflow,
  githubWriteFile,
} from "@/lib/github-app.server";

type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

type AgentResult = {
  ok: true;
  text: string;
  toolCalls: ToolCall[];
} | {
  ok: false;
  error: string;
};

type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const MODELS = ["gpt-5.6-luna", "claude-sonnet-4-6", "gemini-3.1-flash-lite"] as const;
const MAX_ROUNDS = 12;

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "github_get_repo",
      description: "Read GitHub repository status and metadata using the installed GitHub App.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" } },
        required: ["owner", "repo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_get_file",
      description: "Read a file from a GitHub repository using the installed GitHub App.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } },
        required: ["owner", "repo", "path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_write_file",
      description: "Write or update a file in a GitHub repository. For an existing file, first read it and pass its current sha to avoid overwriting concurrent changes.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" },
          content: { type: "string" }, message: { type: "string" }, sha: { type: "string" }, branch: { type: "string" },
        },
        required: ["owner", "repo", "path", "content", "message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_create_branch",
      description: "Create a Git branch from the default branch or a specified base.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, branch: { type: "string" }, from: { type: "string" } },
        required: ["owner", "repo", "branch"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_create_pull_request",
      description: "Create a pull request after changes have been written to a branch.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, head: { type: "string" }, base: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
        required: ["owner", "repo", "head", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_create_issue",
      description: "Create a GitHub issue.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
        required: ["owner", "repo", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_actions",
      description: "Read recent GitHub Actions workflow runs for a repository.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, branch: { type: "string" } },
        required: ["owner", "repo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_workflow_diagnostics",
      description: "Inspect a workflow run and retrieve the tail of failed job logs for diagnosis.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, runId: { type: "integer" } },
        required: ["owner", "repo", "runId"],
        additionalProperties: false,
      },
    },
  },
  {
      type: "function",
      function: {
        name: "github_dispatch_workflow",
      description: "Dispatch a GitHub Actions workflow on a branch.",
      parameters: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, workflow: { type: "string" }, branch: { type: "string" }, inputs: { type: "object", additionalProperties: { type: "string" } } },
        required: ["owner", "repo", "workflow"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_check",
      description: "Check a deployed HTTPS URL and return status, final URL, response time, content type, and body preview. Use after deployment and when diagnosing 500/502/503/timeouts.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", minLength: 8, maxLength: 2048 }, timeoutMs: { type: "integer", minimum: 1000, maximum: 30000 } },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_wait_for_workflow",
      description: "Wait for a GitHub Actions run to complete and return its actual conclusion. Use after dispatching or after a commit that triggers CI.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" }, repo: { type: "string" }, runId: { type: "integer" },
          timeoutMs: { type: "integer" }, pollMs: { type: "integer" },
        },
        required: ["owner", "repo", "runId"],
        additionalProperties: false,
      },
    },
  },
];

function parseArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {}
  }
  return {};
}

function extractCalls(response: unknown): ToolCall[] {
  const root = response as Record<string, unknown> | null;
  const message = root?.message as Record<string, unknown> | undefined;
  const raw = message?.tool_calls ?? root?.tool_calls ?? root?.toolCalls;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const call = item as Record<string, unknown>;
    const fn = call.function as Record<string, unknown> | undefined;
    const name = String(fn?.name ?? call.name ?? "").trim();
    if (!name) return [];
    return [{ id: String(call.id ?? crypto.randomUUID()), name, arguments: parseArgs(fn?.arguments ?? call.arguments ?? call.input) }];
  });
}

function assistantMessage(response: unknown): Record<string, unknown> | null {
  const message = (response as Record<string, unknown> | null)?.message;
  return message && typeof message === "object" ? message as Record<string, unknown> : null;
}

async function execute(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "web_check") {
    const rawUrl = String(args.url ?? "").trim();
    if (!/^https:\/\//i.test(rawUrl)) throw new Error("web_check only accepts HTTPS URLs.");
    let target: URL;
    try { target = new URL(rawUrl); } catch { throw new Error("Invalid URL."); }
    const timeoutMs = Math.min(30000, Math.max(1000, Number(args.timeoutMs ?? 15000)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(target.toString(), { redirect: "follow", signal: controller.signal, headers: { Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1", "User-Agent": "Bossnu-WebCheck/1.0" } });
      const body = await response.text();
      return { ok: response.ok, status: response.status, statusText: response.statusText, finalUrl: response.url, responseTimeMs: Date.now() - started, contentType: response.headers.get("content-type"), bodyPreview: body.slice(0, 1200) };
    } catch (error) {
      return { ok: false, status: 0, responseTimeMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    } finally { clearTimeout(timer); }
  }
  const owner = String(args.owner ?? "").trim();
  const repo = String(args.repo ?? "").trim();
  if (!owner || !repo) throw new Error("owner and repo are required");

  switch (name) {
    case "github_get_repo":
      return githubStatus(owner, repo);
    case "github_get_file":
      return githubGetFile({ owner, repo, path: String(args.path ?? ""), ref: args.ref ? String(args.ref) : undefined });
    case "github_write_file":
      return githubWriteFile({
        owner, repo, path: String(args.path ?? ""), content: String(args.content ?? ""),
        message: String(args.message ?? "Agent update"), sha: args.sha ? String(args.sha) : undefined,
        branch: args.branch ? String(args.branch) : undefined,
      });
    case "github_create_branch":
      return githubCreateBranch({ owner, repo, branch: String(args.branch ?? ""), from: args.from ? String(args.from) : undefined });
    case "github_create_pull_request":
      return githubCreatePullRequest({ owner, repo, head: String(args.head ?? ""), base: args.base ? String(args.base) : undefined, title: String(args.title ?? ""), body: args.body ? String(args.body) : undefined });
    case "github_create_issue":
      return githubCreateIssue({ owner, repo, title: String(args.title ?? ""), body: args.body ? String(args.body) : undefined });
    case "github_actions":
      return githubActions({ owner, repo, branch: args.branch ? String(args.branch) : undefined });
    case "github_workflow_diagnostics":
      return githubWorkflowDiagnostics({ owner, repo, runId: Number(args.runId) });
    case "github_wait_for_workflow":
      return githubWaitForWorkflow({
        owner, repo, runId: Number(args.runId),
        timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined,
        pollMs: args.pollMs ? Number(args.pollMs) : undefined,
      });
    case "github_dispatch_workflow":
      return githubDispatchWorkflow({ owner, repo, workflow: String(args.workflow ?? ""), branch: args.branch ? String(args.branch) : undefined, inputs: args.inputs && typeof args.inputs === "object" ? args.inputs as Record<string, string> : undefined });
    default:
      throw new Error(`Unknown GitHub tool: ${name}`);
  }
}

async function runModel(prompt: string, model: string): Promise<AgentResult> {
  const puter = await ensurePuter();
  if (!puter.auth.isSignedIn()) await puter.auth.signIn();

  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: "You are CodingFleet GitHub Agent 77. Work as an autonomous software engineer: inspect first, make the smallest safe change, run or dispatch verification, inspect failed workflow logs, fix the root cause, and verify again. For updates to existing files, read the file first and use its current sha. Never claim success without evidence from the actual tool or verification result.",
    },
    { role: "user", content: prompt },
  ];
  const allCalls: ToolCall[] = [];
  let mutationOccurred = false;
  let verified = false;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await puter.ai.chat(messages, { model, tools: TOOLS, normalize: true, stream: false });
    const calls = extractCalls(response);
    allCalls.push(...calls);
    const message = assistantMessage(response);
    if (message) messages.push(message);
    if (!calls.length) {
      if (mutationOccurred && !verified) {
        messages.push({ role: "user", content: "You changed repository state but have not verified the result yet. Continue by checking the changed file and/or GitHub Actions. Do not give a final success message until verification succeeds." });
        continue;
      }
      return { ok: true, text: extractText(response), toolCalls: allCalls };
    }

    for (const call of calls) {
      if (["github_write_file", "github_create_branch", "github_create_pull_request", "github_create_issue", "github_dispatch_workflow"].includes(call.name)) mutationOccurred = true;
      if (call.name === "github_wait_for_workflow") {
        const result = await execute(call.name, call.arguments);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        verified = Boolean(result && typeof result === "object" && "verified" in result && (result as { verified?: unknown }).verified === true);
        continue;
      }
      if (call.name === "github_workflow_diagnostics") {
        const result = await execute(call.name, call.arguments);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        continue;
      }

      try {
        const result = await execute(call.name, call.arguments);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: text }) });
      }
    }
  }

  return { ok: false, error: `GitHub agent exceeded ${MAX_ROUNDS} tool rounds.` };
}

export async function runGitHubAgent(prompt: string): Promise<AgentResult> {
  let lastError = "No model succeeded.";
  for (const model of MODELS) {
    try {
      return await runModel(prompt, model);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: lastError };
}
