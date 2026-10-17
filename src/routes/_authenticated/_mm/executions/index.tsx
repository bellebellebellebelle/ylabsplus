import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/glass-card";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/_mm/executions/")({
  head: () => ({ meta: [{ title: "Exécutions · Nexus" }] }),
  component: ExecutionsList,
});

type Row = {
  id: string; automation_id: string; status: "pending" | "running" | "success" | "error";
  started_at: string; finished_at: string | null; error: string | null;
  automations?: { name: string } | null;
};

function ExecutionsList() {
  const [rows, setRows] = useState<Row[]>([]);
  async function load() {
    const { data } = await supabase.from("executions")
      .select("id, automation_id, status, started_at, finished_at, error, automations(name)")
      .order("started_at", { ascending: false }).limit(200);
    setRows((data ?? []) as unknown as Row[]);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel("exes").on("postgres_changes", { event: "*", schema: "public", table: "executions" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Exécutions</h1>
        <p className="text-sm text-muted-foreground mt-1">Historique global des runs avec logs détaillés.</p>
      </div>
      <GlassCard>
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Aucune exécution.</p>}
          {rows.map((e) => (
            <Link key={e.id} to="/executions/$id" params={{ id: e.id }}
              className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:bg-white/[0.05] transition-colors">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{e.automations?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{format(new Date(e.started_at), "dd MMM yyyy HH:mm:ss", { locale: fr })}</div>
                {e.error && <div className="text-xs text-red-300 mt-0.5 truncate max-w-md">{e.error}</div>}
              </div>
              <StatusBadge status={e.status} />
            </Link>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
