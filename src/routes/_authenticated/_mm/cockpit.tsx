import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/glass-card";
import { GlowButton } from "@/components/glow-button";
import { StatusBadge } from "@/components/status-badge";
import { LiveExecutionPanel } from "@/components/live-execution-panel";
import { Activity, CheckCircle2, Workflow, Mail, Calendar, ListTodo, FolderOpen, FileText, Sheet, ClipboardList, ArrowRight, Zap, AlertTriangle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/_mm/cockpit")({
  head: () => ({ meta: [{ title: "Cockpit · Nexus" }] }),
  component: Dashboard,
});

type Exec = {
  id: string; automation_id: string; status: "pending" | "running" | "success" | "error";
  started_at: string; finished_at: string | null; error: string | null;
  automations?: { name: string } | null;
};
type NextRun = { id: string; cron_expr: string | null; next_run_at: string; automations: { id: string; name: string } | null };

function Dashboard() {
  const [kpis, setKpis] = useState({ automations: 0, active: 0, last24h: 0, success: 0, error: 0, running: 0 });
  const [recent, setRecent] = useState<Exec[]>([]);
  const [google, setGoogle] = useState<{ google_email: string | null } | null>(null);
  const [nextRuns, setNextRuns] = useState<NextRun[]>([]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [aTotal, aActive, since, gc, nr, running] = await Promise.all([
      supabase.from("automations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("automations").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "active"),
      supabase.from("executions").select("id, status, started_at, finished_at, error, automation_id, automations(name)")
        .gte("started_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
        .order("started_at", { ascending: false }).limit(50),
      supabase.from("google_connections").select("google_email").eq("user_id", user.id).maybeSingle(),
      supabase.from("triggers").select("id, cron_expr, next_run_at, automations(id, name)").eq("enabled", true).order("next_run_at").limit(5),
      supabase.from("executions").select("id", { count: "exact", head: true }).in("status", ["running", "pending"]),
    ]);
    const list = (since.data ?? []) as unknown as Exec[];
    setKpis({
      automations: aTotal.count ?? 0,
      active: aActive.count ?? 0,
      last24h: list.length,
      success: list.filter((e) => e.status === "success").length,
      error: list.filter((e) => e.status === "error").length,
      running: running.count ?? 0,
    });
    setRecent(list.slice(0, 10));
    setGoogle(gc.data ?? null);
    setNextRuns((nr.data ?? []) as unknown as NextRun[]);
  }

  useEffect(() => {
    load();
    const channel = supabase.channel("dash-executions")
      .on("postgres_changes", { event: "*", schema: "public", table: "executions" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "triggers" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const successRate = kpis.last24h === 0 ? 0 : Math.round((kpis.success / kpis.last24h) * 100);

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-in fade-in slide-in-from-top-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display">Cockpit</h1>
          <p className="text-sm text-muted-foreground mt-1">Pilotage temps réel de votre plateforme d'automatisation.</p>
        </div>
        <Link to="/automations/new"><GlowButton><Zap className="size-4" /> Nouvelle automatisation</GlowButton></Link>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-5 animate-in fade-in slide-in-from-bottom-3">
        <Kpi icon={Workflow} label="Actives" value={`${kpis.active}/${kpis.automations}`} />
        <Kpi icon={Activity} label="Exécutions 24h" value={kpis.last24h.toString()} />
        <Kpi icon={CheckCircle2} label="Taux succès" value={`${successRate}%`} accent />
        <Kpi icon={AlertTriangle} label="Erreurs 24h" value={kpis.error.toString()} />
        <Kpi icon={Zap} label="En cours" value={kpis.running.toString()} pulse={kpis.running > 0} />
      </div>

      {/* Live + Next runs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Activity className="size-4 text-primary" /> Exécutions en direct</h2>
            <Link to="/executions" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Voir tout →</Link>
          </div>
          <div className="mt-4">
            <LiveExecutionPanel />
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="font-semibold flex items-center gap-2"><Clock className="size-4 text-primary" /> Prochains crons</h2>
          <div className="mt-4 space-y-2">
            {nextRuns.length === 0 && <p className="text-xs text-muted-foreground">Aucun cron planifié.</p>}
            {nextRuns.map((n) => (
              <Link key={n.id} to="/automations/$id" params={{ id: n.automations?.id ?? "" }} className="block rounded-lg border border-foreground/10 p-2.5 hover:bg-white/40 transition-colors press">
                <div className="text-sm font-medium truncate">{n.automations?.name ?? "—"}</div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <code className="font-mono">{n.cron_expr ?? "—"}</code>
                  <span>{formatDistanceToNow(new Date(n.next_run_at), { addSuffix: true, locale: fr })}</span>
                </div>
              </Link>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Services + recent feed */}
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Connexion Google</div>
          </div>
          <div className="mt-3 text-sm font-medium truncate">{google?.google_email ?? "Non connecté"}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[Mail, Calendar, ListTodo, FolderOpen, FileText, Sheet, ClipboardList].map((Icon, i) => (
              <div key={i} className="size-8 rounded-lg bg-white/40 border border-foreground/10 flex items-center justify-center press">
                <Icon className="size-4 text-primary" />
              </div>
            ))}
          </div>
          <Link to="/connections" className="mt-3 inline-flex items-center text-xs text-primary hover:underline">
            Gérer <ArrowRight className="size-3 ml-1" />
          </Link>
        </GlassCard>

        <GlassCard className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Flux récent</h2>
            <Link to="/executions" className="text-xs text-muted-foreground hover:text-foreground">Voir tout →</Link>
          </div>
          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
            {recent.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Aucune exécution récente.</p>}
            {recent.map((e) => (
              <Link key={e.id} to="/automations/$id" params={{ id: e.automation_id }}
                className="flex items-center justify-between rounded-xl border border-foreground/10 bg-white/30 p-3 hover:bg-white/50 transition-all press">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{e.automations?.name ?? "Automatisation"}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(e.started_at), { addSuffix: true, locale: fr })}
                  </div>
                </div>
                <StatusBadge status={e.status} />
              </Link>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, accent, pulse }: { icon: typeof Activity; label: string; value: string; accent?: boolean; pulse?: boolean }) {
  return (
    <GlassCard className="p-5 press transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-sm">{label}</span>
        <Icon className={`size-4 ${pulse ? "text-primary animate-pulse" : ""}`} />
      </div>
      <div className={`mt-3 text-3xl font-bold font-display ${accent ? "text-gradient" : ""}`}>{value}</div>
    </GlassCard>
  );
}
