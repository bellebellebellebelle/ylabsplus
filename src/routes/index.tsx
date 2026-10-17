import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useServerFn } from "@tanstack/react-start";
import { AudioLines, Square, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuraTaskPanel, type BoardItem } from "@/components/aura-task-panel";
import { supabase } from "@/integrations/supabase/client";
import { askAssistant, assistantSpeech, transcribeAudio } from "@/lib/assistant.functions";
import bgUrl from "@/assets/interface.jpg";
import { AuraMotion } from "@/components/aura-motion";
const bg = { url: bgUrl };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({ voice: search["voice"] === true || search["voice"] === "true" }),
  head: () => ({
    meta: [
      { title: "Aura — Votre assistant vocal Odoo" },
      { name: "description", content: "Parlez à Aura : e-mails, relances, rendez-vous, CRM, ventes et achats exécutés dans Odoo." },
      { property: "og:title", content: "Aura — Votre assistant vocal Odoo" },
      { property: "og:description", content: "Un assistant vocal qui agit réellement dans votre Odoo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { voice } = Route.useSearch();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <main className={`aura-bg relative h-screen w-full overflow-hidden text-foreground ${voice ? "aura-voice-surface" : ""}`} style={voice ? undefined : { backgroundImage: `url(${bg.url})` }}>
      {session === undefined ? null : session ? <Assistant userId={session.user.id} compact={voice} /> : <AuthCard />}
    </main>
  );
}

function AuthCard() {
  const [mode, setMode] = useState<"in" | "up">("up");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const { error } =
      mode === "up"
        ? await supabase.auth.signUp({ email, password: pw })
        : await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setErr(error.message);
    setBusy(false);
  };
  return (
    <div className="absolute inset-0 flex items-end justify-center pb-10 sm:items-center sm:justify-end sm:pb-0 sm:pr-16">
      <form onSubmit={submit} className="aura-glass w-[min(92vw,360px)] space-y-3 rounded-3xl p-7">
        <h1 className="text-2xl font-light tracking-wide">Aura</h1>
        <p className="text-sm text-muted-foreground">{mode === "up" ? "Créez votre compte pour rencontrer votre assistant." : "Bon retour."}</p>
        <input className="w-full rounded-xl border border-input bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary" type="email" required placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-xl border border-input bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary" type="password" required minLength={6} placeholder="Mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p className="text-xs text-destructive-foreground">{err}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
          {busy ? "…" : mode === "up" ? "Créer mon compte" : "Se connecter"}
        </button>
        <button type="button" onClick={() => setMode(mode === "up" ? "in" : "up")} className="w-full text-xs text-muted-foreground hover:text-foreground">
          {mode === "up" ? "Déjà un compte ? Se connecter" : "Pas de compte ? Créer un compte"}
        </button>
      </form>
    </div>
  );
}

type State = "idle" | "listening" | "thinking" | "speaking";

function Assistant({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [state, setState] = useState<State>("idle");
  const [caption, setCaption] = useState("");
  const [board, setBoard] = useState<BoardItem[] | null>(null);
  const [lab, setLab] = useState<{ path: string; v: number } | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcribe = useServerFn(transcribeAudio);
  const ask = useServerFn(askAssistant);
  const speech = useServerFn(assistantSpeech);
  const requestRef = useRef(0);

  useEffect(() => {
    // Realtime sync: latest assistant message (e.g. from another device) updates the board.
    const ch = supabase
      .channel("msgs-" + userId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${userId}` }, (p) => {
        const m = p.new as { role: string; board: BoardItem[] | null };
        if (m.role === "assistant" && m.board?.length) setBoard(m.board);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  useEffect(() => {
    const enter = (event: MouseEvent) => {
      if (compact || (event.target as HTMLElement).closest("button, input, form, iframe, aside, section")) return;
      setLab(current => current ?? { path: "/dashboard", v: 0 });
    };
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== document.querySelector<HTMLIFrameElement>("iframe[title=\"Laboratoire IDEALAB\"]")?.contentWindow) return;
      if (event.data?.type === "aura-talk") void toggle();
      else if (event.data?.type === "aura-ask" && typeof event.data.text === "string" && state !== "thinking") void handle(event.data.text.slice(0, 2000));
    };
    document.addEventListener("dblclick", enter); window.addEventListener("message", message);
    return () => { document.removeEventListener("dblclick", enter); window.removeEventListener("message", message); };
  }, [compact, state]);

  const handle = async (text: string) => {
    const request = ++requestRef.current;
    setCaption("« " + text + " »");
    setState("thinking");
    setBoard([{ kind: "step", text: "J'analyse votre demande…" }]);
    try {
      const r = await ask({ data: { text } });
      setBoard(r.board.length ? r.board : [{ kind: "result", title: "Réponse", lines: [r.reply] }]);
      setCaption(r.reply);
      if (r.open === "close") setLab(null);
      else if (r.open) setLab((l) => ({ path: r.open as string, v: (l?.v ?? 0) + 1 }));
      setState("idle");
      const { audio } = await speech({ data: { text: r.reply } }).catch(() => ({ audio: null }));
      if (request !== requestRef.current) return;
      if (audio) {
        const a = new Audio(`data:audio/wav;base64,${audio}`);
        audioRef.current = a;
        setState("speaking");
        a.onended = () => setState("idle");
        await a.play().catch(() => setState("idle"));
      } else setState("idle");
    } catch (e) {
      setCaption((e as Error).message);
      setState("idle");
    }
  };

  const toggle = async () => {
    if (state === "speaking") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    if (state === "thinking") return;
    if (state === "listening") {
      recRef.current?.stop();
      return;
    }
    requestRef.current += 1;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType });
        if (blob.size < 2000) {
          setState("idle");
          setCaption("Je n'ai rien entendu.");
          return;
        }
        setState("thinking");
        setCaption("Transcription…");
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        try {
          const { text } = await transcribe({ data: { audio: btoa(s), mime: rec.mimeType } });
          if (!text) {
            setState("idle");
            setCaption("Je n'ai pas compris, réessayez.");
          } else await handle(text);
        } catch (e) {
          setCaption((e as Error).message);
          setState("idle");
        }
      };
      recRef.current = rec;
      rec.start();
      setState("listening");
      setCaption("Je vous écoute… touchez à nouveau pour envoyer");
    } catch {
      setCaption("Autorisez le micro pour parler à Aura.");
    }
  };

  return (
    <>
      {!lab && !compact && <AuraMotion state={state} />}
      {lab && <LabWindow path={lab.path} v={lab.v} onClose={() => setLab(null)} />}
      <Button variant="ghost" aria-label="Parler à l'assistant" data-state={state} data-lab={lab || compact ? "1" : undefined} onClick={toggle} className={`aura-orb z-40 cursor-pointer outline-none ${lab || compact ? "aura-floating" : ""}`}>
        {(lab || compact) && (state === 'thinking' ? <LoaderCircle className="animate-spin"/> : state === 'listening' || state === 'speaking' ? <Square/> : <AudioLines/>)}
      </Button>
      {caption && <p className={`aura-caption ${lab || compact ? "aura-caption-floating" : ""}`} role="status">{caption}</p>}
      {board && <AuraTaskPanel items={board} onClose={() => setBoard(null)} />}
    </>
  );
}

function LabWindow({ path, v, onClose }: { path: string; v: number; onClose: () => void }) {
  return (
    <section className="absolute inset-0 z-10 overflow-hidden" aria-label="Laboratoire">
      <iframe key={v} src={path} title="Laboratoire IDEALAB" allow="microphone" className="h-full w-full bg-background" />
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Revenir à Aura" className="aura-lab-close"><X/></Button>
    </section>
  );
}
