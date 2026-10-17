import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCostsSummary } from "@/lib/automations.functions";
import { GlassCard } from "@/components/glass-card";
import { Coins, TrendingDown, Zap, BarChart3, Lightbulb, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_mm/costs")({
  head: () => ({ meta: [{ title: "Coûts · Nexus" }] }),
  component: CostsPage,
});

type Row = {
  automation_id: string | null;
  model: string;
  cost_usd: number | string;
  input_tokens: number;
  output_tokens: number;
  provider: string;
  created_at: string;
};

function CostsPage() {
  const get = useServerFn(getCostsSummary);
  const [rows, setRows] = useState<Row[]>([]);
  const [autos, setAutos] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await get();
        setRows(r.rows as unknown as Row[]);
        setAutos(r.autos as unknown as { id: string; name: string }[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nameOf = (id: string | null) => autos.find((a) => a.id === id)?.name ?? "—";

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const tokIn = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const tokOut = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
    const byModel = new Map<string, { cost: number; runs: number; tokens: number }>();
    const byAutomation = new Map<string, { cost: number; runs: number }>();
    const byProvider = new Map<string, number>();
    for (const r of rows) {
      const c = Number(r.cost_usd || 0);
      const m = byModel.get(r.model) ?? { cost: 0, runs: 0, tokens: 0 };
      m.cost += c; m.runs++; m.tokens += (r.input_tokens || 0) + (r.output_tokens || 0);
      byModel.set(r.model, m);
      const key = r.automation_id ?? "unknown";
      const a = byAutomation.get(key) ?? { cost: 0, runs: 0 };
      a.cost += c; a.runs++;
      byAutomation.set(key, a);
      byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + c);
    }
    // 7-day trend
    const day = (iso: string) => iso.slice(0, 10);
    const days = new Map<string, number>();
    for (const r of rows) days.set(day(r.created_at), (days.get(day(r.created_at)) ?? 0) + Number(r.cost_usd || 0));
    return { total, tokIn, tokOut, byModel, byAutomation, byProvider, days };
  }, [rows]);

  const advice = useMemo(() => {
    const tips: string[] = [];
    let heaviest: { model: string; cost: number } | null = null;
    stats.byModel.forEach((v, k) => {
      if (!heaviest || v.cost > heaviest.cost) heaviest = { model: k, cost: v.cost };
    });
    const h = heaviest as { model: string; cost: number } | null;
    if (h && h.model.includes("pro")) {
      tips.push(`⚡ Le modèle « ${h.model} » représente $${h.cost.toFixed(4)}. Basculez les agents non critiques vers Gemini 2.5 Flash Lite ou GPT-5 Nano pour diviser les coûts par ~10.`);
    }
    if (stats.total > 1) tips.push("💡 Activez BYOK dans Paramètres → Clés IA pour utiliser votre propre clé OpenAI/Gemini et payer directement le fournisseur.");
    const noisy = [...stats.byAutomation.entries()].sort((a, b) => b[1].runs - a[1].runs)[0];
    if (noisy && noisy[1].runs > 30) tips.push(`🔁 « ${nameOf(noisy[0])} » a été exécutée ${noisy[1].runs} fois. Augmentez son cron (ex : de */5 à */15) si les données changent moins souvent.`);
    if (stats.tokIn > 200000) tips.push("📝 Réduisez la longueur des instructions d'agent et limitez les listes Gmail à `maxResults` = 10-20 pour économiser des tokens en entrée.");
    if (!tips.length) tips.push("✅ Vos coûts sont sains. Continuez ainsi !");
    return tips;
  }, [stats, autos]);

  if (loading) return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Chargement des coûts…</div>;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2">
        <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Coins className="size-7 text-primary" /> Coûts & Optimisation</h1>
        <p className="text-sm text-muted-foreground mt-1">Analyse des 30 derniers jours de vos exécutions IA. Coûts estimés en $ (Lovable AI). BYOK = $0 côté plateforme.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Kpi icon={<Coins className="size-5" />} label="Coût total (30j)" value={`$${stats.total.toFixed(4)}`} accent="from-primary/40" />
        <Kpi icon={<Zap className="size-5" />} label="Tokens entrée" value={stats.tokIn.toLocaleString("fr-FR")} accent="from-emerald-500/40" />
        <Kpi icon={<Zap className="size-5" />} label="Tokens sortie" value={stats.tokOut.toLocaleString("fr-FR")} accent="from-amber-500/40" />
        <Kpi icon={<BarChart3 className="size-5" />} label="Exécutions IA" value={String(rows.length)} accent="from-sky-500/40" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <GlassCard className="relative overflow-hidden">
          <div className="absolute -top-16 -right-16 size-40 rounded-full bg-primary/20 blur-3xl" />
          <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="size-4 text-primary" /> Coût par modèle</h3>
          <div className="mt-3 space-y-2">
            {[...stats.byModel.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([model, v]) => (
              <div key={model} className="flex items-center justify-between text-sm rounded-lg bg-white/30 px-3 py-2">
                <span className="truncate font-mono text-xs">{model}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{v.runs} runs</span>
                  <span className="font-semibold">${v.cost.toFixed(4)}</span>
                </div>
              </div>
            ))}
            {!stats.byModel.size && <p className="text-xs text-muted-foreground">Aucune donnée pour le moment.</p>}
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden">
          <div className="absolute -top-16 -right-16 size-40 rounded-full bg-amber-500/20 blur-3xl" />
          <h3 className="font-semibold flex items-center gap-2"><TrendingDown className="size-4 text-primary" /> Coût par automatisation</h3>
          <div className="mt-3 space-y-2">
            {[...stats.byAutomation.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 8).map(([id, v]) => (
              <div key={id} className="flex items-center justify-between text-sm rounded-lg bg-white/30 px-3 py-2">
                <span className="truncate">{nameOf(id)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{v.runs} runs</span>
                  <span className="font-semibold">${v.cost.toFixed(4)}</span>
                </div>
              </div>
            ))}
            {!stats.byAutomation.size && <p className="text-xs text-muted-foreground">Aucune donnée.</p>}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="relative overflow-hidden">
        <div className="absolute -top-20 -left-20 size-56 rounded-full bg-emerald-500/20 blur-3xl animate-pulse" />
        <h3 className="font-semibold flex items-center gap-2"><Lightbulb className="size-4 text-primary" /> Conseils en temps réel</h3>
        <ul className="mt-3 space-y-2">
          {advice.map((a, i) => (
            <li key={i} className="text-sm rounded-lg bg-white/40 px-3 py-2 animate-in fade-in slide-in-from-left-2" style={{ animationDelay: `${i * 60}ms` }}>{a}</li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard>
        <h3 className="font-semibold">Derniers appels IA</h3>
        <div className="mt-3 divide-y divide-foreground/10">
          {rows.slice(0, 20).map((r, i) => (
            <div key={i} className="py-2 grid grid-cols-6 gap-2 text-xs items-center">
              <span className="col-span-2 font-mono truncate">{r.model}</span>
              <span className="text-muted-foreground">{r.provider}</span>
              <span>{r.input_tokens}→{r.output_tokens}</span>
              <span className="font-semibold">${Number(r.cost_usd).toFixed(5)}</span>
              <span className="text-muted-foreground text-right">{new Date(r.created_at).toLocaleString("fr-FR")}</span>
            </div>
          ))}
          {!rows.length && <p className="text-xs text-muted-foreground py-4">Rien encore. Lancez une automatisation pour voir apparaître les coûts.</p>}
        </div>
      </GlassCard>
    </div>
  );
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <GlassCard className="relative overflow-hidden">
      <div className={`absolute -top-10 -right-10 size-32 rounded-full bg-gradient-to-br ${accent} to-transparent blur-2xl`} />
      <div className="relative">
        <div className="text-primary">{icon}</div>
        <div className="text-xs text-muted-foreground mt-2">{label}</div>
        <div className="text-2xl font-bold font-display mt-1">{value}</div>
      </div>
    </GlassCard>
  );
}
