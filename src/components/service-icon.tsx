import { Mail, Calendar, ListTodo, FolderOpen, FileText, Sheet, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Mail> = {
  gmail: Mail, calendar: Calendar, tasks: ListTodo,
  drive: FolderOpen, docs: FileText, sheets: Sheet, forms: ClipboardList,
};

export function ServiceIcon({ service, className }: { service: string; className?: string }) {
  const C = ICONS[service];
  return C ? <C className={cn("size-4", className)} /> : null;
}

export function ServiceChip({ service }: { service: string }) {
  const colors: Record<string, string> = {
    gmail: "bg-red-500/15 text-red-700 border-red-500/30",
    calendar: "bg-blue-500/15 text-blue-700 border-blue-500/30",
    tasks: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    drive: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
    docs: "bg-sky-500/15 text-sky-700 border-sky-500/30",
    sheets: "bg-green-500/15 text-green-700 border-green-500/30",
    forms: "bg-violet-500/15 text-violet-700 border-violet-500/30",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs", colors[service] ?? "bg-foreground/5 border-foreground/10")}>
      <ServiceIcon service={service} className="size-3" />
      {service}
    </span>
  );
}
