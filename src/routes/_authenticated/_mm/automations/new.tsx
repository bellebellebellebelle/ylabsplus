import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/glass-card";
import { GlowButton } from "@/components/glow-button";
import { Sparkles, Mail, Calendar, ListTodo, FolderOpen, FileText, Sheet, ClipboardList, Zap } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { analyzeAndCreate, setAutomationStatus, AI_MODELS } from "@/lib/automations.functions";

export const Route = createFileRoute("/_authenticated/_mm/automations/new")({
  head: () => ({ meta: [{ title: "Nouvelle automatisation · Nexus" }] }),
  component: NewAutomation,
});

const EXAMPLES = [
  { icon: Mail, t: "Toutes les 5 minutes, vérifier mes nouveaux emails non lus et créer une tâche Google Tasks pour chacun, en évitant les doublons." },
  { icon: Calendar, t: "Chaque lundi à 9h, lister mes événements de la semaine et m'envoyer un email récapitulatif." },
  { icon: ListTodo, t: "Toutes les 15 minutes, transformer les emails contenant '[TODO]' en tâches puis archiver les emails traités." },
  { icon: FolderOpen, t: "Toutes les 30 minutes, classer les nouveaux PDF de mon Drive racine dans le dossier 'À traiter'." },
  { icon: Sheet, t: "Chaque heure, ajouter dans Google Sheets une ligne par nouvel email reçu de mes clients." },
  { icon: ClipboardList, t: "Tous les jours à 18h, exporter les nouvelles réponses de mon Google Form vers une Sheet." },
];

function NewAutomation() {
  const nav = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>("google/gemini-2.5-flash");
  const [creating, setCreating] = useState(false);
  const createAll = useServerFn(analyzeAndCreate);
  const setStatus = useServerFn(setAutomationStatus);

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (detail?.text) setPrompt((p) => (p ? p + " " : "") + detail.text);
    }
    window.addEventListener("nexus:voice", handle);
    return () => window.removeEventListener("nexus:voice", handle);
  }, []);

  async function onCreate(activate: boolean) {
    if (prompt.trim().length < 10) { toast.error("Décrivez votre automatisation."); return; }
    setCreating(true);
    try {
      const res = await createAll({ data: { description: prompt, model } });
      if (activate) await setStatus({ data: { id: res.id, status: "active" } });
      toast.success(activate ? "Automatisation créée et activée" : "Brouillon créé");
      nav({ to: "/automations/$id", params: { id: res.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2">
        <h1 className="text-3xl font-bold tracking-tight font-display">Nouvelle automatisation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Décrivez votre besoin en français. L'IA conçoit et crée l'automatisation en <span className="font-semibold text-primary">un seul appel</span>.
        </p>
      </div>

      <GlassCard className="animate-in fade-in slide-in-from-bottom-3">
        <label className="text-sm font-medium">Description en langage naturel</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex: Toutes les 5 minutes, vérifier mes nouveaux emails non lus et créer une tâche Google Tasks pour chacun..."
          rows={5}
          className="mt-2 w-full rounded-xl bg-white/40 border border-foreground/10 px-4 py-3 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 resize-none transition-all"
        />
        <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {EXAMPLES.map((ex, i) => (
            <button key={i} onClick={() => setPrompt(ex.t)} className="press text-left text-xs p-3 rounded-xl border border-foreground/10 bg-white/30 hover:bg-white/60 transition-colors">
              <ex.icon className="size-3.5 mb-1.5 text-primary" /> {ex.t}
            </button>
          ))}
        </div>

        <div className="mt-4 grid sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Modèle IA</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/40 border border-foreground/10 px-3 py-2 text-sm">
              {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <GlowButton variant="ghost" onClick={() => onCreate(false)} disabled={creating}>Brouillon</GlowButton>
            <GlowButton onClick={() => onCreate(true)} disabled={creating}>
              <Sparkles className="size-4" /> {creating ? "Création…" : "Créer & activer"} <Zap className="size-4" />
            </GlowButton>
          </div>
        </div>
      </GlassCard>

      <div className="text-xs text-muted-foreground text-center">
        Les automatisations sont pilotées par Cron. L'IA détecte automatiquement l'intervalle dans votre demande.
      </div>
    </div>
  );
}
