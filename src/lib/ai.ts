import { SYSTEM_PROMPTS } from "@/lib/catalog";
import {
  createGitHubBranch,
  createGitHubIssue,
  createGitHubPullRequest,
  dispatchGitHubWorkflow,
  getGitHubActions,
  getGitHubStatus,
  readGitHubFile,
  writeGitHubFile,
} from "@/lib/github.functions";
import { chatWithOpenRouter, chatWithPuter, type ChatResult, type ChatTurn } from "@/lib/puter";
import { callWithFallback, loadCodingFleetTools } from "@/lib/puter-tool-loader";

export type FleetRequest = {
  mode: keyof typeof SYSTEM_PROMPTS | string;
  prompt: string;
  code?: string;
  language?: string;
  targetLanguage?: string;
  modelId?: string;
  extras?: string;
  history?: ChatTurn[];
};

const GITHUB_TOOLS = `
You have real server-side GitHub tools available through the Bossnu SlieLo bot.
The bot can: inspect a repository, read files, write/commit files, create branches, create pull requests, create issues, inspect recent GitHub Actions runs, and dispatch a workflow.
Never claim an action was completed unless a GitHub tool result confirms it.
Credential escalation is task-aware: preserve the user's current task, identify the exact service/operation that is blocked, and request only the minimum missing access. Do not ask a vague 'which job?' question when the task is already known.
If access can be supplied by an already-connected tool, use that tool first. If a private credential is genuinely required, name the exact service and credential field/environment variable and direct the user to the secure Secrets/connection UI. Never ask for private keys, PEM files, passwords, tokens, cookies, or service-account JSON in ordinary chat and never echo a credential value.
Available command formats:
- github: status owner/repo
- github: read owner/repo/path/to/file [ref]
- github: write owner/repo/path/to/file <commit message>\n---\n<complete new file content>
- github: branch owner/repo new-branch [from-branch]
- github: pr owner/repo head-branch base-branch <title>\n<body>
- github: issue owner/repo <title>\n<body>
- github: actions owner/repo [branch]
- github: workflow owner/repo workflow-file-or-id [branch]
These commands execute on the server with the installed GitHub App permissions.
`;

const AUTONOMOUS_REPO = "appleid7899067-netizen/Bosses";
const AUTONOMOUS_FILES = [
  "package.json",
  "vercel.json",
  "src/routes/index.tsx",
  "src/components/app-shell.tsx",
  "src/components/logo.tsx",
  "src/styles.css",
  "src/lib/catalog.ts",
  "src/lib/ai.ts",
  "src/lib/puter.ts",
  "src/lib/github.functions.ts",
  "src/lib/github-app.server.ts",
  ".github/workflows/ci.yml",
];

function buildUserMessage(data: FleetRequest, githubContext?: string) {
  const parts: string[] = [GITHUB_TOOLS.trim()];
  if (data.language) parts.push(`Language: ${data.language}`);
  if (data.targetLanguage) parts.push(`Target language: ${data.targetLanguage}`);
  if (data.extras) parts.push(data.extras);
  if (githubContext) parts.push(`GitHub tool result:\n${githubContext}`);
  if (data.prompt) parts.push(data.prompt);
  if (data.code?.trim()) parts.push(["Code:", data.code].join("\n"));
  return parts.filter(Boolean).join("\n\n");
}

function splitBody(text: string) {
  const separator = text.indexOf("\n---\n");
  if (separator < 0) return { first: text.trim(), body: "" };
  return { first: text.slice(0, separator).trim(), body: text.slice(separator + 5).trim() };
}

async function runGitHubCommand(prompt: string): Promise<string | undefined> {
  const status = prompt.match(/^github:\s*status\s+([^\s]+)\s*$/i);
  if (status) {
    const [owner, repo] = status[1].split("/");
    if (!owner || !repo) throw new Error("Use: github: status owner/repo");
    return JSON.stringify(await getGitHubStatus({ data: { owner, repo } }), null, 2);
  }

  const read = prompt.match(/^github:\s*read\s+([^\s]+)(?:\s+([^\s]+))?\s*$/i);
  if (read) {
    const parts = read[1].split("/");
    const owner = parts.shift();
    const repo = parts.shift();
    const path = parts.join("/");
    if (!owner || !repo || !path) throw new Error("Use: github: read owner/repo/path/to/file [ref]");
    const file = await readGitHubFile({ data: { owner, repo, path, ...(read[2] ? { ref: read[2] } : {}) } });
    return JSON.stringify({ action: "read", repository: `${owner}/${repo}`, path: file.path, sha: file.sha, content: file.content }, null, 2);
  }

  const write = prompt.match(/^github:\s*write\s+([^\s]+)\s+([\s\S]+)$/i);
  if (write) {
    const parts = write[1].split("/");
    const owner = parts.shift();
    const repo = parts.shift();
    const path = parts.join("/");
    if (!owner || !repo || !path) throw new Error("Use: github: write owner/repo/path/to/file <message>\n---\n<content>");
    const { first: message, body: content } = splitBody(write[2]);
    if (!content) throw new Error("GitHub write needs complete file content after ---");
    const current = await readGitHubFile({ data: { owner, repo, path } }).catch(() => null);
    const result = await writeGitHubFile({ data: { owner, repo, path, content, message: message || "Update from Bossnu SlieLo bot", ...(current?.sha ? { sha: current.sha } : {}) } });
    return JSON.stringify({ action: "write", repository: `${owner}/${repo}`, path, result }, null, 2);
  }

  const branch = prompt.match(/^github:\s*branch\s+([^\s]+)\s+([^\s]+)(?:\s+([^\s]+))?\s*$/i);
  if (branch) {
    const [owner, repo] = branch[1].split("/");
    if (!owner || !repo) throw new Error("Use: github: branch owner/repo new-branch [from-branch]");
    return JSON.stringify(await createGitHubBranch({ data: { owner, repo, branch: branch[2], ...(branch[3] ? { from: branch[3] } : {}) } }), null, 2);
  }

  const pr = prompt.match(/^github:\s*pr\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([\s\S]+)$/i);
  if (pr) {
    const [owner, repo] = pr[1].split("/");
    if (!owner || !repo) throw new Error("Use: github: pr owner/repo head-branch base-branch <title>\n<body>");
    const { first: title, body } = splitBody(pr[4]);
    return JSON.stringify(await createGitHubPullRequest({ data: { owner, repo, head: pr[2], base: pr[3], title, ...(body ? { body } : {}) } }), null, 2);
  }

  const issue = prompt.match(/^github:\s*issue\s+([^\s]+)\s+([\s\S]+)$/i);
  if (issue) {
    const [owner, repo] = issue[1].split("/");
    if (!owner || !repo) throw new Error("Use: github: issue owner/repo <title>\n<body>");
    const { first: title, body } = splitBody(issue[2]);
    return JSON.stringify(await createGitHubIssue({ data: { owner, repo, title, ...(body ? { body } : {}) } }), null, 2);
  }

  const actions = prompt.match(/^github:\s*actions\s+([^\s]+)(?:\s+([^\s]+))?\s*$/i);
  if (actions) {
    const [owner, repo] = actions[1].split("/");
    if (!owner || !repo) throw new Error("Use: github: actions owner/repo [branch]");
    return JSON.stringify(await getGitHubActions({ data: { owner, repo, ...(actions[2] ? { branch: actions[2] } : {}) } }), null, 2);
  }

  const workflow = prompt.match(/^github:\s*workflow\s+([^\s]+)\s+([^\s]+)(?:\s+([^\s]+))?\s*$/i);
  if (workflow) {
    const [owner, repo] = workflow[1].split("/");
    if (!owner || !repo) throw new Error("Use: github: workflow owner/repo workflow-file-or-id [branch]");
    return JSON.stringify(await dispatchGitHubWorkflow({ data: { owner, repo, workflow: workflow[2], ...(workflow[3] ? { branch: workflow[3] } : {}) } }), null, 2);
  }

  return undefined;
}

type AutoEdit = { path: string; content: string; message?: string };
type AutoPlan = { summary: string; files: AutoEdit[] };

function extractJson(text: string): AutoPlan {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Autonomous agent did not return a valid edit plan");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as AutoPlan;
  if (!parsed || typeof parsed.summary !== "string" || !Array.isArray(parsed.files)) throw new Error("Autonomous agent returned an invalid edit plan");
  return parsed;
}

function safeAutoPath(path: string) {
  return path.length > 0 && path.length <= 500 && !path.startsWith("/") && !path.includes("..") && !path.includes("\\");
}

async function readAutonomousSnapshot() {
  const results = await Promise.all(AUTONOMOUS_FILES.map(async (path) => {
    try {
      const file = await readGitHubFile({ data: { owner: "appleid7899067-netizen", repo: "Bosses", path } });
      return `===== ${path} =====\n${(file.content ?? "").slice(0, 14000)}`;
    } catch {
      return `===== ${path} =====\n[not found or not readable]`;
    }
  }));
  return results.join("\n\n");
}

async function runAutonomousAgent(data: FleetRequest, onDelta?: (full: string) => void, onActivity?: (activity: string[]) => void): Promise<ChatResult> {
  const task = data.prompt.replace(/^\s*ทำเลย\s*:\s*/i, "").trim();
  if (!task) return { ok: false, error: "ใช้แบบนี้: ทำเลย: <สิ่งที่ต้องการให้บอททำ>" };

  const repoStatus = await getGitHubStatus({ data: { owner: "appleid7899067-netizen", repo: "Bosses" } });
  const snapshot = await readAutonomousSnapshot();
  const plannerPrompt = `คุณคือ Autonomous Coding Agent ของ Bossnu SlieLo. งานนี้ต้องลงมือแก้จริงใน GitHub repo ${AUTONOMOUS_REPO} ไม่ใช่แค่แนะนำ.\n\nงานของผู้ใช้:\n${task}\n\nสถานะ repo:\n${JSON.stringify(repoStatus)}\n\nไฟล์ที่อ่านได้:\n${snapshot}\n\nกติกา:\n1. วิเคราะห์โค้ดก่อนแก้.\n2. ส่งกลับ JSON เท่านั้น รูปแบบ {"summary":"...","files":[{"path":"...","content":"...","message":"..."}]}.\n3. content ต้องเป็นเนื้อหาไฟล์ฉบับเต็มที่พร้อมเขียนทับ ไม่ใช่ diff.\n4. แก้เฉพาะไฟล์ที่จำเป็น.\n5. ห้ามสร้าง path นอก repo, ห้ามใช้ .. หรือ absolute path.\n6. ห้ามแตะ secrets, .env, private keys หรือ credential.\n7. ถ้าไม่จำเป็นต้องแก้ไฟล์ ให้ files เป็น [].\n8. ต้องรักษาโค้ดเดิมและแก้เฉพาะสิ่งที่งานร้องขอ.\n9. ถ้างานพูดถึง deploy ให้แก้และ commit ลง default branch; Vercel/GitHub integration จะเป็นผู้ deploy ต่อ.\n10. ตรวจ syntax/typing จากโค้ดที่เห็นก่อนส่ง.`;

  const planResult = await chatWithPuter({ messages: [
    { role: "system", content: "You are a precise autonomous software engineer. Return valid JSON only when asked." },
    { role: "user", content: plannerPrompt.slice(0, 60000) },
  ], model: data.modelId || "gpt-5.6-luna" });
  if (!planResult.ok) return planResult;

  let plan: AutoPlan;
  try { plan = extractJson(planResult.text); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Invalid autonomous plan" }; }

  if (plan.files.length > 6) return { ok: false, error: "Autonomous plan contains more than 6 file edits; no files were written." };
  const edits = plan.files.filter((file) => safeAutoPath(file.path) && typeof file.content === "string" && file.content.length <= 2_000_000);
  if (edits.length !== plan.files.length) return { ok: false, error: "Autonomous plan contained an unsafe or oversized file edit; no files were written." };

  const changed: string[] = [];
  const commitShas: string[] = [];
  const activity = ["🔍 วิเคราะห์", "🧰 เลือกเครื่องมือ", "⚙️ ลงมือทำ"];
  onActivity?.([...activity]);
  for (const edit of edits) {
    const current = await readGitHubFile({ data: { owner: "appleid7899067-netizen", repo: "Bosses", path: edit.path } }).catch(() => null);
    const result = await writeGitHubFile({ data: {
      owner: "appleid7899067-netizen", repo: "Bosses", path: edit.path, content: edit.content,
      message: (edit.message || `Bossnu SlieLo: ${task}`).slice(0, 200),
      ...(current?.sha ? { sha: current.sha } : {}),
    } });
    changed.push(`${edit.path} (${result?.commit?.sha ? result.commit.sha.slice(0, 7) : "committed"})`);
    if (result?.commit?.sha) commitShas.push(result.commit.sha);
    onActivity?.([...activity, "✏️ แก้ไข/บันทึกไฟล์", ...changed.map((item) => `↳ ${item}`)]);
  }

  onActivity?.([...activity, ...(changed.length ? ["✏️ แก้ไข/บันทึกไฟล์"] : ["📖 ตรวจสอบโดยไม่แก้ไฟล์"]), "🧪 ตรวจสอบ GitHub Actions"]);
  onActivity?.([...activity, "🧪 ตรวจสอบ GitHub Actions", "⏳ รอ CI ของ commit ล่าสุด"]);
  let actions = await getGitHubActions({ data: { owner: "appleid7899067-netizen", repo: "Bosses" } }).catch((error) => ({ total_count: 0, workflow_runs: [], error: error instanceof Error ? error.message : "Actions check failed" }));
  let latest = actions.workflow_runs?.slice(0, 20) ?? [];
  let verifiedRuns = commitShas.map((sha) => latest.find((run) => run.head_sha === sha)).filter(Boolean);
  for (let attempt = 0; commitShas.length && attempt < 30; attempt += 1) {
    verifiedRuns = commitShas.map((sha) => latest.find((run) => run.head_sha === sha)).filter(Boolean);
    const pending = verifiedRuns.some((run) => run?.status !== "completed") || verifiedRuns.length < commitShas.length;
    if (!pending) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    actions = await getGitHubActions({ data: { owner: "appleid7899067-netizen", repo: "Bosses" } }).catch((error) => ({ total_count: 0, workflow_runs: [], error: error instanceof Error ? error.message : "Actions check failed" }));
    latest = actions.workflow_runs?.slice(0, 20) ?? [];
  }
  const failedRun = commitShas.map((sha) => latest.find((run) => run.head_sha === sha)).find((run) => run?.status === "completed" && run.conclusion !== "success");
  const missingRun = commitShas.find((sha) => !latest.some((run) => run.head_sha === sha));
  const pendingRun = commitShas.find((sha) => {
    const run = latest.find((item) => item.head_sha === sha);
    return run && run.status !== "completed";
  });
  if (failedRun) {
    return { ok: false, error: `แก้ไฟล์แล้ว แต่ verification ไม่ผ่านสำหรับ commit ${failedRun.head_sha.slice(0, 7)}: ${failedRun.name} ${failedRun.conclusion}` };
  }
  if (missingRun || pendingRun) {
    return { ok: false, error: `แก้ไฟล์แล้ว แต่ยังยืนยัน CI ไม่ครบทุก commit: ${(missingRun || pendingRun || "").slice(0, 7)}` };
  }
  const latestRun = verifiedRuns[verifiedRuns.length - 1];
  activity.push(changed.length ? "✏️ แก้ไข/บันทึกไฟล์" : "📖 ตรวจสอบโดยไม่แก้ไฟล์");
  activity.push("🧪 ตรวจสอบ GitHub Actions");
  if (latestRun?.status === "completed" && latestRun.conclusion === "success") activity.push(`✅ Verification ผ่าน (${latestRun.head_sha.slice(0, 7)})`);
  onActivity?.([...activity]);
  const final = [
    `ทำงานอัตโนมัติเสร็จและผ่าน verification: ${plan.summary}`,
    changed.length ? `ไฟล์ที่ commit: ${changed.join(", ")}` : "ไม่มีไฟล์ที่ต้องแก้",
    latest.length ? `GitHub Actions ล่าสุด: ${latest.map((run) => `${run.name}: ${run.status}/${run.conclusion ?? "pending"}`).join(" | ")}` : "ไม่มี GitHub Actions run ให้ยืนยัน",
    "ถ้า repo ต่อกับ Vercel การ push นี้จะเป็นตัวกระตุ้น deployment ตามการตั้งค่าของ Vercel",
  ].join("\n");
  onDelta?.(final);
  return { ok: true, text: final, model: data.modelId || "gpt-5.6-luna", activity };
}

function isAutonomousRequest(prompt: string) {
  // Coding and repair work should execute automatically. The user should
  // not have to toggle Agents or learn a command syntax first.
  return /(?:ทำเลย\s*:|แก้(?:โค้ด|code|บั๊ก|bug|error|ปัญหา)|debug|fix\s+(?:the\s+)?(?:code|bug|error|project|app)|ตรวจ(?:โค้ด|code|บั๊ก|bug|โปรเจกต์|project|เว็บ)|ตรวจเว็บ|ตรวจโปรเจกต์|โปรเจกต์.*(?:พัง|เสีย|ล่ม|error)|เว็บ.*(?:พัง|ล่ม|error|502|500)|deploy(?:ment)?(?:\s+)?(?:ไม่ผ่าน|พัง|ล่ม|error|failed)|build.*(?:ไม่ผ่าน|พัง|error|failed)|(?:500|502|503)\b|stack\s*trace|typescript\s*error|runtime\s*error)/i.test(prompt);
}

export async function runFleet(data: FleetRequest, onDelta?: (full: string) => void, onActivity?: (activity: string[]) => void): Promise<ChatResult> {
  if (isAutonomousRequest(data.prompt)) return runAutonomousAgent(data, onDelta, onActivity);

  const githubContext = await runGitHubCommand(data.prompt).catch((error) => `GitHub tool error: ${error instanceof Error ? error.message : String(error)}`);
  const systemPrompt = SYSTEM_PROMPTS[data.mode as keyof typeof SYSTEM_PROMPTS] ?? SYSTEM_PROMPTS.chat;
  const userMessage = buildUserMessage(data, githubContext);

  // CodingFleet is an additive tool/model layer. If its public tool catalog is
  // unavailable or not callable, keep the existing Puter path as a safe fallback.
  try {
    const tools = await loadCodingFleetTools();
    if (tools.length > 0) {
      const history = (data.history ?? []).slice(-8)
        .map((turn) => `${turn.role}: ${typeof turn.content === "string" ? turn.content : JSON.stringify(turn.content)}`)
        .join("\n");
      const prompt = [
        `System instructions:\n${systemPrompt}`,
        history ? `Conversation history:\n${history}` : "",
        `Current user request:\n${userMessage}`,
      ].filter(Boolean).join("\n\n");
      const fleet = await callWithFallback(prompt, tools, data.modelId ? [data.modelId, "gpt-4o", "gemini-2.5-pro"] : undefined, onActivity);
      if (fleet.ok) {
        onDelta?.(fleet.text);
        const toolNames = fleet.toolCalls.map((call) => call.name).filter(Boolean).slice(0, 8); const activity = ["🧠 วิเคราะห์", "🧰 Tool Registry", ...(toolNames.length ? [`⚙️ ใช้เครื่องมือ: ${toolNames.join(", ")}`] : ["⚙️ ประมวลผล"]), ...(fleet.toolResults.length ? [`👀 Observe: ${fleet.toolResults.filter((item) => item.ok).length}/${fleet.toolResults.length} ผ่าน`] : []), "✅ ส่งผลลัพธ์"]; onActivity?.(activity); return { ok: true, text: fleet.text, model: fleet.model, activity };
      }
    }
  } catch {
    // Fall through to the existing Puter path; tool-catalog failure must not break chat.
  }

  return chatWithPuter({
    messages: [
      { role: "system", content: systemPrompt },
      ...(data.history ?? []).slice(-8),
      { role: "user", content: userMessage },
    ],
    model: data.modelId || "gpt-5.6-luna",
    onDelta,
  });
}
