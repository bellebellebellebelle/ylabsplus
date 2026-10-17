import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle2, XCircle, ExternalLink, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/journal")({ component: JournalPage });

function JournalPage() {
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["actions-log"],
    queryFn: async () => (await supabase.from("agent_actions_log").select("*").order("created_at", { ascending: false }).limit(200)).data ?? [],
  });

  useEffect(() => {
    const ch = supabase.channel("actions-log")
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_actions_log" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch]);

  const filtered = useMemo(() => (data ?? []).filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (source !== "all" && item.source !== source) return false;
    return !query || item.tool_name.toLowerCase().includes(query.toLowerCase());
  }), [data, query, source, status]);

  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><Activity className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Journal des actions</h1></header>
      <div className="mx-auto mb-4 grid max-w-4xl gap-2 sm:grid-cols-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer par action…" className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm outline-none" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm outline-none"><option value="all">Tous les états</option><option value="success">Réussies</option><option value="error">Échouées</option></select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm outline-none"><option value="all">Toutes les sources</option><option value="web">Interface</option><option value="voice">Voix</option><option value="google-chat">Google Chat</option></select>
      </div>
      <div className="mx-auto max-w-4xl space-y-2">
        {filtered.map((a: any) => (
          <details key={a.id} className="bento p-4">
            <summary className="flex cursor-pointer items-center gap-3">
              {a.status === "success" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
              <span className="font-mono text-sm">{a.tool_name}</span>
              {a.attempt > 1 && <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><RotateCcw className="h-3 w-3" />{a.attempt}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("fr-FR")}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{a.source}</span>
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Args</p>
                <pre className="overflow-auto rounded-lg bg-black/30 p-2 text-[11px]">{JSON.stringify(a.args, null, 2)}</pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Résultat</p>
                <pre className="overflow-auto rounded-lg bg-black/30 p-2 text-[11px]">{JSON.stringify(a.result, null, 2)}</pre>
              </div>
            </div>
            {a.error_detail && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive-foreground">{a.error_detail}</p>}
            {a.verification_url && <a href={a.verification_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">Vérifier le résultat <ExternalLink className="h-3 w-3" /></a>}
          </details>
        ))}
        {!filtered.length && <p className="text-sm text-muted-foreground">Aucune action ne correspond aux filtres.</p>}
      </div>
    </div>
  );
}
