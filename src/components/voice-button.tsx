import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { transcribeVoice } from "@/lib/voice-mm.functions";

type Props = {
  onTranscript: (text: string) => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  floating?: boolean;
};

export function VoiceButton({ onTranscript, className = "", size = "md", floating = false }: Props) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcribe = useServerFn(transcribeVoice);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1500) { toast.error("Enregistrement trop court"); return; }
        setBusy(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "recording.webm");
          const res = await transcribe({ data: fd } as never);
          if (res?.text) {
            onTranscript(res.text);
            toast.success("Transcription prête");
          } else {
            toast.error("Transcription vide");
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erreur transcription");
        } finally {
          setBusy(false);
        }
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Micro inaccessible");
    }
  }
  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }

  const sizes = { sm: "size-9", md: "size-12", lg: "size-16" } as const;
  const icons = { sm: "size-4", md: "size-5", lg: "size-6" } as const;

  const base = `relative inline-flex items-center justify-center rounded-full press transition-all
    ${recording ? "holo-gradient animate-pulse-ring text-white" : "bento-card holo-glow text-[var(--holo-1)]"}
    ${sizes[size]} ${className}`;

  const btn = (
    <button
      type="button"
      onClick={() => (recording ? stop() : start())}
      disabled={busy}
      className={base}
      aria-label={recording ? "Arrêter l'enregistrement" : "Démarrer la dictée vocale"}
    >
      {busy ? <Loader2 className={`${icons[size]} animate-spin`} />
        : recording ? <Square className={icons[size]} />
        : <Mic className={icons[size]} />}
    </button>
  );

  if (!floating) return btn;
  return <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
    {recording && <div className="bento-card px-3 py-1.5 text-xs font-medium">● Enregistrement…</div>}
    {busy && <div className="bento-card px-3 py-1.5 text-xs font-medium">Transcription…</div>}
    {btn}
  </div>;
}
