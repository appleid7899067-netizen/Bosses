import { useState } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectApiKey, clearActiveApiKey, detectKeyShape, getActiveApiKey, isPuterCatalogModel } from "@/lib/provider-keys";

export function ProviderKeyBar() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState(() => getActiveApiKey() ? "OpenRouter connected" : "");
  const [busy, setBusy] = useState(false);

  async function connect() {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    try {
      const detection = detectKeyShape(key);
      if (detection.provider !== "openrouter") {
        throw new Error(detection.detail);
      }
      const result = await connectApiKey(key);
      const puterCatalogMatches = result.models.filter((model) => isPuterCatalogModel(model.id)).length;\n      setStatus(`${result.detection.label} · ${result.models.length} models · Puter catalog ${puterCatalogMatches}`);
      setValue("");
      toast.success(`OpenRouter พร้อมใช้งาน · พบโมเดลที่มีใน Puter ${puterCatalogMatches} รายการ`);
    } catch (error) {
      setStatus("");
      toast.error(error instanceof Error ? error.message : "ตรวจคีย์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    clearActiveApiKey();
    setStatus("");
    setValue("");
    toast.success("ถอด OpenRouter key แล้ว");
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated/50 p-2">
      <KeyRound className="size-4 text-primary" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void connect(); }}
        type="password"
        autoComplete="off"
        placeholder="ใส่ OpenRouter key (sk-or-...) · ไม่ต้องล็อกอิน Puter"
        className="min-w-[14rem] flex-1 border-0 bg-transparent shadow-none"
      />
      <Button size="sm" onClick={() => void connect()} disabled={busy || !value.trim()}>
        {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
        ตรวจคีย์
      </Button>
      {status ? (
        <>
          <Badge variant="ok">{status}</Badge>
          <Button size="icon-sm" variant="ghost" onClick={disconnect} aria-label="Disconnect API key"><X className="size-4" /></Button>
        </>
      ) : null}
    </div>
  );
}
