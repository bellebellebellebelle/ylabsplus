import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/status-badge";
import { Plus, Play, Pause, PlayCircle } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";
import { useServerFn } from "@tanstack/react-start";
import { setAutomationStatus, runAutomationNow } from "@/lib/automations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_mm/automations/")({
  head: () => ({ meta: [{ title: "Automatisations · Nexus" }] }),
  component: AutomationsList,
});

type Row = {
  id: string; name: string; description: string | null;
  status: "draft" | "active" | "paused"; created_at: string;
  triggers?: Array<{ id: string; cron_expr: string | null; enabled: boolean; next_run_at: string | null; last_run_at: string | null }>;
};

function AutomationsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const setStatus = useServerFn(setAutomationStatus);
  const runNow = useServerFn(runAutomationNow);

  async function load() {
    const { data } = await supabase
      .from("automations")
      .select("id,name,description,status,created_at,triggers(id,cron_expr,enabled,next_run_at,last_run_at)")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel("autos-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "automations" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "triggers" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function toggle(r: Row) {
    const next = r.status === "active" ? "paused" : "active";
    try {
      await setStatus({ data: { id: r.id, status: next } });
      toast.success(next === "active" ? "Cron activé · automatisation en ligne" : "Cron désactivé");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  }
  async function onRun(r: Row) {
    try { await runNow({ data: { id: r.id } }); toast.success("Test d'exécution lancé"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient">Automatisations</h1>
          <p className="text-sm text-muted-foreground mt-1">Workflows pilotés par IA avec cron temps réel.</p>
        </div>
        <Link to="/automations/new">
          <button className="press inline-flex items-center gap-2 rounded-xl holo-gradient animate-holo holo-glow text-white px-4 py-2.5 text-sm font-medium">
            <Plus className="size-4" /> Nouvelle automatisation
          </button>
        </Link>
      </div>

      {loading ? (
        <div className="bento-card p-8 text-center text-sm text-muted-foreground">Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="bento-card p-16 text-center">
          <h3 className="font-display font-semibold">Aucune automatisation</h3>
          <p className="text-sm text-muted-foreground mt-1">Décrivez votre première automatisation pour démarrer.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((r) => {
            const next = r.triggers?.[0]?.next_run_at;
            return (
              <div key={r.id} className="bento-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link to="/automations/$id" params={{ id: r.id }} className="min-w-0 flex-1">
                    <div className="font-display font-semibold truncate">{r.name}</div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.description}</p>
                  </Link>
                  <StatusBadge status={r.status} />
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                  <div className="text-muted-foreground space-y-0.5">
                    {r.triggers?.[0]?.cron_expr && <code className="font-mono text-[var(--holo-1)]">{r.triggers[0].cron_expr}</code>}
                    {next && <div>Prochain : {format(new Date(next), "dd MMM HH:mm", { locale: fr })}</div>}
                    <div>Créée {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: fr })}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => onRun(r)} title="Lancer un test"
                      className="press rounded-lg border border-foreground/10 p-2 hover:bg-white/40">
                      <PlayCircle className="size-4" />
                    </button>
                    <button onClick={() => toggle(r)} title={r.status === "active" ? "Désactiver le cron" : "Activer le cron"}
                      className={`press rounded-full w-12 h-6 relative transition-colors ${r.status === "active" ? "holo-gradient" : "bg-foreground/20"}`}>
                      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${r.status === "active" ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
