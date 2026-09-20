import { callWithFallback, type CodingFleetTool, type ToolExecutionResult } from "@/lib/puter-tool-loader";
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
  return /(^|_)(test|verify|verification|build|ci|check|status|health|deploy|sandbox|web|http)(_|$)/i.test(name);
}

function diagnoseToolFailure(item: ToolExecutionResult): string {
  const raw = String(item.error ?? item.result ?? "").slice(0, 1200);
  const text = raw.toLowerCase();
  if (/502|bad gateway/.test(text)) return `Root cause hint: upstream/deployment gateway failure (HTTP 502) from ${item.name}.`;
  if (/503|service unavailable/.test(text)) return `Root cause hint: service unavailable or unhealthy deployment from ${item.name}.`;
  if (/timeout|timed out|etimedout|econnreset|socket hang up/.test(text)) return `Root cause hint: network/service timeout from ${item.name}.`;
  if (/401|unauthorized|authentication|token|api key/.test(text)) return `Root cause hint: authentication/credential failure from ${item.name}.`;
  if (/403|forbidden|permission|access denied/.test(text)) return `Root cause hint: permission/access failure from ${item.name}.`;
  if (/404|not found|module not found/.test(text)) return `Root cause hint: missing route/resource/module from ${item.name}.`;
  if (/eaddrinuse|address already in use|port/.test(text)) return `Root cause hint: port/process conflict from ${item.name}.`;
  if (/typescript|ts\\d+|type error/.test(text)) return `Root cause hint: TypeScript/type-check failure from ${item.name}.`;
  if (/eslint|lint/.test(text)) return `Root cause hint: lint/style-check failure from ${item.name}.`;
  if (/npm err|pnpm|yarn|package|dependency|cannot find module/.test(text)) return `Root cause hint: dependency/package resolution failure from ${item.name}.`;
  if (/referenceerror|typeerror|cannot read propert|undefined is not/.test(text)) return `Root cause hint: runtime JavaScript error from ${item.name}.`;
  if (/syntaxerror|parse error|unexpected token/.test(text)) return `Root cause hint: syntax/parse failure from ${item.name}.`;
  return `Root cause hint: inspect the concrete error from ${item.name}; do not guess.`;
}

function verificationPassed(results: ToolExecutionResult[]): { passed: boolean; evidence: string } {
  const checks = results.filter((item) => isVerificationToolCall(item.name));
  if (!checks.length) return { passed: false, evidence: "ยังไม่มีผลลัพธ์จาก verification tool" };
  for (const check of checks) {
    if (!check.ok) continue;
    const value = check.result;
    if (check.name === "web_check" && value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const status = Number(record.status ?? 0);
      if (record.ok === true && status >= 200 && status < 300) return { passed: true, evidence: `web_check ผ่าน HTTP ${status}` };
    }
    if (check.name === "sandbox_run" && value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.ok === true && (record.exitCode === undefined || record.exitCode === 0)) return { passed: true, evidence: "sandbox_run ผ่านและไม่มี exit error" };
    }
    if (/workflow|actions|ci|build|deploy|check|status/i.test(check.name) && value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.verified === true || (record.status === "completed" && record.conclusion === "success") || record.success === true) return { passed: true, evidence: `${check.name} รายงานผลสำเร็จจาก tool จริง` };
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.verified === true || record.success === true) return { passed: true, evidence: `${check.name} รายงานผล verified/success จาก tool จริง` };
    }
  }
  return { passed: false, evidence: "verification tool ทำงานแล้ว แต่ผลจริงยังไม่ผ่านเกณฑ์" };
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
Verification requested or required: ${looksLikeVerification(prompt)}. For deployed URLs, prefer web_check and treat HTTP 2xx as healthy; 5xx or timeout means verification failed and should trigger diagnosis/repair.
Use the selected tools. If a tool fails, diagnose from its actual output and repair instead of guessing.
For deployment or website health tasks, if a public HTTPS URL is available, MUST call web_check after the deploy/build step. If a target URL was detected, use this exact health target: ${prompt.match(/https:\/\/[^\s)\]}>,]+/i)?.[0] || "the public HTTPS URL returned by the deployment tool"}. Treat HTTP 2xx as healthy; HTTP 4xx/5xx, timeout, redirect failure, or tool error as a failed verification that must enter the repair loop.
Never claim an external action succeeded without evidence.`;
  let last = "";
  let hadToolActivity = false;
  let hadVerificationActivity = false;
  let verificationPassedEvidence = "";
  let failedToolStreak = 0;
  const repairedToolNames = new Set<string>();
  const toolFailureCounts = new Map<string, number>();
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
    hadVerificationActivity ||= result.toolResults.some((item) => isVerificationToolCall(item.name));
    const verification = verificationPassed(result.toolResults);
    if (verification.passed) verificationPassedEvidence = verification.evidence;
    for (const toolResult of result.toolResults) {
      const detail = toolResult.ok
        ? `✓ ${toolResult.name}`
        : `✗ ${toolResult.name}: ${String(toolResult.error ?? "tool failed").slice(0, 180)}`;
      steps.push({ phase: "observe", detail });
    }
    steps.push({ phase: "observe", detail: `รอบที่ ${iteration + 1}: ได้ผลลัพธ์และ ${result.toolCalls.length} tool call` });
    if (!result.toolCalls.length) {
      if ((mutationExpected || hadVerificationActivity || looksLikeVerification(prompt)) && !verificationPassedEvidence) {
        steps.push({ phase: "verify", detail: "ยังไม่มีหลักฐานจาก verification tool หลังมีการเปลี่ยนแปลง จึงบังคับให้ Agent ตรวจซ้ำ" });
        if (iteration === Math.min(maxIterations, 8) - 1) {
          return { ok: false, text: last, steps, verified: false };
        }
        steps.push({ phase: "refine", detail: "ขอให้ Agent เรียกเครื่องมือตรวจสอบจริงก่อนประกาศสำเร็จ" });
        currentPrompt = `${prompt}

Verification gate: external mutation is expected. You MUST use an actual verification/status/test/build/CI/deploy tool and report its concrete result before finishing. Do not answer with a success claim without that evidence.`;
        continue;
      }
      steps.push({
        phase: "verify",
        detail: (mutationExpected || hadVerificationActivity || looksLikeVerification(prompt))
          ? `Verification gate: ${verificationPassedEvidence || "ยังไม่มีหลักฐาน"}`
          : "ไม่มี external mutation ที่ต้องตรวจเพิ่ม",
      });
      const verificationRequired = mutationExpected || hadVerificationActivity || looksLikeVerification(prompt);
      return { ok: !verificationRequired || Boolean(verificationPassedEvidence), text: last, steps, verified: !verificationRequired || Boolean(verificationPassedEvidence) };
    }
    if (iteration === Math.min(maxIterations, 8) - 1) {
      steps.push({ phase: "verify", detail: "หมดรอบซ่อมที่กำหนด จึงยังไม่ประกาศว่าสำเร็จ" });
      return { ok: false, text: last, steps, verified: false };
    }
    const failedResults = result.toolResults.filter((item) => !item.ok);
    const verificationResults = result.toolResults.filter((item) => isVerificationToolCall(item.name));
    const verificationFailed = verificationResults.length > 0 && !verification.passed;
    if (verificationResults.length) {
      steps.push({ phase: "observe", detail: `Verification observations: ${verificationResults.map((item) => `${item.name}=${item.ok ? "passed" : "failed"}`).join(", ")}` });
    }
    if (verificationResults.some((item) => !item.ok)) {
      steps.push({ phase: "refine", detail: `Verification ไม่ผ่าน: ${verificationResults.filter((item) => !item.ok).map((item) => `${item.name}: ${String(item.error ?? "ไม่ผ่าน").slice(0, 180)}`).join(" | ")}` });
    }
    const failedTools = failedResults.map((item) => `${item.name} (failures: ${toolFailureCounts.get(item.name) ?? 1}): ${String(item.error ?? "unknown error").slice(0, 800)}`);
    const diagnosisHints = failedResults.map(diagnoseToolFailure);
    const observedResults = result.toolResults.map((item) => {
      const payload = item.ok ? JSON.stringify(item.result ?? "").slice(0, 1600) : `ERROR: ${String(item.error ?? "tool failed").slice(0, 800)}`;
      return `${item.name}: ${payload}`;
    });
    const verificationIssue = verificationFailed ? `Verification evidence failed: ${verification.evidence}` : "";
    if (failedResults.length) {
      failedToolStreak += 1;
      for (const item of failedResults) {
        repairedToolNames.add(item.name);
        toolFailureCounts.set(item.name, (toolFailureCounts.get(item.name) ?? 0) + 1);
      }
    } else {
      failedToolStreak = 0;
    }
    if (failedTools.length) {
      steps.push({ phase: "refine", detail: `พบ Tool ล้มเหลว ${failedTools.length} รายการ: บังคับวิเคราะห์สาเหตุและซ่อมต่อ (streak ${failedToolStreak})` });
    } else {
      steps.push({ phase: "refine", detail: "นำผลจริงกลับไปให้ Agent วิเคราะห์และแก้ต่อ" });
    }
    const repeatedFailures = Array.from(toolFailureCounts.entries()).filter(([, count]) => count >= 2).map(([name, count]) => `${name} failed ${count} times`);
    currentPrompt = `${prompt}

Repair context: ${repairedToolNames.size ? `เครื่องมือที่เคยพลาดและต้องติดตาม: ${Array.from(repairedToolNames).join(", ")}. เครื่องมือที่พลาดซ้ำ: ${repeatedFailures.length ? repeatedFailures.join(", ") : "ไม่มี"}` : "ยังไม่มี"}.

Previous agent output:
${last.slice(-12000)}

Actual tool observations from this round:
${observedResults.length ? observedResults.join("\n") : "ไม่มี"}

Actual failed tools from this round:
${failedTools.length ? failedTools.join("\n") : "ไม่มี"}
     ${failedTools.length ? failedTools.join("\n") : "ไม่มี"}

Deterministic diagnosis hints:
${diagnosisHints.length ? diagnosisHints.join("\n") : "ไม่มี"}
${verificationIssue}

Continue from the actual observations above. For every failed tool, diagnose the concrete error, make the smallest safe repair when appropriate, then rerun the relevant tool. If verification fails, diagnose and repair the root cause. Do not stop merely because a file was changed. Do not claim success until verification evidence exists.`;
  }
  return { ok: false, text: last, steps, verified: false };
}

export async function executeAgentCode(language: string, code: string) {
  return runInSandbox({ language, code });
}
