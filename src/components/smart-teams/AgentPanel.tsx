import { useEffect, useState } from "react";
import { Sparkles, Trash2, X, Crown } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEPARTMENTS, MODELS, ROLE_SUGGESTIONS, NOTE_BG } from "@/lib/smart-teams/agent-config";
import { deleteAgent, updateAgent, type Agent, type Team } from "@/lib/smart-teams/board-data";
import { draftAgentPrompt } from "@/lib/smart-teams/ai.functions";
import { cn } from "@/lib/utils";

type Props = {
  agent: Agent;
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
};

export function AgentPanel({ agent, teams, onClose, onSaved }: Props) {
  const [form, setForm] = useState(agent);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const draft = useServerFn(draftAgentPrompt);

  useEffect(() => setForm(agent), [agent]);

  const set = <K extends keyof Agent>(key: K, value: Agent[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      await updateAgent(agent.id, {
        name: form.name.trim() || "Agent",
        role: form.role,
        department: form.department,
        team_id: form.team_id,
        is_chief: form.is_chief,
        model: form.model,
        system_prompt: form.system_prompt,
        temperature: form.temperature,
        skills: form.skills,
        tone: form.tone,
        color: form.color,
      });
      toast.success("Agent mis à jour");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function generatePrompt() {
    setDrafting(true);
    try {
      const res = await draft({
        data: { department: form.department, role: form.role, name: form.name },
      });
      set("system_prompt", res.prompt);
      toast.success("Instructions générées");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setDrafting(false);
    }
  }

  const teamOptions = teams.filter((t) => t.department === form.department);

  return (
    <aside className="scroll-slim absolute inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col overflow-y-auto border-l border-border st-panel">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold">{form.name}</p>
          <p className="text-xs text-muted-foreground">Configuration de l'agent</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X className="size-4" />
        </Button>
      </header>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Nom</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Rôle</Label>
            <Input
              value={form.role}
              placeholder="Ex. Copywriter"
              onChange={(e) => set("role", e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(ROLE_SUGGESTIONS[form.department] ?? []).map((r) => (
            <Button variant="ghost"
              key={r}
              onClick={() => set("role", r)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {r}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Département</Label>
            <Select
              value={form.department}
              onValueChange={(v) => {
                set("department", v);
                set("color", v);
                set("team_id", null);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Équipe</Label>
            <Select
              value={form.team_id ?? "none"}
              onValueChange={(v) => set("team_id", v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sans équipe</SelectItem>
                {teamOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Crown className="size-4 text-accent" />
            <div>
              <p className="text-sm font-medium">Chef d'équipe</p>
              <p className="text-xs text-muted-foreground">Reçoit les ordres de mission</p>
            </div>
          </div>
          <Switch checked={form.is_chief} onCheckedChange={(v) => set("is_chief", v)} />
        </div>

        <div className="space-y-1.5">
          <Label>Modèle IA</Label>
          <Select value={form.model} onValueChange={(v) => set("model", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="font-medium">{m.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{m.hint}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Expertises</Label>
          <Input
            value={form.skills}
            placeholder="SEO, storytelling, analyse concurrentielle"
            onChange={(e) => set("skills", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Ton / style</Label>
          <Input
            value={form.tone}
            placeholder="Direct, chiffré, orienté résultats"
            onChange={(e) => set("tone", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Instructions détaillées</Label>
            <Button variant="ghost" size="sm" onClick={generatePrompt} disabled={drafting}>
              <Sparkles className="mr-1 size-3.5" />
              {drafting ? "..." : "Affiner par IA"}
            </Button>
          </div>
          <Textarea
            rows={7}
            value={form.system_prompt}
            placeholder="Méthodes de travail, contraintes, format des livrables..."
            onChange={(e) => set("system_prompt", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Créativité</Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {Number(form.temperature).toFixed(2)}
            </span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[Number(form.temperature)]}
            onValueChange={([v]) => set("temperature", v ?? 0.6)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Couleur du post-it</Label>
          <div className="flex flex-wrap gap-2">
            {Object.keys(NOTE_BG).map((key) => (
              <Button variant="ghost"
                key={key}
                aria-label={`Couleur ${key}`}
                onClick={() => set("color", key)}
                className={cn(
                  "size-7 rounded-md",
                  NOTE_BG[key],
                  form.color === key ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : "",
                )}
              />
            ))}
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 flex gap-2 border-t border-border bg-surface/95 p-4">
        <Button className="flex-1" onClick={save} disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Supprimer l'agent"
          onClick={async () => {
            await deleteAgent(agent.id);
            toast.success("Agent supprimé");
            onClose();
            onSaved();
          }}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </footer>
    </aside>
  );
}
