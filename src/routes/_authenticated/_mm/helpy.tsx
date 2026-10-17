import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { startDebugSession, sendDebugMessage, endDebugSession } from "@/lib/helpy.functions";
import { Bot, Send, StopCircle, Sparkles, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { VoiceButton } from "@/components/voice-button";

export const Route = createFileRoute("/_authenticated/_mm/helpy")({
  head: () => ({ meta: [{ title: "HELPY · Déboggage IA" }] }),
  component: HelpyPage,
});

type Auto = { id: string; name: string; status: string };
type Session = { id: string; automation_id: string; issue: string; status: string; created_at: string; ended_at: string | null };
type Msg = { id: string; role: string; content: string; created_at: string };

function HelpyPage() {
  const nav = useNavigate();
  const [autos, setAutos] = useState<Auto[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [current, setCurrent] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [automationId, setAutomationId] = useState("");
  const [issue, setIssue] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const start = useServerFn(startDebugSession);
  const send = useServerFn(sendDebugMessage);
  const end = useServerFn(endDebugSession);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function loadAll() {
    const [a, s] = await Promise.all([
      supabase.from("automations").select("id,name,status").order("created_at", { ascending: false }),
      supabase.from("debug_sessions").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    setAutos((a.data ?? []) as Auto[]);
    setSessions((s.data ?? []) as Session[]);
  }
  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!current) return setMessages([]);
    supabase.from("debug_messages").select("*").eq("session_id", current.id).order("created_at")
      .then(({ data }) => setMessages((data ?? []) as Msg[]));
    const ch = supabase.channel(`dbg-${current.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "debug_messages", filter: `session_id=eq.${current.id}` },
        (p) => setMessages((prev) => [...prev, p.new as Msg]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [current?.id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" }); }, [messages.length]);

  async function onStart() {
    if (!automationId || issue.trim().length < 5) { toast.error("Sélectionnez une automatisation et décrivez le problème."); return; }
    setBusy(true);
    try {
      const res = await start({ data: { automationId, issue } });
      await loadAll();
      const { data } = await supabase.from("debug_sessions").select("*").eq("id", res.sessionId).maybeSingle();
      setCurrent(data as Session);
      setIssue("");
      toast.success("HELPY analyse votre automatisation");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  }
  async function onSend() {
    if (!current || !input.trim()) return;
    const txt = input;
    setInput("");
    setBusy(true);
    try { await send({ data: { sessionId: current.id, message: txt } }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  }
  async function onEnd() {
    if (!current) return;
    await end({ data: { sessionId: current.id } });
    setCurrent(null);
    await loadAll();
    toast.success("Session HELPY clôturée");
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-2xl holo-gradient animate-holo holo-glow flex items-center justify-center">
          <Bot className="size-6 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient">HELPY</h1>
          <p className="text-sm text-muted-foreground">Agent de déboggage autonome pour vos automatisations.</p>
        </div>
      </div>

      {!current ? (
        <div className="bento-card p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Nouvelle session de déboggage</h2>
          <div>
            <label className="text-sm font-medium">Automatisation à analyser</label>
            <select value={automationId} onChange={(e) => setAutomationId(e.target.value)}
              className="mt-2 w-full rounded-xl bg-white/60 border border-foreground/10 px-4 py-2.5 outline-none focus:border-[var(--holo-1)]">
              <option value="">— Choisir —</option>
              {autos.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium flex items-center justify-between">
              <span>Décris le problème</span>
              <VoiceButton size="sm" onTranscript={(t) => setIssue((p) => p ? `${p} ${t}` : t)} />
            </label>
            <textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={4}
              placeholder="Ex: L'automatisation crée des rendez-vous en double dans Google Agenda."
              className="mt-2 w-full rounded-xl bg-white/60 border border-foreground/10 px-4 py-3 outline-none focus:border-[var(--holo-1)] resize-none" />
          </div>
          <div className="flex justify-end">
            <button onClick={onStart} disabled={busy} className="press inline-flex items-center gap-2 rounded-xl holo-gradient animate-holo holo-glow text-white font-medium px-5 py-2.5">
              <Sparkles className="size-4" /> {busy ? "Analyse…" : "Démarrer HELPY"}
            </button>
          </div>
        </div>
      ) : (
        <div className="bento-card flex flex-col h-[70vh]">
          <div className="flex items-center justify-between p-4 border-b border-foreground/10">
            <div className="min-w-0">
              <div className="font-display font-semibold truncate">{autos.find((a) => a.id === current.automation_id)?.name ?? "Automatisation"}</div>
              <div className="text-xs text-muted-foreground truncate">{current.issue}</div>
            </div>
            <button onClick={onEnd} className="press inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm hover:bg-white/40">
              <StopCircle className="size-4" /> Terminer
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-2xl p-3 ${m.role === "user" ? "ml-auto bg-[var(--holo-1)] text-white" : "bg-white/70 border border-foreground/10"}`}>
                <pre className="whitespace-pre-wrap font-sans text-sm">{m.content}</pre>
              </div>
            ))}
            {busy && <div className="text-xs text-muted-foreground">HELPY réfléchit…</div>}
          </div>
          <div className="p-3 border-t border-foreground/10 flex items-center gap-2">
            <VoiceButton size="sm" onTranscript={(t) => setInput((p) => p ? `${p} ${t}` : t)} />
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSend()}
              placeholder="Pose une question ou continue le déboggage…"
              className="flex-1 rounded-xl bg-white/60 border border-foreground/10 px-4 py-2 outline-none focus:border-[var(--holo-1)]" />
            <button onClick={onSend} disabled={busy} className="press rounded-xl holo-gradient text-white p-2.5">
              <Send className="size-4" />
            </button>
          </div>
        </div>
      )}

      {sessions.length > 0 && !current && (
        <div className="bento-card p-5">
          <h3 className="font-display font-semibold mb-3">Sessions récentes</h3>
          <div className="space-y-2">
            {sessions.map((s) => (
              <button key={s.id} onClick={() => setCurrent(s)}
                className="w-full text-left press rounded-xl border border-foreground/10 p-3 hover:bg-white/40 transition-colors flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{autos.find((a) => a.id === s.automation_id)?.name ?? "Automatisation"}</div>
                  <div className="text-xs text-muted-foreground truncate">{s.issue}</div>
                </div>
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${s.status === "open" ? "bg-[var(--holo-1)] text-white" : "bg-foreground/10"}`}>{s.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
