import { Button } from "@/components/ui/button";
import { Crown, Cpu, GripVertical, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Agent, Task } from "@/lib/smart-teams/board-data";
import { NOTE_BG, MODELS } from "@/lib/smart-teams/agent-config";
import { cn } from "@/lib/utils";

type Props = {
  agent: Agent;
  teamName?: string | undefined;
  tasks: Task[];
  selected: boolean;
  onPointerDownDrag: (event: React.PointerEvent, agent: Agent) => void;
  onOpen: (agent: Agent) => void;
};

function StatusIcon({ status }: { status: string }) {
  if (status === "working") return <Loader2 className="size-3.5 animate-spin" />;
  if (status === "done") return <CheckCircle2 className="size-3.5" />;
  if (status === "error") return <AlertTriangle className="size-3.5" />;
  return <span className="size-2 rounded-full bg-note-ink/50" />;
}

export function AgentNote({
  agent,
  teamName,
  tasks,
  selected,
  onPointerDownDrag,
  onOpen,
}: Props) {
  const model = MODELS.find((m) => m.id === agent.model)?.label ?? agent.model;
  const open = tasks.filter((t) => t.status === "todo" || t.status === "running").length;
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <div
      className={cn(
        "note-surface absolute w-[232px] select-none rounded-[4px] rounded-br-2xl p-3 transition-transform",
        NOTE_BG[agent.color] ?? NOTE_BG["autre"],
        selected ? "ring-2 ring-primary" : "ring-1 ring-note-ink/10",
      )}
      style={{ left: agent.pos_x, top: agent.pos_y }}
      onDoubleClick={() => onOpen(agent)}
    >
      <div className="flex items-start gap-1.5">
        <Button variant="ghost"
          aria-label="Déplacer le post-it"
          className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-note-ink/50 hover:bg-note-ink/10 active:cursor-grabbing"
          onPointerDown={(e) => onPointerDownDrag(e, agent)}
        >
          <GripVertical className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {agent.is_chief && <Crown className="size-3.5 shrink-0" />}
            <p className="truncate font-display text-[15px] font-semibold leading-tight">
              {agent.name}
            </p>
          </div>
          <p className="truncate text-xs font-medium opacity-70">
            {agent.role || "Rôle à définir"}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-note-ink/10 px-1.5 py-0.5 text-[10px] font-semibold">
          <StatusIcon status={agent.status} />
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-[11px] leading-snug opacity-75">
        {agent.skills || agent.system_prompt || "Aucune expertise renseignée."}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
        <span className="flex items-center gap-1 rounded bg-note-ink/10 px-1.5 py-0.5">
          <Cpu className="size-3" /> {model}
        </span>
        {teamName && (
          <span className="max-w-[110px] truncate rounded bg-note-ink/10 px-1.5 py-0.5">
            {teamName}
          </span>
        )}
        {open > 0 && (
          <span className="rounded bg-note-ink/80 px-1.5 py-0.5 text-note-marketing">
            {open} en cours
          </span>
        )}
        {done > 0 && <span className="rounded bg-note-ink/10 px-1.5 py-0.5">{done} livré(s)</span>}
      </div>

      <Button variant="ghost"
        onClick={() => onOpen(agent)}
        className="mt-2.5 w-full rounded-md bg-note-ink/85 px-2 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-85"
      >
        Configurer l'agent
      </Button>
    </div>
  );
}
