import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, TerminalSquare, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type SandboxPreviewProps = { files?: File[] };

type WebContainerInstance = {
  mount(files: Record<string, unknown>): Promise<void>;
  spawn(command: string, args?: string[]): Promise<{ exit: Promise<number> }>;
  on(event: "server-ready", listener: (port: number, url: string) => void): void;
  teardown(): Promise<void>;
};

export function SandboxPreview({ files = [] }: SandboxPreviewProps) {
  const containerRef = useRef<WebContainerInstance | null>(null);
  const processRef = useRef<{ exit: Promise<number> } | null>(null);
  const [status, setStatus] = useState("พร้อมรัน");
  const [url, setUrl] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function bootAndRun() {
    setStatus("กำลังเปิด Sandbox...");
    setLogs([]);
    setUrl("");
    setError("");
    try {
      const loadWebContainer = new Function("return import('https://esm.sh/@webcontainer/api@1.6.4')") as () => Promise<{ WebContainer: { boot(): Promise<WebContainerInstance> } }>;
      const { WebContainer } = await loadWebContainer();
      const container = await WebContainer.boot();
      containerRef.current = container as WebContainerInstance;
      const projectFiles: Record<string, unknown> = {};
      for (const file of files.slice(0, 40)) {
        if (file.name.toLowerCase().endsWith(".zip")) continue;
        const readable = file.type.startsWith("text/") || /\.(json|js|jsx|ts|tsx|css|html|md|txt|yml|yaml|xml|py|go|rs|java|sql)$/i.test(file.name);
        if (!readable || file.size > 2_000_000) continue;
        projectFiles[file.name.replace(/^[/\\\\]+/, "")] = { file: { contents: await file.text() } };
      }
      if (!projectFiles["package.json"]) projectFiles["package.json"] = { file: { contents: JSON.stringify({
        scripts: { dev: "vite --host 0.0.0.0" },
        dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest", "react-dom": "latest" },
      }, null, 2) } };
      if (!projectFiles["index.html"]) projectFiles["index.html"] = { file: { contents: '<div id="root"></div><script type="module" src="/src/main.jsx"></script>' } };
      if (!projectFiles["src/main.jsx"]) projectFiles["src/main.jsx"] = { file: { contents: "import React from 'react'; import {createRoot} from 'react-dom/client'; const App=()=>React.createElement('main',{style:{padding:40,fontFamily:'system-ui'}},React.createElement('h1',null,'Boss Sandbox'),React.createElement('p',null,'Runtime is running.')); createRoot(document.getElementById('root')).render(React.createElement(App));" } };
      await container.mount(projectFiles);
      setStatus("กำลังติดตั้ง dependencies...");
      setLogs([files.length ? `mount: ${files.length} attached file(s)` : "mount: starter project", "npm install"]);
      processRef.current = await container.spawn("npm", ["install"]);
      const installCode = await processRef.current.exit;
      if (installCode !== 0) throw new Error("npm install failed");
      container.on("server-ready", (_port, serverUrl) => {
        setUrl(serverUrl);
        setStatus("Preview พร้อมใช้งาน");
        setLogs((current) => [...current, "server-ready: " + serverUrl]);
      });
      setStatus("กำลังรัน Vite...");
      processRef.current = await container.spawn("npm", ["run", "dev"]);
      void processRef.current.exit.then((code) => {
        if (code !== 0) {
          setStatus("Sandbox process error");
          setLogs((current) => [...current, "vite exit: " + code]);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox failed";
      setStatus("Sandbox ล้มเหลว");
      setError(message);
      setLogs((current) => [...current, message]);
    }
  }

  async function reset() {
    try {
      await containerRef.current?.teardown?.();
    } catch {}
    containerRef.current = null;
    processRef.current = null;
    setUrl("");
    setLogs([]);
    setError("");
    setStatus("พร้อมรัน");
  }

  useEffect(() => () => { void reset(); }, []);

  return (
    <section className="rounded-xl border border-border bg-elevated/40 p-3">
      <div className="flex items-center gap-2">
        <TerminalSquare className="size-4" />
        <span className="text-sm font-medium">Live Sandbox</span>
        <span className="ml-auto text-xs text-muted">{status}</span>
        <Button size="sm" variant="outline" onClick={() => void bootAndRun()}><Play className="mr-1 size-3" />Run</Button>
        <Button size="icon-sm" variant="ghost" onClick={() => void reset()} aria-label="Reset sandbox"><RotateCcw className="size-3" /></Button>
      </div>
      {error && <div className="mt-2 flex items-start gap-2 rounded bg-danger/10 p-2 text-[11px] text-danger"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></div>}{logs.length > 0 && <pre className="mt-2 max-h-24 overflow-auto rounded bg-black/40 p-2 text-[11px]">{logs.join("\n")}</pre>}
      {url ? <iframe title="Boss live preview" src={url} className="mt-3 h-72 w-full rounded-lg border bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" /> : <div className="mt-3 flex h-28 items-center justify-center rounded-lg border border-dashed text-xs text-muted">กด Run เพื่อเปิด runtime และ Preview จริง</div>}
    </section>
  );
}
