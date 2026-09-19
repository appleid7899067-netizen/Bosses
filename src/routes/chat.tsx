import { createFileRoute } from "@tanstack/react-router";
import { Bot, Code2, FileText, Globe, Loader2, Pin, Plus, Send, Sparkles, Trash2 } from "lucide-react";
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

  async function send() {
    if (!thread || !draft.trim() || busy) return;
    if (!signedIn) {
      try {
        await signIn();
      } catch {
        toast.error("Sign in with Puter to chat. Allow popups if blocked.");
        return;
      }
    }
    const text = normalizeToolPrompt(draft.trim(), thread.mcp);
    setDraft("");
    appendMessage(thread.id, { role: "user", content: text });
    setBusy(true);
    const activity: string[] = [];
    if (thread.tools.web) activity.push("Web");
    if (thread.tools.code) activity.push("Code exec");
    if (thread.tools.files) activity.push("Files");
    if (thread.tools.agents) activity.push("Agents ×" + AGENTS.length);
    thread.mcp.forEach((m) => activity.push("MCP " + m));

    const traceTimer = { current: undefined as ReturnType<typeof setTimeout> | undefined };
    const liveTrace = ["🔍 วิเคราะห์คำขอ", "🧰 เลือกเครื่องมือ", "⚙️ กำลังทำงาน"];
    const assistantId = appendMessage(thread.id, {
      role: "assistant",
      content: "",
      model: modelById(modelId).id,
      activity: [...activity, ...liveTrace.slice(0, 1)],
    });
    const scheduleTrace = (index: number) => {
      if (index >= liveTrace.length) return;
      traceTimer.current = setTimeout(() => {
        patchActivity(thread.id, assistantId, [...activity, ...liveTrace.slice(0, index + 1)]);
        scheduleTrace(index + 1);
      }, 900);
    };
    scheduleTrace(1);

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
      if (traceTimer.current) clearTimeout(traceTimer.current);
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
              <div className="flex items-end gap-2 rounded-lg bg-elevated p-2 shadow-[var(--shadow-border)]">
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
                <Button size="icon" onClick={() => void send()} disabled={busy || !draft.trim()} aria-label="Send">
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
