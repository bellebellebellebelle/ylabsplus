import { cn } from "@/lib/utils";

type Status = "draft" | "active" | "paused" | "pending" | "running" | "success" | "error";

const config: Record<Status, { label: string; cls: string }> = {
  draft:    { label: "Brouillon",  cls: "bg-white/5 text-muted-foreground border-white/10" },
  active:   { label: "Active",     cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  paused:   { label: "En pause",   cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  pending:  { label: "En attente", cls: "bg-white/5 text-muted-foreground border-white/10" },
  running:  { label: "En cours",   cls: "bg-sky-500/15 text-sky-300 border-sky-500/30 animate-pulse" },
  success:  { label: "Succès",     cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  error:    { label: "Erreur",     cls: "bg-red-500/15 text-red-300 border-red-500/30" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const c = config[status] ?? config.draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", c.cls, className)}>
      <span className="size-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}
