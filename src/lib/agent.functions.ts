import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadCodingFleetTools } from "@/lib/puter-tool-loader";
import { runGitHubAgent } from "@/lib/github-agent-tools.server";
import { executeAgentCode, runAgentLoop } from "@/lib/agent-loop";

const loopSchema = z.object({ prompt: z.string().min(1).max(60_000), maxIterations: z.number().int().min(1).max(8).optional() });
const codeSchema = z.object({ language: z.string().min(1).max(40), code: z.string().max(500_000) });

export const runAgent = createServerFn({ method: "POST" })
  .validator(loopSchema)
  .handler(async ({ data }) => {
    const result = await runGitHubAgent(data.prompt);
    if (result.ok) return { ok: true, text: result.text, steps: [{ phase: "plan", detail: "GitHub Agent 77 authenticated execution." }, { phase: "act", detail: `Executed ${result.toolCalls.length} GitHub tool calls.` }, { phase: "observe", detail: "Verified tool responses returned by GitHub." }] };
    return runAgentLoop(data.prompt, await loadCodingFleetTools(), data.maxIterations ?? 6);
  });

export const runAgentSandbox = createServerFn({ method: "POST" })
  .validator(codeSchema)
  .handler(async ({ data }) => executeAgentCode(data.language, data.code));
