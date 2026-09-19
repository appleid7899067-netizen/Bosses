import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { selectToolsForTask } from "@/lib/tool-registry";
import { runGitHubAgent } from "@/lib/github-agent-tools.server";
import { executeAgentCode, runAgentLoop } from "@/lib/agent-loop";

const loopSchema = z.object({ prompt: z.string().min(1).max(60_000), maxIterations: z.number().int().min(1).max(8).optional() });
const codeSchema = z.object({ language: z.string().min(1).max(40), code: z.string().max(500_000) });

function prefersAuthenticatedGitHub(prompt: string): boolean {
  return /github|repository|repo|pull request|branch|commit|workflow|actions|502|500|503|bug|error|debug|deploy|ดีพลอย|แก้โค้ด|แก้ไฟล์|ล่ม/.test(prompt.toLowerCase());
}

export const runAgent = createServerFn({ method: "POST" })
  .validator(loopSchema)
  .handler(async ({ data }) => {
    const selected = await selectToolsForTask(data.prompt, 20);
    const selectedNames = selected.slice(0, 8).map((tool) => String(tool.name ?? "")).filter(Boolean);
    const registryStep = { phase: "plan" as const, detail: `Tool Registry selected ${selectedNames.length} tools: ${selectedNames.join(", ")}` };

    const registryHasGitHub = selected.some((tool) => String(tool.name ?? "").toLowerCase().includes("github"));
    if (registryHasGitHub && prefersAuthenticatedGitHub(data.prompt)) {
      const result = await runGitHubAgent(data.prompt);
      if (result.ok) {
        const verificationStep = result.verified
          ? { phase: "verify" as const, detail: "GitHub Agent มีหลักฐาน verification จริงจาก workflow/web health check" }
          : { phase: "verify" as const, detail: "GitHub Agent ยังไม่มีหลักฐาน verification สำเร็จ" };
        return {
          ok: result.verified || !/แก้|เขียน|สร้าง|ลบ|update|write|fix|repair|deploy|ดีพลอย|modify|change/i.test(data.prompt),
          text: result.text,
          steps: [
            registryStep,
            { phase: "act" as const, detail: `Authenticated GitHub Agent executed ${result.toolCalls.length} tool calls.` },
            { phase: "observe" as const, detail: "GitHub tool results were returned and checked before completion." },
            verificationStep,
          ],
          verified: result.verified,
        };
      }
    }

    const result = await runAgentLoop(data.prompt, selected, data.maxIterations ?? 6);
    return { ...result, steps: [registryStep, ...result.steps] };
  });

export const runAgentSandbox = createServerFn({ method: "POST" })
  .validator(codeSchema)
  .handler(async ({ data }) => executeAgentCode(data.language, data.code));
