import { createFileRoute } from "@tanstack/react-router";
import { Archive, Bot, Code2, FileText, Globe, Loader2, Paperclip, Pin, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { MarkdownOutput } from "@/components/markdown-output";
import { ModelPicker } from "@/components/pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { runFleet } from "@/lib/ai";
import { AGENTS, MCP_SERVERS, modelById } from "@/lib/catalog";
import { usePuter } from "@/lib/puter-context";
import { useFleet } from "@/lib/store";

export const Route = createFileRoute("/chat")({ component: ChatPage });

const DEFAULT_GITHUB_REPO = "appleid7899067-netizen/Bosses";

function normalizeToolPrompt(text: string, mcp: string[]) {
  if (!mcp.includes("github")) return text;
  const p = text.trim();
  if (/^github:\s*/i.test(p)) return p;

  const repo = p.match(/(?:repo|repository)\s+([\w.-]+\/[\w.-]+)/i)?.[1] ?? DEFAULT_GITHUB_REPO;
  if (/^(?:ตรวจ|เช็ค|ดู|show|check)\b.*(?:repo|repository|github|สถานะ)/i.test(p) || /(?:github|repo).*(?:status|สถานะ)/i.test(p)) {
    return `github: status ${repo}`;
  }
  if (/(?:actions|workflow|ci|github actions|การทำงานล่าสุด)/i.test(p)) {
    return `github: actions ${repo}`;
  }
  const read = p.match(/(?:อ่าน|เปิด|read|open)\s+(?:ไฟล์|file)?\s*([\w./-]+)(?:\s+(?:ref|branch)\s+([\w./-]+))?/i);
  if (read) {
    return `github: read ${repo}/${read[1]}${read[2] ? ` ${read[2]}` : ""}`;
  }
  return text;
}

function ChatPage() {
  const threads = useFleet((s) => s.threads);
  const activeThreadId = useFleet((s) => s.activeThreadId);
  const newThread = useFleet((s) => s.newThread);
  const setActiveThread = useFleet((s) => s.setActiveThread);
  const pinThread = useFleet((s) => s.pinThread);
  const deleteThread = useFleet((s) => s.deleteThread);
  const appendMessage = useFleet((s) => s.appendMessage);
  const patchMessage = useFleet((s) => s.patchMessage);
  const patchActivity = useFleet((s) => s.patchActivity);
  const updateTools = useFleet((s) => s.updateTools);
  const toggleMcp = useFleet((s) => s.toggleMcp);
  const modelId = useFleet((s) => s.modelId);
  const memory = useFleet((s) => s.memory);
  const { signedIn, signIn } = usePuter();

  const thread = threads.find((t) => t.id === activeThreadId) ?? threads[0];
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Array<{ file: File; url?: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () =>
      [...threads].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.updatedAt - a.updatedAt;
      }),
    [threads],
  );

  function addFiles(files: File[]) {
    const next = files.slice(0, 8);
    setAttachments((current) => [...current, ...next].slice(0, 8));
    setPreviews((current) => [...current, ...next.map((file) => ({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined }))].slice(0, 8));
  }

  async function describeAttachment(file: File): Promise<string> {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);
      const decoder = new TextDecoder();
      const files: string[] = [];
      let totalChars = 0;

      for (let i = 0; i + 46 <= bytes.length && files.length < 50; i++) {
        if (view.getUint32(i, true) !== 0x02014b50) continue;
        const method = view.getUint16(i + 10, true);
        const compressedSize = view.getUint32(i + 20, true);
        const nameLen = view.getUint16(i + 28, true);
        const extraLen = view.getUint16(i + 30, true);
        const commentLen = view.getUint16(i + 32, true);
        const localOffset = view.getUint32(i + 42, true);
        const name = decoder.decode(bytes.slice(i + 46, i + 46 + nameLen));
        i += 45 + nameLen + extraLen + commentLen;
        if (!name || name.endsWith("/") || /(^|\/)(node_modules|\.git|dist|build)(\/|$)/i.test(name)) continue;
        if (!/\.(md|txt|json|js|jsx|ts|tsx|css|html|xml|yml|yaml|csv|py|go|rs|java|sql|env)$/i.test(name)) continue;
        if (compressedSize > 2_000_000 || localOffset + 30 > bytes.length) continue;
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressed = bytes.slice(dataStart, dataStart + compressedSize);
        let content = "";
        try {
          if (method === 0) content = decoder.decode(compressed);
          else if (method === 8 && "DecompressionStream" in globalThis) {
            const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
            content = decoder.decode(await new Response(stream).arrayBuffer());
          }
        } catch {
          content = "";
        }
        if (!content) continue;
        const remaining = 60000 - totalChars;
        if (remaining <= 0) break;
        const clipped = content.slice(0, remaining);
        files.push(`\\n### ${name}\\n${clipped}`);
        totalChars += clipped.length;
      }
      if (files.length) return `ZIP extracted text files (${files.length}):${files.join("")}${totalChars >= 60000 ? "\\n[ZIP content truncated at 60,000 characters]" : ""}`;
      return "ZIP attached, but no readable text/code entries could be extracted in this browser.";
    }
    if (file.type.startsWith("text/") || /\.(md|txt|json|js|jsx|ts|tsx|css|html|xml|yml|yaml|csv|py|go|rs|java|sql|env)$/i.test(file.name)) {
      const text = await file.text();
      return "File content: " + text.slice(0, 60000) + (text.length > 60000 ? "\n[truncated at 60,000 characters]" : "");
    }
    return "Binary attachment: " + file.name + " (" + (file.type || "unknown") + ")";
  }
  function removeAttachment(index: number) {
    setPreviews((current) => { const item = current[index]; if (item?.url) URL.revokeObjectURL(item.url); return current.filter((_, i) => i !== index); });
    setAttachments((current) => current.filter((_, i) => i !== index));
  }

  async function send() {
    if (!thread || (!draft.trim() && attachments.length === 0) || busy) return;
    if (!signedIn) {
      try {
        await signIn();
      } catch {
        toast.error("Sign in with Puter to chat. Allow popups if blocked.");
        return;
      }
    }
    const attachmentDetails = attachments.length
      ? await Promise.all(
          attachments.map(async (f) =>
            `- ${f.name} (${f.type || "unknown"}, ${Math.ceil(f.size / 1024)} KB)\\n  ${await describeAttachment(f)}`,
          ),
        )
      : [];
    const attachmentContext = attachmentDetails.length
      ? `\\n\\nAttached files:\\n${attachmentDetails.join("\\n")}`
      : "";
    const text = normalizeToolPrompt((draft.trim() || "Analyze the attached files") + attachmentContext, thread.mcp);
    setDraft("");
    setAttachments([]);
    setPreviews([]);
    appendMessage(thread.id, { role: "user", content: text, attachments: attachments.map((file) => ({ name: file.name, size: file.size, type: file.type })) });
    setBusy(true);
    const activity: string[] = [];
    if (thread.tools.web) activity.push("Web");
    if (thread.tools.code) activity.push("Code exec");
    if (thread.tools.files) activity.push("Files");
    if (thread.tools.agents) activity.push("Agents ×" + AGENTS.length);
    thread.mcp.forEach((m) => activity.push("MCP " + m));

    const liveTrace = [...activity, "🔍 วิเคราะห์คำขอ"];
    const assistantId = appendMessage(thread.id, {
      role: "assistant",
      content: "",
      model: modelById(modelId).id,
      activity: liveTrace,
    });
    const pushActivity = (next: string[]) => {
      patchActivity(thread.id, assistantId, next);
    };
    try {
      const history = thread.messages
        .filter((m) => m.content.trim())
        .slice(-8)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const extras = [
        `Active tools: ${JSON.stringify(thread.tools)}`,
        thread.mcp.length ? `MCP: ${thread.mcp.join(", ")}` : "",
        memory.length ? `Memory: ${memory.map((m) => m.text).join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const res = await runFleet(
        {
          mode: thread.tools.agents ? "agents" : "chat",
          prompt: text,
          modelId,
          extras,
          history,
        },
        (full) => patchMessage(thread.id, assistantId, full),
        pushActivity,
      );
      if (!res.ok) {
        if (res.activity) patchActivity(thread.id, assistantId, res.activity);
        toast.error(res.error);
        patchMessage(thread.id, assistantId, `Could not complete that turn.\n\n${res.error}`);
        return;
      }
      if (res.activity) patchActivity(thread.id, assistantId, res.activity);
      patchMessage(thread.id, assistantId, res.text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chat failed");
      patchMessage(
        thread.id,
        assistantId,
        err instanceof Error ? err.message : "Chat failed",
      );
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
      });
    }
  }

  if (!thread) return null;

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-6xl">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
          <div className="flex items-center justify-between p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Chats</p>
            <Button size="icon-sm" variant="ghost" aria-label="New chat" onClick={() => newThread()}>
              <Plus className="size-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-0.5 px-2 pb-4">
              {sorted.map((t) => (
                <div
                  key={t.id}
                  className={`group flex items-center gap-1 rounded-md px-2 py-2 text-left text-sm ${
                    t.id === thread.id ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/60 hover:text-fg"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => setActiveThread(t.id)}
                  >
                    {t.pinned ? "· " : ""}
                    {t.title}
                  </button>
                  <button
                    type="button"
                    className="hidden size-7 items-center justify-center rounded-sm group-hover:flex hover:bg-bg"
                    onClick={() => pinThread(t.id)}
                    aria-label="Pin"
                  >
                    <Pin className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="hidden size-7 items-center justify-center rounded-sm text-subtle group-hover:flex hover:text-danger"
                    onClick={() => deleteThread(t.id)}
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <ModelPicker compact />
            <div className="ml-auto flex items-center gap-1 md:hidden">
              <Button size="icon-sm" variant="ghost" onClick={() => newThread()} aria-label="New chat">
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto max-w-2xl space-y-5">
              {thread.messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "ml-8" : "mr-4"}>
                  <p className="mb-1 text-xs uppercase tracking-wider text-subtle">
                    {m.role === "user" ? "You" : "Copilot"}
                    {m.model ? ` · ${m.model}` : ""}
                  </p>
                  {m.attachments && m.attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{m.attachments.map((file) => <Badge key={`${m.id}-${file.name}`}>📎 {file.name}</Badge>)}</div>}
                  {m.activity && m.activity.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {m.activity.map((a) => (
                        <Badge key={a}>{a}</Badge>
                      ))}
                    </div>
                  )}
                  <div
                    className={
                      m.role === "user"
                        ? "rounded-lg bg-elevated px-3 py-2 text-sm shadow-[var(--shadow-border)]"
                        : ""
                    }
                  >
                    {m.role === "assistant" ? (
                      m.content ? (
                        <MarkdownOutput text={m.content} />
                      ) : (
                        <span className="text-sm text-muted">Thinking…</span>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  {thread.tools.agents ? "Agents running…" : "Streaming from Puter…"}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border px-3 py-3">
            <div className="mx-auto max-w-2xl">
              <div className="mb-2 flex flex-wrap gap-3">
                <ToolToggle
                  icon={Globe}
                  label="Web"
                  on={thread.tools.web}
                  onChange={(v) => updateTools(thread.id, { ...thread.tools, web: v })}
                />
                <ToolToggle
                  icon={Code2}
                  label="Code"
                  on={thread.tools.code}
                  onChange={(v) => updateTools(thread.id, { ...thread.tools, code: v })}
                />
                <ToolToggle
                  icon={FileText}
                  label="Files"
                  on={thread.tools.files}
                  onChange={(v) => updateTools(thread.id, { ...thread.tools, files: v })}
                />
                <ToolToggle
                  icon={Bot}
                  label="Agents"
                  on={thread.tools.agents}
                  onChange={(v) => updateTools(thread.id, { ...thread.tools, agents: v })}
                />
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {MCP_SERVERS.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleMcp(thread.id, s.id)}
                    title={s.id === "github" ? "GitHub is live: use 'ตรวจ repo' or 'github: status owner/repo'" : s.blurb}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      thread.mcp.includes(s.id) ? "bg-primary/15 text-primary" : "bg-elevated text-subtle"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              {previews.length > 0 && <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{previews.map((item, index) => <div key={`${item.file.name}-${index}`} className="relative overflow-hidden rounded-lg border border-border bg-elevated p-2">{item.url ? <img src={item.url} alt={item.file.name} className="h-24 w-full rounded object-cover" /> : <div className="flex h-24 flex-col items-center justify-center gap-1 text-muted">{item.file.name.toLowerCase().endsWith(".zip") ? <Archive className="size-7" /> : <FileText className="size-7" />}<span className="max-w-full truncate text-xs">{item.file.name}</span></div>}<button type="button" onClick={() => removeAttachment(index)} className="absolute right-1 top-1 rounded-full bg-bg/90 p-1" aria-label={`Remove ${item.file.name}`}><X className="size-3" /></button></div>)}</div>}
              <div className="flex items-end gap-2 rounded-lg bg-elevated p-2 shadow-[var(--shadow-border)]">
                <input ref={fileInputRef} type="file" multiple accept="image/*,.zip,.pdf,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.css,.html" className="hidden" onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.currentTarget.value = ""; }} />
                <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} aria-label="Attach files"><Paperclip className="size-4" /></Button>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={signedIn ? "Ask Copilot…  Shift+Enter for a newline" : "Sign in with Puter, then ask…"}
                  className="min-h-12 border-0 bg-transparent shadow-none focus-visible:shadow-none"
                  rows={2}
                />
                <Button size="icon" onClick={() => void send()} disabled={busy || (!draft.trim() && attachments.length === 0)} aria-label="Send">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
              <p className="mt-2 flex items-center gap-1 text-xs text-subtle">
                <Sparkles className="size-3" />
                Enter send · Shift+Enter newline · Free via Puter
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ToolToggle({
  icon: Icon,
  label,
  on,
  onChange,
}: {
  icon: typeof Globe;
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <Icon className="size-3.5 text-primary" />
      {label}
      <Switch checked={on} onCheckedChange={onChange} />
    </label>
  );
}
