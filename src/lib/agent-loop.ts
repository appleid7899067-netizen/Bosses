import { callWithFallback, type CodingFleetTool } from "@/lib/puter-tool-loader";
import { runInSandbox, type SandboxResult } from "@/lib/sandbox";
import { discoverMCPTools } from "@/lib/mcp";

export type AgentPhase = "plan" | "select" | "act" | "observe" | "refine" | "verify";
export type AgentStep = { phase: AgentPhase; detail: string };
export type AgentRunResult = { ok: boolean; text: string; steps: AgentStep[]; sandbox?: SandboxResult; verified?: boolean };

function summarizeToolNames(tools: CodingFleetTool[]): string {
  return tools.slice(0, 8).map((tool) => String(tool.name ?? tool.slug ?? tool.id ?? "")).filter(Boolean).join(", ");
}

function looksLikeMutation(prompt: string): boolean {
  return /แก้|เขียน|สร้าง|ลบ|update|write|fix|repair|deploy|ดีพลอย|modify|change|commit/i.test(prompt);
}

function looksLikeVerification(prompt: string): boolean {
  return /test|verify|ตรวจ|เช็ก|build|ci|ผ่าน|ทำงานไหม|ใช้งานได้/i.test(prompt);
}

function isVerificationToolCall(name: string): boolean {
  return /(^|_)(test|verify|verification|build|ci|check|status|health|deploy|sandbox)(_|$)/i.test(name);
}

/** Plan → Select → Act → Observe → Refine → Verify. */
export async function runAgentLoop(prompt: string, tools: CodingFleetTool[], maxIterations = 6): Promise<AgentRunResult> {
  const steps: AgentStep[] = [
    { phase: "plan", detail: "วิเคราะห์เป้าหมายและแตกงานเป็นขั้นตอน" },
    { phase: "select", detail: `เลือกเครื่องมือจาก Tool Registry: ${summarizeToolNames(tools) || "ไม่มีชื่อเครื่องมือ"}` },
  ];
  const mcp = await discoverMCPTools();
  const mcpCount = mcp.reduce((sum, item) => sum + item.tools.length, 0);
  let currentPrompt = `${prompt}

Agent protocol: Plan → Select → Act → Observe → Refine → Verify.
MCP tools discovered: ${mcpCount}.
Task mutation expected: ${looksLikeMutation(prompt)}.
Verification requested or required: ${looksLikeVerification(prompt)}.
Use the selected tools. If a tool fails, diagnose from its actual output and repair instead of guessing.
Never claim an external action succeeded without evidence.`;
  let last = "";
  let hadToolActivity = false;
  let hadVerificationActivity = false;
  const mutationExpected = looksLikeMutation(prompt);

  for (let iteration = 0; iteration < Math.max(1, Math.min(maxIterations, 8)); iteration += 1) {
    steps.push({ phase: "act", detail: `รอบที่ ${iteration + 1}: ลงมือทำผ่านเครื่องมือ` });
    const result = await callWithFallback(currentPrompt, tools);
    if (!result.ok) {
      steps.push({ phase: "observe", detail: `เครื่องมือ/โมเดลแจ้งข้อผิดพลาด: ${result.error.slice(0, 300)}` });
      return { ok: false, text: result.error, steps, verified: false };
    }
    last = result.text;
    hadToolActivity ||= result.toolCalls.length > 0;
    hadVerificationActivity ||= result.toolCalls.some((call) => isVerificationToolCall(call.name));
    steps.push({ phase: "observe", detail: `รอบที่ ${iteration + 1}: ได้ผลลัพธ์และ ${result.toolCalls.length} tool call` });
    if (!result.toolCalls.length) {
      if (mutationExpected && !hadVerificationActivity) {
        steps.push({ phase: "verify", detail: "ยังไม่มีหลักฐานจาก verification tool หลังมีการเปลี่ยนแปลง จึงบังคับให้ Agent ตรวจซ้ำ" });
        if (iteration === Math.min(maxIterations, 8) - 1) {
          return { ok: false, text: last, steps, verified: false };
        }
        steps.push({ phase: "refine", detail: "ขอให้ Agent เรียกเครื่องมือตรวจสอบจริงก่อนประกาศสำเร็จ" });
        currentPrompt = `${prompt}

Verification gate: external mutation is expected. You MUST use an actual verification/status/test/build/CI/deploy tool and report its concrete result before finishing. Do not answer with a success claim without that evidence.`;
        continue;
      }
      steps.push({ phase: "verify", detail: mutationExpected ? "พบหลักฐานจาก verification tool แล้ว" : "ไม่มี external mutation ที่ต้องตรวจเพิ่ม" });
      return { ok: true, text: last, steps, verified: true };
    }
    if (iteration === Math.min(maxIterations, 8) - 1) {
      steps.push({ phase: "verify", detail: "หมดรอบซ่อมที่กำหนด จึงยังไม่ประกาศว่าสำเร็จ" });
      return { ok: false, text: last, steps, verified: false };
    }
    steps.push({ phase: "refine", detail: "นำผลจริงกลับไปให้ Agent วิเคราะห์และแก้ต่อ" });
    currentPrompt = `${prompt}

Previous agent output:
${last.slice(-12000)}

Continue from the actual observations above. If work changed external state, verify it now. If verification fails, diagnose and repair the root cause. Do not stop merely because a file was changed.`;
  }
  return { ok: false, text: last, steps, verified: false };
}

export async function executeAgentCode(language: string, code: string) {
  return runInSandbox({ language, code });
}
