import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Crown, Loader2, Play, Send, Trash2, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deleteTask, type Agent, type Mission, type Task, type Team } from "@/lib/smart-teams/board-data";
import { planMission, runTask } from "@/lib/smart-teams/ai.functions";
import { cn } from "@/lib/utils";

type Props = {
  team: Team;
  agents: Agent[];
  missions: Mission[];
  tasks: Task[];
  onClose: () => void;
  onChanged: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  todo: "À faire",
  running: "En cours",
  done: "Livré",
  error: "Erreur",
};

export function MissionPanel({ team, agents, missions, tasks, onClose, onChanged }: Props) {
  const [objective, setObjective] = useState("");
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState<string[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);

  const plan = useServerFn(planMission);
  const run = useServerFn(runTask);

  const chief = useMemo(() => agents.find((a) => a.is_chief) ?? agents[0], [agents]);
  const teamMissions = missions.filter((m) => m.team_id === team.id);
  const teamTasks = tasks.filter((t) => t.team_id === team.id);
  const pending = teamTasks.filter((t) => t.status === "todo");

  async function dispatch() {
    if (objective.trim().length < 4) {
      toast.error("Décrivez l'ordre de mission.");
      return;
    }
    setPlanning(true);
    try {
      const res = await plan({ data: { teamId: team.id, objective: objective.trim() } });
      toast.success(`${res.count} tâche(s) attribuée(s) par le chef`);
      setObjective("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Le chef n'a pas pu planifier.");
    } finally {
      setPlanning(false);
    }
  }

  async function execute(taskId: string) {
    setRunning((r) => [...r, taskId]);
    try {
      await run({ data: { taskId } });
      toast.success("Livrable produit");
      setOpenTask(taskId);
      onChanged();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Exécution échouée");
      return false;
    } finally {
      setRunning((r) => r.filter((id) => id !== taskId));
      onChanged();
    }
  }

  async function executeAll() {
    for (const task of pending) {
      // Séquentiel : évite de saturer la passerelle IA.
      if (!(await execute(task.id))) break;
    }
  }

  return (
    <aside className="scroll-slim absolute inset-y-0 right-0 z-30 flex w-full max-w-[460px] flex-col overflow-y-auto border-l border-border st-panel">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold">{team.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {chief ? (
              <span className="inline-flex items-center gap-1">
                <Crown className="size-3 text-accent" /> Chef : {chief.name}
              </span>
            ) : (
              "Aucun chef désigné"
            )}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X className="size-4" />
        </Button>
      </header>

      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <Label>Ordre de mission au chef</Label>
          <Textarea
            rows={4}
            value={objective}
            placeholder="Ex. Prépare le lancement de notre nouvelle offre : positionnement, plan de campagne 30 jours et 5 contenus prêts à publier."
            onChange={(e) => setObjective(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={dispatch} disabled={planning || agents.length === 0}>
              {planning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Confier la mission
            </Button>
            {pending.length > 0 && (
              <Button variant="secondary" onClick={executeAll} disabled={running.length > 0}>
                <Play className="size-4" />
                Lancer {pending.length} tâche(s)
              </Button>
            )}
          </div>
          {agents.length === 0 && (
            <p className="text-xs text-destructive">
              Ajoutez au moins un agent à cette équipe pour lui confier une mission.
            </p>
          )}
        </section>

        {teamMissions.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Missions
            </p>
            {teamMissions.slice(0, 4).map((m) => (
              <div key={m.id} className="rounded-xl border border-border bg-secondary/30 p-3">
                <p className="text-sm font-medium">{m.objective}</p>
                {m.summary && (
                  <p className="mt-1 text-xs text-muted-foreground">Stratégie : {m.summary}</p>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tâches & livrables ({teamTasks.length})
          </p>
          {teamTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucune tâche pour le moment. Confiez un ordre de mission au chef d'équipe.
            </p>
          )}
          {teamTasks.map((task) => {
            const owner = agents.find((a) => a.id === task.agent_id);
            const busy = running.includes(task.id) || task.status === "running";
            const open = openTask === task.id;
            return (
              <div key={task.id} className="rounded-xl border border-border bg-surface/60 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {owner?.name ?? "Non assigné"} ·{" "}
                      <span
                        className={cn(
                          task.status === "done" && "text-primary",
                          task.status === "error" && "text-destructive",
                        )}
                      >
                        {STATUS_LABEL[task.status] ?? task.status}
                      </span>
                    </p>
                  </div>
                  {task.status !== "done" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => execute(task.id)}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      Exécuter
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Supprimer la tâche"
                    onClick={async () => {
                      await deleteTask(task.id);
                      onChanged();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <Button variant="ghost"
                  onClick={() => setOpenTask(open ? null : task.id)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                  {task.result ? "Livrable" : "Consigne"}
                </Button>

                {open && (
                  <div className="scroll-slim mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-2.5 text-xs leading-relaxed">
                    {task.result || task.brief || "—"}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </aside>
  );
}
