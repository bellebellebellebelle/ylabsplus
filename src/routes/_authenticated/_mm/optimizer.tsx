import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/glass-card";
import { GlowButton } from "@/components/glow-button";
import { Wand2, CheckCircle2, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { optimizeAutomation, applyOptimization } from "@/lib/automations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_mm/optimizer")({
  head: () => ({ meta: [{ title: "Optimiseur IA · Nexus" }] }),
  component: Optimizer,
});

type Reco = { title: string; detail: string; impact: "low" | "medium" | "high" };
type AnalysisResult = {
  score: number;
  strengths: string[];
  issues: string[];
  recommendations: Reco[];
  suggested_cron: string | null;
  suggested_instructions: Record<string, string>;
};

function Optimizer() {
  const [autos, setAutos] = useState<{ id: string; name: string; status: string }[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const optimize = useServerFn(optimizeAutomation);
  const apply = useServerFn(applyOptimization);

  useEffect(() => {
    supabase.from("automations").select("id, name, status").order("created_at", { ascending: false }).then(({ data }) => setAutos(data ?? []));
  }, []);

  async function onOptimize() {
    if (!selected) { toast.error("Sélectionnez une automatisation"); return; }
    setLoading(true); setResult(null);
    try {
      const r = await optimize({ data: { id: selected } });
      setResult(r as AnalysisResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setLoading(false); }
  }

  async function onApply() {
    if (!result || !selected) return;
    setApplying(true);
    try {
      await apply({ data: { id: selected, suggested_cron: result.suggested_cron, suggested_instructions: result.suggested_instructions } });
      toast.success("Optimisations appliquées");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setApplying(false); }
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2">
        <h1 className="text-3xl font-bold tracking-tight font-display flex items-center gap-2"><Wand2 className="size-7 text-primary" /> Optimiseur IA</h1>
        <p className="text-sm text-muted-foreground mt-1">Sélectionnez une automatisation et laissez Lovable AI l'auditer et l'améliorer.</p>
      </div>

      <GlassCard className="animate-in fade-in slide-in-from-bottom-2">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Automatisation à analyser</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/40 border border-foreground/10 px-3 py-2.5 text-sm">
              <option value="">— Choisir —</option>
              {autos.map((a) => <option key={a.id} value={a.id}>{a.name} {a.status === "active" ? "·  actif" : ""}</option>)}
            </select>
          </div>
          <GlowButton onClick={onOptimize} disabled={loading || !selected}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {loading ? "Analyse…" : "Analyser"}
          </GlowButton>
        </div>
      </GlassCard>

      {result && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3">
          <GlassCard>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Score de qualité</div>
                <div className="text-5xl font-bold font-display text-gradient">{result.score}/100</div>
              </div>
              <div className="size-20 rounded-full holo-gradient animate-holo holo-glow flex items-center justify-center text-white font-bold text-2xl">
                {result.score >= 80 ? "A" : result.score >= 60 ? "B" : result.score >= 40 ? "C" : "D"}
              </div>
            </div>
          </GlassCard>

          <div className="grid md:grid-cols-2 gap-4">
            <GlassCard>
              <h3 className="font-semibold flex items-center gap-2 text-emerald-700"><CheckCircle2 className="size-4" /> Points forts</h3>
              <ul className="mt-3 space-y-1.5 text-sm">
                {result.strengths?.map((s, i) => <li key={i} className="flex gap-2"><span className="text-emerald-600">•</span> {s}</li>)}
              </ul>
            </GlassCard>
            <GlassCard>
              <h3 className="font-semibold flex items-center gap-2 text-amber-700"><AlertTriangle className="size-4" /> Problèmes</h3>
              <ul className="mt-3 space-y-1.5 text-sm">
                {result.issues?.map((s, i) => <li key={i} className="flex gap-2"><span className="text-amber-600">•</span> {s}</li>)}
              </ul>
            </GlassCard>
          </div>

          <GlassCard>
            <h3 className="font-semibold flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Recommandations</h3>
            <div className="mt-3 space-y-2">
              {result.recommendations?.map((r, i) => (
                <div key={i} className="rounded-xl border border-foreground/10 p-3 bg-white/30 animate-in fade-in slide-in-from-left-2" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{r.title}</div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${r.impact === "high" ? "bg-red-500/15 text-red-700" : r.impact === "medium" ? "bg-amber-500/15 text-amber-700" : "bg-emerald-500/15 text-emerald-700"}`}>{r.impact}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{r.detail}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          {(result.suggested_cron || (result.suggested_instructions && Object.keys(result.suggested_instructions).length > 0)) && (
            <GlassCard>
              <h3 className="font-semibold">Appliquer les optimisations</h3>
              {result.suggested_cron && (
                <p className="text-xs text-muted-foreground mt-2">Nouveau cron suggéré: <code className="font-mono text-primary">{result.suggested_cron}</code></p>
              )}
              {result.suggested_instructions && Object.keys(result.suggested_instructions).length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{Object.keys(result.suggested_instructions).length} agent(s) avec nouvelles instructions.</p>
              )}
              <div className="mt-4">
                <GlowButton onClick={onApply} disabled={applying}>
                  {applying ? "Application…" : "Appliquer les optimisations"}
                </GlowButton>
              </div>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
