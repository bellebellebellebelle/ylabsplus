import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/status-badge";
import { ServiceChip } from "@/components/service-icon";
import { Play, Pause, Trash2, PlayCircle, Bot, Clock, ChevronLeft, Edit2, Save, X, RefreshCw, Activity } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  setAutomationStatus, runAutomationNow, updateAutomation, updateAgent, updateTrigger, resetAutomationState,
} from "@/lib/automations.functions";
import { describeCron, computeNextRun } from "@/lib/cron";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";
import { LiveAutomationActions } from "@/components/live-actions";

export const Route = createFileRoute("/_authenticated/_mm/automations/$id")({
  head: () => ({ meta: [{ title: "Automatisation · Nexus" }] }),
  component: AutomationDetail,
});

type Auto = { id: string; name: string; description: string | null; prompt: string; status: "draft" | "active" | "paused"; timezone: string };
type Agent = { id: string; name: string; role: string; instructions: string; services: string[]; order: number; model: string };
type Trigger = { id: string; type: string; cron_expr: string | null; next_run_at: string | null; last_run_at: string | null; enabled: boolean };
type Exec = { id: string; status: "pending" | "running" | "success" | "error"; started_at: string; finished_at: string | null; error: string | null };

const CRON_PRESETS = [
  { v: "*/5 * * * *", l: "Toutes les 5 minutes" },
  { v: "*/15 * * * *", l: "Toutes les 15 minutes" },
  { v: "0 * * * *", l: "Toutes les heures" },
  { v: "0 8 * * *", l: "Tous les jours à 8h" },
  { v: "0 9 * * 1-5", l: "En semaine à 9h" },
  { v: "0 0 * * 0", l: "Chaque dimanche à minuit" },
];

const TZS = ["Indian/Reunion", "Europe/Paris", "UTC", "America/New_York", "Asia/Tokyo"];

function AutomationDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [auto, setAuto] = useState<Auto | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [executions, setExecutions] = useState<Exec[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Auto | null>(null);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<Partial<Agent>>({});

  const setStatus = useServerFn(setAutomationStatus);
  const runNow = useServerFn(runAutomationNow);
  const updAuto = useServerFn(updateAutomation);
  const updAgent = useServerFn(updateAgent);
  const updTrig = useServerFn(updateTrigger);
  const resetState = useServerFn(resetAutomationState);

  async function load() {
    const [a, ag, tr, ex] = await Promise.all([
      supabase.from("automations").select("*").eq("id", id).maybeSingle(),
      supabase.from("agents").select("*").eq("automation_id", id).order("order"),
      supabase.from("triggers").select("*").eq("automation_id", id),
      supabase.from("executions").select("id,status,started_at,finished_at,error").eq("automation_id", id).order("started_at", { ascending: false }).limit(20),
    ]);
    const data = (a.data ?? null) as Auto | null;
    setAuto(data);
    if (data) setForm(data);
    setAgents((ag.data ?? []) as Agent[]);
    setTriggers((tr.data ?? []) as Trigger[]);
    setExecutions((ex.data ?? []) as Exec[]);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel(`auto-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "executions", filter: `automation_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "triggers", filter: `automation_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  if (!auto || !form) return <div className="p-8 text-sm text-muted-foreground">Chargement…</div>;

  async function toggle() {
    const next = auto!.status === "active" ? "paused" : "active";
    await setStatus({ data: { id: auto!.id, status: next } });
    toast.success(next === "active" ? "Cron activé en temps réel" : "Mise en pause");
  }
  async function onRun() {
    try { await runNow({ data: { id: auto!.id } }); toast.success("Test d'exécution lancé"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  }
  async function onDelete() {
    if (!confirm("Supprimer cette automatisation ?")) return;
    await supabase.from("automations").delete().eq("id", auto!.id);
    nav({ to: "/automations" });
  }
  async function saveAuto() {
    await updAuto({ data: { id: auto!.id, name: form!.name, description: form!.description, timezone: form!.timezone } });
    setEditing(false);
    toast.success("Mise à jour enregistrée");
  }
  async function saveAgent(agentId: string) {
    await updAgent({ data: { id: agentId, ...agentDraft } as never });
    setEditingAgent(null);
    setAgentDraft({});
    toast.success("Agent mis à jour");
    load();
  }
  async function setCron(t: Trigger, expr: string) {
    await updTrig({ data: { id: t.id, cron_expr: expr } });
    toast.success("Cron mis à jour");
  }
  async function toggleTrigger(t: Trigger) {
    await updTrig({ data: { id: t.id, enabled: !t.enabled } });
  }
  async function onResetMemory() {
    if (!confirm("Réinitialiser la mémoire d'idempotence ? Les anciens emails/événements pourront être retraités.")) return;
    await resetState({ data: { id: auto!.id } });
    toast.success("Mémoire effacée");
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <Link to="/automations" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Retour
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="text-3xl font-display font-bold bg-white/60 rounded-xl border border-foreground/10 px-3 py-1.5 w-full" />
              <textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2} className="w-full bg-white/60 rounded-xl border border-foreground/10 px-3 py-1.5 text-sm" />
              <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="bg-white/60 rounded-xl border border-foreground/10 px-3 py-1.5 text-sm">
                {TZS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-display font-bold text-gradient">{auto.name}</h1>
                <StatusBadge status={auto.status} />
                <span className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-full bg-foreground/10">{auto.timezone}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{auto.description}</p>
            </>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {editing ? (
            <>
              <button onClick={saveAuto} className="press inline-flex items-center gap-1.5 rounded-xl holo-gradient text-white px-3 py-2 text-sm"><Save className="size-4" /> Enregistrer</button>
              <button onClick={() => { setEditing(false); setForm(auto); }} className="press inline-flex items-center gap-1.5 rounded-xl border border-foreground/10 px-3 py-2 text-sm"><X className="size-4" /></button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="press inline-flex items-center gap-1.5 rounded-xl border border-foreground/10 px-3 py-2 text-sm hover:bg-white/40"><Edit2 className="size-4" /> Modifier</button>
          )}
          <button onClick={onRun} className="press inline-flex items-center gap-1.5 rounded-xl border border-foreground/10 px-3 py-2 text-sm hover:bg-white/40"><PlayCircle className="size-4" /> Test</button>
          <button onClick={toggle} className={`press inline-flex items-center gap-1.5 rounded-xl text-sm px-3 py-2 text-white ${auto.status === "active" ? "bg-foreground/40" : "holo-gradient"}`}>
            {auto.status === "active" ? <><Pause className="size-4" /> Désactiver</> : <><Play className="size-4" /> Activer le cron</>}
          </button>
          <button onClick={onDelete} className="press inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 text-red-600 px-3 py-2 text-sm hover:bg-red-50"><Trash2 className="size-4" /></button>
        </div>
      </div>

      <div className="bento-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold flex items-center gap-2"><Activity className="size-4 text-[var(--holo-1)]" /> Orchestration en direct</h3>
          <span className="text-xs text-muted-foreground">Actions mises à jour en temps réel</span>
        </div>
        <div className="mt-4"><LiveAutomationActions automationId={auto.id} /></div>
      </div>

      <div className="bento-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-display font-semibold flex items-center gap-2"><Clock className="size-4 text-[var(--holo-1)]" /> Déclencheurs cron</h3>
          <button onClick={onResetMemory} className="press inline-flex items-center gap-1.5 text-xs rounded-lg border border-foreground/10 px-2 py-1 hover:bg-white/40">
            <RefreshCw className="size-3" /> Reset mémoire anti-doublon
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {triggers.map((t) => (
            <div key={t.id} className="rounded-xl border border-foreground/10 bg-white/40 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t.type}</div>
                  {t.cron_expr && <code className="font-mono text-sm text-[var(--holo-1)]">{t.cron_expr}</code>}
                  {t.cron_expr && <p className="text-sm mt-0.5">{describeCron(t.cron_expr)}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground text-right">
                    {t.next_run_at && <div>Prochain : {format(new Date(t.next_run_at), "dd MMM HH:mm", { locale: fr })}</div>}
                    {t.last_run_at && <div>Dernier : {formatDistanceToNow(new Date(t.last_run_at), { addSuffix: true, locale: fr })}</div>}
                  </div>
                  <button onClick={() => toggleTrigger(t)} className={`press rounded-full w-12 h-6 relative ${t.enabled ? "holo-gradient" : "bg-foreground/20"}`}>
                    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${t.enabled ? "translate-x-6" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
              {t.type === "cron" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <input defaultValue={t.cron_expr ?? ""} onBlur={(e) => e.target.value && e.target.value !== t.cron_expr && setCron(t, e.target.value)}
                    className="font-mono text-sm bg-white/60 rounded-lg border border-foreground/10 px-2 py-1 w-44" placeholder="* * * * *" />
                  <div className="flex flex-wrap gap-1">
                    {CRON_PRESETS.map((p) => (
                      <button key={p.v} onClick={() => setCron(t, p.v)}
                        className="press text-[11px] rounded-lg border border-foreground/10 px-2 py-1 hover:bg-white/40">{p.l}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bento-card p-5">
        <h3 className="font-display font-semibold flex items-center gap-2"><Bot className="size-4 text-[var(--holo-1)]" /> Agents IA ({agents.length})</h3>
        <div className="mt-4 space-y-3">
          {agents.map((a, i) => (
            <div key={a.id} className="rounded-xl border border-foreground/10 bg-white/40 p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i + 1}. {a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.role} · <span className="font-mono">{a.model}</span></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">{a.services.map((s) => <ServiceChip key={s} service={s} />)}</div>
                  {editingAgent === a.id ? (
                    <button onClick={() => saveAgent(a.id)} className="press text-xs rounded-lg holo-gradient text-white px-2 py-1"><Save className="size-3 inline" /></button>
                  ) : (
                    <button onClick={() => { setEditingAgent(a.id); setAgentDraft({ name: a.name, role: a.role, instructions: a.instructions, services: a.services as never }); }}
                      className="press text-xs rounded-lg border border-foreground/10 px-2 py-1 hover:bg-white/40"><Edit2 className="size-3 inline" /></button>
                  )}
                </div>
              </div>
              {editingAgent === a.id ? (
                <textarea value={agentDraft.instructions ?? ""} onChange={(e) => setAgentDraft({ ...agentDraft, instructions: e.target.value })}
                  rows={6} className="mt-3 w-full text-sm bg-white/60 rounded-lg border border-foreground/10 p-2" />
              ) : (
                <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{a.instructions}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bento-card p-5">
        <h3 className="font-display font-semibold">Exécutions récentes</h3>
        <div className="mt-4 space-y-2">
          {executions.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Aucune exécution.</p>}
          {executions.map((e) => (
            <Link key={e.id} to="/executions/$id" params={{ id: e.id }}
              className="press flex items-center justify-between rounded-xl border border-foreground/10 bg-white/40 p-3 hover:bg-white/60">
              <div>
                <div className="text-sm">{format(new Date(e.started_at), "dd MMM yyyy HH:mm:ss", { locale: fr })}</div>
                {e.error && <div className="text-xs text-red-600 mt-0.5 truncate max-w-md">{e.error}</div>}
              </div>
              <StatusBadge status={e.status} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
