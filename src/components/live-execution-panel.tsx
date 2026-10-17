import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Bot, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

type ExecRow = {
  id: string; automation_id: string; status: string; started_at: string; finished_at: string | null;
  automations?: { name: string } | null;
};
type ActionRow = {
  id: string; execution_id: string; agent_name: string; tool: string; label: string;
  status: string; started_at: string; finished_at: string | null;
};

export function LiveExecutionPanel({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState<ExecRow[]>([]);
  const [actions, setActions] = useState<Record<string, ActionRow[]>>({});

  async function loadActive() {
    const { data } = await supabase
      .from("executions")
      .select("id, automation_id, status, started_at, finished_at, automations(name)")
      .in("status", ["running", "pending"])
      .order("started_at", { ascending: false })
      .limit(8);
    setActive((data ?? []) as unknown as ExecRow[]);
  }
  async function loadActions(ids: string[]) {
    if (!ids.length) { setActions({}); return; }
    const { data } = await supabase
      .from("execution_actions").select("*").in("execution_id", ids)
      .order("started_at", { ascending: true });
    const grouped: Record<string, ActionRow[]> = {};
    (data ?? []).forEach((a) => { (grouped[a.execution_id] ||= []).push(a as ActionRow); });
    setActions(grouped);
  }

  useEffect(() => {
    loadActive();
    const ch = supabase.channel("live-execs")
      .on("postgres_changes", { event: "*", schema: "public", table: "executions" }, loadActive)
      .on("postgres_changes", { event: "*", schema: "public", table: "execution_actions" }, () => {
        // reload actions for current active set
        setActive((curr) => { loadActions(curr.map((e) => e.id)); return curr; });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => { loadActions(active.map((e) => e.id)); }, [active.length]);

  if (!active.length) {
    return (
      <div className="rounded-xl border border-foreground/10 p-6 text-center text-sm text-muted-foreground">
        <Activity className="size-5 mx-auto mb-2 opacity-40" />
        Aucune exécution en cours. Lancez une automatisation pour voir les agents en action.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {active.map((e) => {
        const list = actions[e.id] ?? [];
        return (
          <div key={e.id} className="rounded-xl border border-foreground/10 bg-white/30 backdrop-blur p-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping"></span>
                  <span className="relative inline-flex rounded-full size-2.5 bg-primary"></span>
                </span>
                <div className="font-medium truncate">{e.automations?.name ?? "Automatisation"}</div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(e.started_at), { addSuffix: true, locale: fr })}
              </div>
            </div>
            {!compact && (
              <div className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
                {list.length === 0 && <div className="text-xs text-muted-foreground">Initialisation…</div>}
                {list.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs animate-in fade-in slide-in-from-left-2">
                    {a.status === "running" && <Loader2 className="size-3 animate-spin text-primary shrink-0" />}
                    {a.status === "success" && <CheckCircle2 className="size-3 text-emerald-600 shrink-0" />}
                    {a.status === "error" && <XCircle className="size-3 text-red-600 shrink-0" />}
                    <Bot className="size-3 text-muted-foreground shrink-0" />
                    <span className="font-medium shrink-0">{a.agent_name}</span>
                    <span className="text-muted-foreground truncate">{a.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
