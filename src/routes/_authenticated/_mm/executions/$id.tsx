import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/glass-card";
import { StatusBadge } from "@/components/status-badge";
import { ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/_mm/executions/$id")({
  component: ExecutionDetail,
});

type Exec = { id: string; automation_id: string; status: "pending"|"running"|"success"|"error"; started_at: string; finished_at: string|null; error: string|null; output: unknown; input: unknown; automations?: { name: string }|null };
type Log = { id: string; agent_id: string|null; step: number; message: string; payload: unknown; created_at: string; agents?: { name: string } | null };

function ExecutionDetail() {
  const { id } = Route.useParams();
  const [exec, setExec] = useState<Exec | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  async function load() {
    const [e, l] = await Promise.all([
      supabase.from("executions").select("*, automations(name)").eq("id", id).maybeSingle(),
      supabase.from("execution_logs").select("*, agents(name)").eq("execution_id", id).order("step"),
    ]);
    setExec((e.data ?? null) as unknown as Exec | null);
    setLogs((l.data ?? []) as unknown as Log[]);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel(`exec-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "executions", filter: `id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "execution_logs", filter: `execution_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  if (!exec) return <div className="p-8 text-sm text-muted-foreground">Chargement…</div>;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <Link to="/executions" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Retour
      </Link>
      <GlassCard>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">{exec.automations?.name}</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Démarrée {format(new Date(exec.started_at), "dd MMM yyyy HH:mm:ss", { locale: fr })}
              {exec.finished_at && <> · Terminée {format(new Date(exec.finished_at), "HH:mm:ss")}</>}
            </p>
          </div>
          <StatusBadge status={exec.status} />
        </div>
        {exec.error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{exec.error}</div>}
      </GlassCard>

      <GlassCard>
        <h3 className="font-semibold">Timeline ({logs.length})</h3>
        <div className="mt-4 space-y-2">
          {logs.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Pas encore de logs.</p>}
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">#{log.step}</span> · {log.agents?.name ?? "system"} · {format(new Date(log.created_at), "HH:mm:ss")}
                </div>
              </div>
              <div className="mt-1 text-sm">{log.message}</div>
              {log.payload != null && Object.keys(log.payload as object).length > 0 && (
                <pre className="mt-2 rounded-lg bg-black/30 border border-white/5 p-2 text-xs overflow-x-auto font-mono">
                  {JSON.stringify(log.payload, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
