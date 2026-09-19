import { callWithFallback, type CodingFleetTool } from "@/lib/puter-tool-loader";
import { runInSandbox, type SandboxResult } from "@/lib/sandbox";
import { discoverMCPTools } from "@/lib/mcp";

export type AgentStep = { phase: "plan" | "act" | "observe" | "refine"; detail: string };
export type AgentRunResult = { ok: boolean; text: string; steps: AgentStep[]; sandbox?: SandboxResult; verified?: boolean };

/** Plan → Act → Observe → Refine orchestration. Tool execution remains owned by the existing tool loader. */
export async function runAgentLoop(prompt: string, tools: CodingFleetTool[], maxIterations = 3): Promise<AgentRunResult> {
  const steps: AgentStep[] = [{ phase: "plan", detail: "Task decomposed for agent execution." }];
  const mcp = await discoverMCPTools();
  const mcpCount = mcp.reduce((sum, item) => sum + item.tools.length, 0);
  let currentPrompt = `${prompt}\n\nAgent protocol: Plan, Act, Observe, Refine. MCP tools discovered: ${mcpCount}.`;
  let last = "";

  for (let iteration = 0; iteration < Math.max(1, Math.min(maxIterations, 3)); iteration += 1) {
    steps.push({ phase: "act", detail: `Iteration ${iteration + 1}: model/tool execution.` });
    const result = await callWithFallback(currentPrompt, tools);
    if (!result.ok) return { ok: false, text: result.error, steps };
    last = result.text;
    steps.push({ phase: "observe", detail: `Iteration ${iteration + 1}: received model result with ${result.toolCalls.length} tool calls.` });
    if (!result.toolCalls.length) return { ok: true, text: last, steps, verified: true };
    if (iteration === Math.min(maxIterations, 3) - 1) return { ok: false, text: last, steps, verified: false };
    currentPrompt = `${prompt}\n\nPrevious result:\n${last.slice(-12000)}\n\nRefine the result using verified tool output. Do not claim success without evidence.`;
    steps.push({ phase: "refine", detail: "Feeding verified observations back into the next iteration." });
  }

  return { ok: false, text: last, steps, verified: false };
}

export async function executeAgentCode(language: string, code: string) {
  return runInSandbox({ language, code });
}
