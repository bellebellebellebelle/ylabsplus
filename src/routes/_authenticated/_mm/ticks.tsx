import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTickLogs } from "@/lib/tools.functions";
import { GlassCard } from "@/components/glass-card";
import { Radio, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_mm/ticks")({
  head: () => ({ meta: [{ title: "Journal Cron · Nexus" }] }),
  component: TicksPage,
});

type TickResult = {
  triggerId: string;
  executionId?: string;
  status: "success" | "error";
  error?: string;
  attempts?: number;
  retryAt?: string;
  disabled?: boolean;
  automation_id?: string | null;
};
type Tick = {
  id: string;
  ran_at: string;
  duration_ms: number;
  launched_count: number;
  results: TickResult[];
  error: string | null;
};

function TicksPage() {
  const get = useServerFn(getTickLogs);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [autos, setAutos] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAuto, setFilterAuto] = useState<string>("");
  const [onlyMine, setOnlyMine] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await get();
        setTicks(r.ticks as unknown as Tick[]);
        setAutos(r.autos);
      } finally { setLoading(false); }
    })();
    const t = setInterval(async () => {
      const r = await get();
      setTicks(r.ticks as unknown as Tick[]);
    }, 15000);
    return () => clearInterval(t);
  }, []);

  const autoNames = useMemo(() => new Map(autos.map((a) => [a.id, a.name])), [autos]);
  const myAutoIds = useMemo(() => new Set(autos.map((a) => a.id)), [autos]);

  const filtered = useMemo(() => {
    return ticks.map((t) => ({
      ...t,
      results: (t.results ?? []).filter((r) => {
        if (onlyMine && r.automation_id && !myAutoIds.has(r.automation_id)) return false;
        if (filterAuto && r.automation_id !== filterAuto) return false;
        return true;
      }),
    })).filter((t) => t.results.length || !onlyMine);
  }, [ticks, filterAuto, onlyMine, myAutoIds]);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Radio className="size-7 text-primary animate-pulse" /> Journal des ticks cron</h1>
        <p className="text-sm text-muted-foreground mt-1">Chaque minute, le cron déclenche <code className="font-mono text-xs bg-white/40 px-1 rounded">/tick</code>. Voici les exécutions lancées, les erreurs et durées.</p>
      </div>

      <GlassCard className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Uniquement mes automatisations
        </label>
        <select className="rounded-lg bg-white/40 px-3 py-2 text-sm" value={filterAuto} onChange={(e) => setFilterAuto(e.target.value)}>
          <option value="">Toutes mes automatisations</option>
          {autos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">Actualisation auto toutes les 15s · {ticks.length} ticks récents</span>
      </GlassCard>

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Chargement…</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <GlassCard key={t.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium">{new Date(t.ran_at).toLocaleString("fr-FR")}</div>
                  <div className="text-xs text-muted-foreground">{t.launched_count} déclenchement(s) · {t.duration_ms} ms</div>
                </div>
                {t.error && <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="size-3.5" /> {t.error}</span>}
              </div>
              {t.results.length > 0 && (
                <div className="mt-3 divide-y divide-foreground/10">
                  {t.results.map((r, i) => (
                    <div key={i} className="py-2 grid grid-cols-6 gap-2 items-center text-xs">
                      <span className="col-span-2 truncate">{r.automation_id ? autoNames.get(r.automation_id) ?? "—" : "—"}</span>
                      <span className="flex items-center gap-1">
                        {r.status === "success" ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <XCircle className="size-3.5 text-red-600" />}
                        {r.status}
                      </span>
                      <span className="text-muted-foreground">Tentative #{r.attempts ?? 1}</span>
                      <span className="text-muted-foreground truncate">{r.retryAt ? `Retry: ${new Date(r.retryAt).toLocaleTimeString("fr-FR")}` : ""}</span>
                      <span className="text-red-600 truncate" title={r.error ?? ""}>{r.error ?? ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          ))}
          {!filtered.length && (
            <GlassCard><p className="text-sm text-muted-foreground">Aucun tick pour le moment. Attendez la prochaine minute ou activez une automatisation.</p></GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
