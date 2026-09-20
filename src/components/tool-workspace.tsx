import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, Sparkles, Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MarkdownOutput, extractFirstCode } from "@/components/markdown-output";
import { LanguagePicker, ModelPicker } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { runFleet } from "@/lib/ai";
import type { FleetTool } from "@/lib/catalog";
import { getActiveApiKey } from "@/lib/provider-keys";
import { usePuter } from "@/lib/puter-context";
import { useFleet } from "@/lib/store";

export function ToolWorkspace({ tool }: { tool: FleetTool }) {
  const language = useFleet((s) => s.language);
  const setLanguage = useFleet((s) => s.setLanguage);
  const modelId = useFleet((s) => s.modelId);
  const addGeneration = useFleet((s) => s.addGeneration);
  const { signedIn, signIn } = usePuter();
  const openRouterConnected = Boolean(getActiveApiKey());
  const canRun = signedIn || openRouterConnected;

  const [prompt, setPrompt] = useState(tool.samples[0]?.prompt ?? "");
  const [code, setCode] = useState(tool.samples[0]?.code ?? "");
  const [target, setTarget] = useState("Go");
  const [web, setWeb] = useState(false);
  const [exec, setExec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [files, setFiles] = useState<string[]>([]);

  async function generate() {
    if (!canRun) {
      if (!signedIn && !openRouterConnected) {
        try {
          await signIn();
        } catch {
          toast.error("ใส่ OpenRouter API key หรือ Sign in with Puter เพื่อใช้งาน");
          return;
        }
      }
    }
    setBusy(true);
    setOutput("");
    try {
      const extras = [
        web ? "Web access is enabled — use current public knowledge." : "",
        exec ? "Code execution is enabled — reason about running the snippet and expected stdout." : "",
        files.length ? `Attached files: ${files.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const res = await runFleet(
        {
          mode: tool.slug,
          prompt,
          code:
            tool.kind === "prompt-code" || tool.kind === "convert" || tool.kind === "diagram-to-code"
              ? code
              : code,
          language,
          targetLanguage: tool.kind === "convert" || tool.kind === "diagram-to-code" ? target : undefined,
          modelId,
          extras,
        },
        (full) => setOutput(full),
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOutput(res.text);
      addGeneration({
        tool: tool.slug,
        title: prompt.slice(0, 72) || tool.name,
        prompt,
        output: res.text,
        language: tool.kind === "convert" ? `${language} → ${target}` : language,
        model: res.model,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const first = extractFirstCode(output);

  return (
    <AppShell>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-subtle">Tool</p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">{tool.name}</h1>
          <p className="mt-2 max-w-prose text-sm text-muted">{tool.blurb}</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Model</Label>
              <ModelPicker />
            </div>
            <LanguagePicker
              value={language}
              onChange={setLanguage}
              label={tool.kind === "convert" ? "From" : "Language"}
            />
            {(tool.kind === "convert" || tool.kind === "diagram-to-code") && (
              <div className="sm:col-span-2">
                <LanguagePicker value={target} onChange={setTarget} label="To" />
              </div>
            )}
          </div>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="prompt">Instructions</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want…"
              className="min-h-24"
            />
          </div>

          {tool.kind !== "diagram" && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="code">{tool.kind === "diagram-to-code" ? "Diagram source" : "Code"}</Label>
                <button type="button" className="text-xs text-subtle hover:text-fg" onClick={() => setCode("")}>
                  Clear
                </button>
              </div>
              <Textarea
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={tool.kind === "diagram-to-code" ? "Paste mermaid or ASCII…" : "Paste source…"}
                className="min-h-44 font-mono text-sm"
              />
            </div>
          )}

          <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg bg-elevated px-3 py-3 text-sm text-muted shadow-[var(--shadow-border)]">
            <Upload className="size-4 text-primary" />
            <span>Drop files or a project zip — names only, stored in this browser.</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const names = [...(e.target.files ?? [])].map((f) => f.name);
                setFiles((prev) => [...prev, ...names].slice(0, 12));
              }}
            />
          </label>
          {files.length > 0 && <p className="mt-2 text-xs text-subtle">{files.join(" · ")}</p>}

          <div className="mt-4 rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]">
            <p className="text-xs font-medium text-muted">Advanced tools</p>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="block">Web access</span>
                  <span className="block text-xs text-subtle">Current docs and public pages.</span>
                </span>
                <Switch checked={web} onCheckedChange={setWeb} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="block">Code execution</span>
                  <span className="block text-xs text-subtle">Reason about running the snippet.</span>
                </span>
                <Switch checked={exec} onCheckedChange={setExec} />
              </label>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void generate()} disabled={busy} className="min-w-36">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {busy ? "Working" : tool.cta}
            </Button>
            <span className="text-xs text-subtle">{openRouterConnected ? "via OpenRouter" : "Free via Puter"}</span>
          </div>

          {tool.samples.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {tool.samples.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="rounded-full bg-elevated px-3 py-1 text-xs text-muted shadow-[var(--shadow-border)] hover:text-fg"
                  onClick={() => {
                    setPrompt(s.prompt);
                    if (s.code) setCode(s.code);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          <div className="flex h-full min-h-80 flex-col rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] lg:p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Output</p>
              {first && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/runner?lang=${encodeURIComponent(first.lang)}`}>
                    Open in runner <ArrowRight className="size-3.5" />
                  </a>
                </Button>
              )}
            </div>
            {busy && <div className="fleet-shimmer h-1 rounded-full" />}
            {output ? (
              <MarkdownOutput text={output} className="flex-1 overflow-auto" />
            ) : (
              <div className="flex flex-1 items-center justify-center text-center text-sm text-subtle">
                {busy ? "Writing…" : canRun ? "Output lands here after you run the tool." : "ใส่ OpenRouter key หรือ Sign in with Puter ก่อน"}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
