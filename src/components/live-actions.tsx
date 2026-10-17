import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2, XCircle, Activity } from "lucide-react";

type Action = {
  id: string; agent_name: string | null; tool: string | null; label: string;
  status: string; started_at: string; finished_at: string | null;
};

// Live action stream for an execution — subscribes to inserts/updates and animates.
export function LiveActionStream({ executionId }: { executionId: string }) {
  const [actions, setActions] = useState<Action[]>([]);

  useEffect(() => {
    let canceled = false;
    supabase.from("execution_actions").select("*").eq("execution_id", executionId).order("started_at")
      .then(({ data }) => { if (!canceled) setActions((data ?? []) as Action[]); });
    const ch = supabase.channel(`acts-${executionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "execution_actions", filter: `execution_id=eq.${executionId}` },
        (p) => setActions((prev) => [...prev, p.new as Action]))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "execution_actions", filter: `execution_id=eq.${executionId}` },
        (p) => setActions((prev) => prev.map((a) => a.id === (p.new as Action).id ? (p.new as Action) : a)))
      .subscribe();
    return () => { canceled = true; supabase.removeChannel(ch); };
  }, [executionId]);

  if (actions.length === 0) return <div className="text-sm text-muted-foreground py-4 text-center">En attente d'actions…</div>;

  return (
    <ol className="space-y-2">
      {actions.map((a, i) => (
        <li key={a.id} className="press rounded-xl border border-foreground/10 bg-white/50 p-3 flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2">
          <div className="mt-0.5">
            {a.status === "running" && <Loader2 className="size-4 animate-spin text-[var(--holo-1)]" />}
            {a.status === "success" && <CheckCircle2 className="size-4 text-emerald-600" />}
            {a.status === "error" && <XCircle className="size-4 text-red-600" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">#{i + 1}</span>
              <span className="text-sm font-medium truncate">{a.label}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {a.agent_name} · {a.tool}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Latest live execution for an automation.
export function LiveAutomationActions({ automationId }: { automationId: string }) {
  const [execId, setExecId] = useState<string | null>(null);

  useEffect(() => {
    async function findRunning() {
      const { data } = await supabase.from("executions")
        .select("id,status")
        .eq("automation_id", automationId)
        .order("started_at", { ascending: false }).limit(1);
      if (data?.[0]) setExecId(data[0].id);
    }
    findRunning();
    const ch = supabase.channel(`auto-live-${automationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "executions", filter: `automation_id=eq.${automationId}` },
        (p) => setExecId((p.new as { id: string }).id))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [automationId]);

  if (!execId) return (
    <div className="text-sm text-muted-foreground py-6 text-center flex items-center justify-center gap-2">
      <Activity className="size-4" /> Aucune orchestration en cours
    </div>
  );
  return <LiveActionStream executionId={execId} />;
}
