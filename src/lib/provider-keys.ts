export type ProviderId = "openrouter" | "puter" | "unknown";

export type ProviderDetection = {
  provider: ProviderId;
  label: string;
  detail: string;
};

export type PuterModel = {
  id: string;
  provider?: string;
  name?: string;
  aliases?: string[];
  context?: number;
  max_tokens?: number;
};

export type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

let memoryKey: string | null = null;

function sessionGet() {
  try { return sessionStorage.getItem("bosses.ai.apiKey"); } catch { return null; }
}
function sessionSet(value: string | null) {
  try {
    if (value) sessionStorage.setItem("bosses.ai.apiKey", value);
    else sessionStorage.removeItem("bosses.ai.apiKey");
  } catch {}
}

export function getActiveApiKey() {
  return memoryKey ?? sessionGet();
}

export function clearActiveApiKey() {
  memoryKey = null;
  sessionSet(null);
}

export function detectKeyShape(key: string): ProviderDetection {
  const value = key.trim();
  if (/^sk-or-/i.test(value)) return { provider: "openrouter", label: "OpenRouter", detail: "OpenRouter key detected. This unlocks the OpenRouter catalog, including models from many providers." };
  if (/^sk-ant-/i.test(value)) return { provider: "unknown", label: "Anthropic", detail: "Anthropic-shaped key detected. Direct Anthropic routing is not enabled by this key slot yet." };
  if (/^gsk_/i.test(value)) return { provider: "unknown", label: "Groq", detail: "Groq-shaped key detected. Direct Groq routing is not enabled by this key slot yet." };
  if (/^xai-/i.test(value)) return { provider: "unknown", label: "xAI", detail: "xAI-shaped key detected. Direct xAI routing is not enabled by this key slot yet." };
  if (/^AIza/i.test(value)) return { provider: "unknown", label: "Google", detail: "Google-shaped key detected. Direct Google routing is not enabled by this key slot yet." };
  if (/^sk-[A-Za-z0-9_-]+$/i.test(value)) return { provider: "unknown", label: "OpenAI-compatible / ambiguous", detail: "This key format is shared by multiple services, so Boss will not guess the provider from the string alone." };
  return { provider: "unknown", label: "Unknown provider", detail: "The key format is not uniquely identifiable. Boss will not guess or send it to random services." };
}

export async function fetchPuterModelCatalog(): Promise<PuterModel[]> {
  const response = await fetch("https://api.puter.com/puterai/chat/models/details", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Puter model catalog unavailable (${response.status})`);
  const data = await response.json() as { models?: PuterModel[] };
  return Array.isArray(data.models) ? data.models : [];
}

function modelKeys(model: PuterModel): string[] {
  return [model.id, ...(model.aliases ?? [])].map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function filterOpenRouterToPuterModels(openRouterModels: OpenRouterModel[], puterModels: PuterModel[]): OpenRouterModel[] {
  // Important: the OpenRouter key authenticates OpenRouter. Puter is used only
  // as the source of truth for which model IDs are exposed by Puter. We never
  // pretend that an OpenRouter key is a Puter credential.
  const puterKeys = new Set(puterModels.flatMap(modelKeys));
  return openRouterModels.filter((model) => {
    const id = model.id.trim().toLowerCase();
    const bare = id.replace(/^~?[^/]+\\//, "");
    return puterKeys.has(id) || puterKeys.has(bare) || puterKeys.has(model.id.split("/").pop()?.toLowerCase() ?? "");
  });
}

export async function verifyOpenRouterKey(key: string): Promise<{ ok: true; models: OpenRouterModel[] } | { ok: false; error: string }> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key.trim()}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `OpenRouter rejected the key (${response.status})${body ? `: ${body.slice(0, 180)}` : ""}` };
  }
  const data = await response.json() as { data?: OpenRouterModel[] };
  const openRouterModels = Array.isArray(data.data) ? data.data : [];
  try {
    const puterModels = await fetchPuterModelCatalog();
    return { ok: true, models: filterOpenRouterToPuterModels(openRouterModels, puterModels) };
  } catch (error) {
    return {
      ok: false,
      error: `OpenRouter key ผ่าน แต่โหลดรายการโมเดล Puter ไม่สำเร็จ: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export async function connectApiKey(key: string): Promise<{ detection: ProviderDetection; models: OpenRouterModel[] }> {
  const value = key.trim();
  if (!value) throw new Error("API key is empty.");
  if (!/^sk-or-/i.test(value)) throw new Error("ต้องใช้ OpenRouter API key (sk-or-...)");
  const detection = detectKeyShape(value);
  if (detection.provider !== "openrouter") {
    throw new Error(`${detection.label}: ${detection.detail}`);
  }
  const verified = await verifyOpenRouterKey(value);
  if (!verified.ok) throw new Error(verified.error);

  // OpenRouter authenticates the request. Puter supplies the model catalog.
  // Only models exposed by both services are offered in this gateway mode.
  let puterModels: PuterModel[] = [];
  try {
    puterModels = await fetchPuterModelCatalog();
  } catch (error) {
    throw new Error(
      `เชื่อม OpenRouter ได้ แต่โหลดรายการโมเดล Puter ไม่สำเร็จ: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const puterCompatibleModels = filterOpenRouterToPuterModels(verified.models, puterModels);
  if (!puterCompatibleModels.length) {
    throw new Error("OpenRouter key ใช้งานได้ แต่ไม่พบโมเดลที่มีอยู่ทั้งใน Puter และ OpenRouter จึงยังไม่เปิดการเรียกโมเดล Puter ผ่าน gateway");
  }

  memoryKey = value;
  sessionSet(value);
  return { detection, models: verified.models };
}

export function chooseOpenRouterModel(models: OpenRouterModel[], prompt: string): OpenRouterModel | null {
  if (!models.length) return null;
  const p = prompt.toLowerCase();
  const coding = /code|coding|debug|bug|error|repo|github|typescript|javascript|python|rust|go|java|sql|deploy|fix|แก้|โค้ด|บั๊ก|โปรเจกต์|เว็บ/.test(p);
  const preferred = coding
    ? ["openai/", "anthropic/", "google/", "deepseek/", "qwen/", "x-ai/", "mistralai/"]
    : ["openai/", "google/", "anthropic/", "deepseek/", "qwen/"];
  for (const prefix of preferred) {
    const found = models.find((m) => m.id.startsWith(prefix) && !/image|audio|video|embedding|rerank|transcription/i.test(m.id));
    if (found) return found;
  }
  return models.find((m) => !/image|audio|video|embedding|rerank|transcription/i.test(m.id)) ?? models[0];
}

export async function callOpenRouter(opts: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  onDelta?: (full: string) => void;
}) {
  const key = getActiveApiKey();
  if (!key) return { ok: false as const, error: "No OpenRouter API key is connected." };
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": typeof location !== "undefined" ? location.origin : "https://bosses690.vercel.app",
      "X-Title": "Bossnu SlieLo",
    },
    body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false as const, error: `OpenRouter error ${response.status}: ${body.slice(0, 500)}` };
  }
  if (!response.body) return { ok: false as const, error: "OpenRouter returned no response stream." };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const piece = data.choices?.[0]?.delta?.content ?? "";
        if (piece) { full += piece; opts.onDelta?.(full); }
      } catch {}
    }
  }
  if (!full.trim()) return { ok: false as const, error: "OpenRouter returned an empty response." };
  return { ok: true as const, text: full, model: opts.model };
}
