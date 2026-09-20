export type PuterUser = {
  username?: string;
  uuid?: string;
  email?: string;
  requires_phone_verification?: boolean;
};

type PuterChatPart = { text?: string; message?: unknown };

type PuterAPI = {
  auth: {
    signIn: (opts?: { attempt_temp_user_creation?: boolean; request_auth?: boolean }) => Promise<unknown>;
    signOut: () => Promise<void> | void;
    isSignedIn: () => boolean;
    getUser: () => Promise<PuterUser>;
  };
  ai: { chat: (prompt: unknown, options?: Record<string, unknown>) => Promise<unknown>; listModels?: () => Promise<unknown> };
};

declare global { interface Window { puter?: PuterAPI } }

const SCRIPT_SRC = "https://js.puter.com/v2/";
const CREDENTIAL_POLICY = `
Credential policy for Bossnu SlieLo — universal credential handling:
- Treat every credential as sensitive, regardless of provider or format: API keys, access tokens, OAuth tokens, JWTs, passwords, client secrets, private keys/PEM, SSH keys, database URLs with passwords, webhook secrets, signing secrets, cookies, session tokens, service-account JSON, and cloud credentials.
- First determine the task/service that needs the credential. Do not make the customer repeat the whole task just because a credential is missing.
- If a connected tool can perform the task without customer credentials, use that connected tool immediately.
- If the required credential is missing, say exactly: which service needs access, what operation is blocked, and the exact environment-variable/secret name or connection field needed. Ask only for the minimum missing credential.
- Prefer a secure provider/hosting Secrets or connection UI. Never ask a customer to paste a private key, PEM, password, token, cookie, or service-account JSON into ordinary chat.
- If a customer accidentally sends a secret in chat, do not quote, repeat, summarize, log, or place it into code, GitHub, prompts, model context, browser storage, localStorage, or analytics. Treat it as compromised, recommend rotation, and continue with a secure connection path.
- Never invent credentials and never claim a credential was installed, connected, tested, or used unless a real tool result confirms it.
- Public IDs, repository names, project IDs, account IDs, and service IDs are not secrets and may be requested normally.
- Credential names must be task-specific when possible (for example OPENAI_API_KEY, DATABASE_URL, VERCEL_TOKEN, RENDER_API_KEY, GITHUB_APP_PRIVATE_KEY). Do not require a customer to know the variable name if the bot can identify it from the service/task.
- If the customer says they cannot configure secrets themselves, give the shortest secure setup path for the current provider/hosting and keep the task context intact; do not ask them to expose the secret in chat.
- A credential request must never be tied to a vague 'which job?' question. Preserve the current task and name the exact blocked step.
- Never expose or return the value of any credential, even after a successful connection. Confirm only the service, scope, and connection state.
`;

function isBrowser() { return typeof window !== "undefined"; }
export function getPuter(): PuterAPI | null { return isBrowser() ? window.puter ?? null : null; }

export function loadPuter(): Promise<PuterAPI> {
  if (!isBrowser()) return Promise.reject(new Error("Puter runs in the browser only."));
  if (window.puter) return Promise.resolve(window.puter);
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.puter) return resolve(window.puter);
      if (Date.now() - start > 12000) return reject(new Error("Puter.js loaded but did not initialize."));
      requestAnimationFrame(tick);
    };
    existing.addEventListener("error", () => reject(new Error("Failed to load Puter.js.")));
    tick();
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC; script.async = true;
    script.onload = () => {
      const start = Date.now();
      const tick = () => {
        if (window.puter) return resolve(window.puter);
        if (Date.now() - start > 8000) return reject(new Error("Puter.js loaded but did not initialize."));
        requestAnimationFrame(tick);
      }; tick();
    };
    script.onerror = () => reject(new Error("Failed to load Puter.js."));
    document.head.appendChild(script);
  });
}
export async function ensurePuter(): Promise<PuterAPI> { return getPuter() ?? loadPuter(); }

export function extractText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("");
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (typeof rec.content === "string") return rec.content;
    if (Array.isArray(rec.content)) return extractText(rec.content);
    if (rec.message) return extractText(rec.message);
    if (Array.isArray(rec.choices)) {
      const first = rec.choices[0] as Record<string, unknown> | undefined;
      if (first?.message) return extractText(first.message);
      if (typeof first?.text === "string") return first.text;
    }
  }
  return "";
}

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };
export type ChatResult = { ok: true; text: string; model: string; activity?: string[] } | { ok: false; error: string; activity?: string[] };

function withCredentialPolicy(messages: ChatTurn[]): ChatTurn[] {
  const index = messages.findIndex((m) => m.role === "system");
  if (index < 0) return [{ role: "system", content: CREDENTIAL_POLICY.trim() }, ...messages];
  return messages.map((m, i) => i === index && !m.content.includes("Credential policy for Bossnu SlieLo — universal credential handling:")
    ? { ...m, content: `${m.content}\n\n${CREDENTIAL_POLICY.trim()}` } : m);
}

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const lower = raw.toLowerCase();
  if (lower.includes("popup") || lower.includes("blocked")) return "Popup blocked. Allow popups for this site, then sign in with Puter.";
  if (lower.includes("auth_window_closed") || lower.includes("closed")) return "Sign-in window closed. Try again — Puter is required for free models.";
  if (lower.includes("not signed") || lower.includes("unauthorized") || lower.includes("auth")) return "Sign in with Puter to use free models.";
  return raw.slice(0, 240);
}

let signInInFlight: Promise<PuterUser | null> | null = null;

export async function signInWithPuter(forceReauth = false): Promise<PuterUser | null> {
  if (signInInFlight) return signInInFlight;
  signInInFlight = (async () => {
    const puter = await ensurePuter();
    if (puter.auth.isSignedIn() && !forceReauth) {
      try {
        const user = await puter.auth.getUser();
        if (user.requires_phone_verification) return null;
        return user;
      } catch { return null; }
    }
    await puter.auth.signIn(forceReauth ? { request_auth: true } : undefined);
    if (!puter.auth.isSignedIn()) return null;
    try {
      const user = await puter.auth.getUser();
      if (user.requires_phone_verification) return null;
      return user;
    } catch {
      return null;
    }
  })();
  try {
    return await signInInFlight;
  } finally {
    signInInFlight = null;
  }
}
export async function signOutPuter() { const puter = await ensurePuter(); await puter.auth.signOut(); }
export async function currentPuterUser(): Promise<PuterUser | null> {
  try {
    const puter = await ensurePuter();
    if (!puter.auth.isSignedIn()) return null;
    const user = await puter.auth.getUser();
    if (user.requires_phone_verification) return null;
    return user;
  } catch {
    return null;
  }
}

export async function chatWithPuter(opts: { messages: ChatTurn[]; model: string; onDelta?: (full: string) => void; provider?: string }): Promise<ChatResult> {
  let puter: PuterAPI;
  try { puter = await ensurePuter(); } catch (err) { return { ok: false, error: friendlyError(err) }; }
  if (!puter.auth.isSignedIn()) return { ok: false, error: "Puter ยังไม่ได้เข้าสู่ระบบ กรุณากด Sign in with Puter ก่อน แล้วจึงลองส่งอีกครั้ง" };
  try {
    const user = await puter.auth.getUser();
    if (user.requires_phone_verification) {
      return { ok: false, error: "Puter บัญชีนี้ยังมีสถานะต้องยืนยันเบอร์โทร แม้เพิ่งยืนยันแล้ว ให้กด Sign in with Puter อีกครั้งเพื่อรีเฟรชเซสชัน" };
    }
  } catch {
    return { ok: false, error: "Puter session ยังไม่พร้อม กรุณากด Sign in with Puter อีกครั้ง" };
  }
  const payload = withCredentialPolicy(opts.messages).map((m) => ({ role: m.role, content: m.content }));
  const run = async (stream: boolean) => {
    const resp = await puter.ai.chat(payload, { model: opts.model, stream, ...(opts.provider ? { provider: opts.provider } : {}) });
    if (stream && resp && typeof resp === "object" && Symbol.asyncIterator in (resp as object)) {
      let full = "";
      for await (const part of resp as AsyncIterable<PuterChatPart | string>) { const piece = typeof part === "string" ? part : extractText(part); if (!piece) continue; full += piece; opts.onDelta?.(full); }
      return full;
    }
    const text = extractText(resp); if (text) opts.onDelta?.(text); return text;
  };
  try {
    const text = await run(true); if (!text.trim()) return { ok: false, error: "Empty response from the model." }; return { ok: true, text, model: opts.model };
  } catch (err) {
    try { const text = await run(false); if (!text.trim()) return { ok: false, error: friendlyError(err) }; return { ok: true, text, model: opts.model }; }
    catch (err2) { return { ok: false, error: friendlyError(err2) }; }
  }
}


/**
 * Route a model through Puter's OpenRouter provider.
 * Puter documents this as a supported provider path, so the Boss can use
 * OpenRouter models without putting an OpenRouter API key in browser code.
 */
export async function chatWithOpenRouter(opts: {
  messages: ChatTurn[];
  model: string;
  onDelta?: (full: string) => void;
}): Promise<ChatResult> {
  const model = opts.model.replace(/^openrouter:/i, "").trim();
  if (!model) return { ok: false, error: "OpenRouter model is required." };
  return chatWithPuter({ ...opts, model, provider: "openrouter" });
}
