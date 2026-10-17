import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/glass-card";
import { Activity, CheckCircle2, XCircle, Clock, Zap, Workflow, TrendingUp, Mail, Calendar, ListTodo, FolderOpen, FileText, Sheet, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_mm/kpi")({
  head: () => ({ meta: [{ title: "KPI · Nexus" }] }),
  component: KpiPage,
});

type ExecRow = { id: string; status: string; started_at: string; finished_at: string | null; automation_id: string };
type ActionRow = { id: string; tool: string; status: string; started_at: string; finished_at: string | null };

const TOOL_SERVICE: Record<string, string> = {
  gmail_list: "gmail", gmail_read: "gmail", gmail_send: "gmail", gmail_draft: "gmail", gmail_modify: "gmail", gmail_trash: "gmail",
  calendar_list_events: "calendar", calendar_create_event: "calendar", calendar_update_event: "calendar", calendar_delete_event: "calendar", calendar_list_calendars: "calendar",
  tasks_list_lists: "tasks", tasks_list: "tasks", tasks_create: "tasks", tasks_complete: "tasks", tasks_delete: "tasks",
  drive_list: "drive", drive_get: "drive", drive_create_folder: "drive", drive_delete: "drive", drive_rename: "drive", drive_move: "drive", drive_copy: "drive", drive_share: "drive", drive_list_permissions: "drive", drive_list_versions: "drive",
  docs_read: "docs", docs_create: "docs", docs_append: "docs", docs_replace_text: "docs",
  sheets_read: "sheets", sheets_append_row: "sheets", sheets_write_range: "sheets", sheets_create: "sheets",
  forms_get: "forms", forms_create: "forms", forms_add_question: "forms", forms_list_responses: "forms", forms_update_info: "forms",
};
const SERVICE_ICONS: Record<string, typeof Mail> = {
  gmail: Mail, calendar: Calendar, tasks: ListTodo, drive: FolderOpen, docs: FileText, sheets: Sheet, forms: ClipboardList,
};

// Average minutes saved per service-action (conservative estimates).
const TIME_PER_ACTION_MIN: Record<string, number> = {
  gmail: 1.5, calendar: 2, tasks: 1, drive: 1.5, docs: 3, sheets: 2, forms: 2,
};

function KpiPage() {
  const [execs, setExecs] = useState<ExecRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [autos, setAutos] = useState<{ total: number; active: number }>({ total: 0, active: 0 });
  const [period, setPeriod] = useState<"24h" | "7d" | "30d">("7d");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const since = new Date(Date.now() - (period === "24h" ? 1 : period === "7d" ? 7 : 30) * 86_400_000).toISOString();
      const [{ data: e }, { data: a }, { count: total }, { count: active }] = await Promise.all([
        supabase.from("executions").select("id, status, started_at, finished_at, automation_id").gte("started_at", since).order("started_at"),
        supabase.from("execution_actions").select("id, tool, status, started_at, finished_at").gte("started_at", since),
        supabase.from("automations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("automations").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "active"),
      ]);
      setExecs((e ?? []) as ExecRow[]);
      setActions((a ?? []) as ActionRow[]);
      setAutos({ total: total ?? 0, active: active ?? 0 });
    })();
  }, [period]);

  const total = execs.length;
  const ok = execs.filter((x) => x.status === "success").length;
  const errs = execs.filter((x) => x.status === "error").length;
  const successRate = total ? Math.round((ok / total) * 100) : 0;
  const durations = execs.filter((x) => x.finished_at).map((x) => new Date(x.finished_at!).getTime() - new Date(x.started_at).getTime());
  const avgDur = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length / 1000) : 0;

  const byService: Record<string, number> = {};
  for (const a of actions) {
    const svc = TOOL_SERVICE[a.tool];
    if (svc) byService[svc] = (byService[svc] ?? 0) + 1;
  }
  const minutesSaved = Object.entries(byService).reduce((s, [svc, n]) => s + n * (TIME_PER_ACTION_MIN[svc] ?? 1), 0);

  // executions per day (last N days)
  const days = period === "24h" ? 1 : period === "7d" ? 7 : 30;
  const buckets: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    buckets.push({ day: key, n: 0 });
  }
  for (const e of execs) {
    const k = e.started_at.slice(0, 10);
    const b = buckets.find((x) => x.day === k);
    if (b) b.n++;
  }
  const maxN = Math.max(1, ...buckets.map((b) => b.n));

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display">KPI & Productivité</h1>
          <p className="text-sm text-muted-foreground mt-1">Mesurez l'impact de vos automatisations.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-foreground/10 p-1 bg-white/40">
          {(["24h", "7d", "30d"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`press px-3 py-1.5 text-xs rounded-lg transition-all ${period === p ? "holo-gradient text-white" : "text-muted-foreground hover:bg-white/40"}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4 animate-in fade-in slide-in-from-bottom-2">
        <Stat icon={TrendingUp} label="Temps gagné" value={`${Math.round(minutesSaved)} min`} sub={`≈ ${(minutesSaved / 60).toFixed(1)} h sur la période`} accent />
        <Stat icon={Activity} label="Exécutions" value={total.toString()} sub={`${ok} succès · ${errs} erreurs`} />
        <Stat icon={CheckCircle2} label="Taux de succès" value={`${successRate}%`} />
        <Stat icon={Clock} label="Durée moyenne" value={`${avgDur}s`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <h2 className="font-semibold flex items-center gap-2"><Activity className="size-4 text-primary" /> Volume par jour</h2>
          <div className="mt-4 flex items-end gap-1 h-40">
            {buckets.map((b) => (
              <div key={b.day} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">{b.n}</div>
                <div className="w-full holo-gradient rounded-t-md transition-all" style={{ height: `${(b.n / maxN) * 100}%`, minHeight: 4 }} />
                <div className="text-[9px] text-muted-foreground rotate-45 origin-left mt-1">{b.day.slice(5)}</div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="font-semibold flex items-center gap-2"><Zap className="size-4 text-primary" /> Actions par service</h2>
          <div className="mt-4 space-y-2">
            {Object.keys(byService).length === 0 && <p className="text-xs text-muted-foreground">Aucune action sur la période.</p>}
            {Object.entries(byService).sort((a, b) => b[1] - a[1]).map(([svc, n]) => {
              const Icon = SERVICE_ICONS[svc] ?? Activity;
              const pct = Math.round((n / actions.length) * 100);
              return (
                <div key={svc} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 capitalize"><Icon className="size-3.5 text-primary" /> {svc}</span>
                    <span className="text-muted-foreground">{n} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/40 overflow-hidden">
                    <div className="h-full holo-gradient transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <h2 className="font-semibold flex items-center gap-2"><Workflow className="size-4 text-primary" /> Couverture</h2>
        <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-foreground/10 p-3"><div className="text-muted-foreground text-xs">Automatisations</div><div className="text-2xl font-bold font-display">{autos.total}</div></div>
          <div className="rounded-xl border border-foreground/10 p-3"><div className="text-muted-foreground text-xs">Actives (cron)</div><div className="text-2xl font-bold font-display text-primary">{autos.active}</div></div>
          <div className="rounded-xl border border-foreground/10 p-3"><div className="text-muted-foreground text-xs">Actions outils</div><div className="text-2xl font-bold font-display">{actions.length}</div></div>
        </div>
      </GlassCard>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, accent }: { icon: typeof Activity; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <GlassCard className="p-5 press transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">{label}</span><Icon className="size-4" /></div>
      <div className={`mt-2 text-3xl font-bold font-display ${accent ? "text-gradient" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </GlassCard>
  );
}
