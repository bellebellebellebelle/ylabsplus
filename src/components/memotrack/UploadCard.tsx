import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { UploadCloud, Loader2, Check, AudioLines, Brain, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const STAGES = [
  { key: "transcribe", label: "Transcription", icon: AudioLines },
  { key: "analyze", label: "Analyse & mémo", icon: Brain },
  { key: "save", label: "Enregistrement", icon: Database },
];

export function UploadCard() {
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const busy = !!stage && stage !== "error";

  function pick(f?: File | null) {
    setError("");
    if (!f) return;
    if (!f.type.startsWith("audio/") && !/\.(mp3|m4a|wav|webm|ogg|aac|flac)$/i.test(f.name))
      return setError("Format non supporté : importez un fichier audio.");
    if (f.size > 14 * 1024 * 1024) return setError("Fichier trop volumineux (14 Mo max).");
    setFile(f);
  }

  async function run() {
    if (!file) return;
    setError("");
    setStage("upload");
    const { data } = await supabase.auth.getSession();
    const fd = new FormData();
    fd.append("file", file);
    fd.append("date", date);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: fd,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Échec de l'envoi.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l);
          if (ev.stage === "error") throw new Error(ev.error);
          setStage(ev.stage);
          if (ev.stage === "done") {
            setFile(null);
            setStage(null);
            nav({ to: "/memo/$id", params: { id: ev.id } });
            return;
          }
        }
      }
      throw new Error("L'analyse s'est interrompue.");
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    }
  }

  const idx = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="glass holo-border flex h-full flex-col p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Nouvelle réunion</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy}
          className="rounded-lg border border-input bg-glass px-2 py-1 text-xs text-muted-foreground outline-none" />
      </div>

      {busy ? (
        <div className="mt-6 flex flex-1 flex-col justify-center gap-4">
          {STAGES.map((s, i) => {
            const done = i < idx, active = i === idx || (stage === "upload" && i === 0);
            return (
              <div key={s.key} className={`flex items-center gap-3 transition ${active || done ? "opacity-100" : "opacity-40"}`}>
                <span className={`relative flex size-9 items-center justify-center rounded-full ${done ? "bg-good text-primary-foreground" : "bg-glass"}`}>
                  {active && <span className="pulse-ring absolute inset-0 rounded-full holo-bg" />}
                  {done ? <Check className="size-4" /> : active ? <Loader2 className="size-4 animate-spin" /> : <s.icon className="size-4" />}
                </span>
                <span className="text-sm">{s.label}</span>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">Cela peut prendre une à deux minutes selon la durée.</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={`mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center transition ${drag ? "border-primary bg-glass" : "border-glass-border hover:border-primary/60"}`}
          >
            <UploadCloud className="size-8 text-primary" />
            <span className="text-sm font-medium">{file ? file.name : "Déposez le vocal de la réunion"}</span>
            <span className="text-xs text-muted-foreground">{file ? `${(file.size / 1e6).toFixed(1)} Mo` : "MP3, M4A, WAV, WebM · 14 Mo max"}</span>
          </button>
          <input ref={input} type="file" accept="audio/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
          <button onClick={run} disabled={!file}
            className="glow mt-4 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition disabled:opacity-40 disabled:shadow-none">
            Générer le mémo
          </button>
        </>
      )}
    </div>
  );
}
