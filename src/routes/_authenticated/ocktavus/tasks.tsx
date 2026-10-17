import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsTasks, wsTaskLists } from "@/lib/workspace.functions";
import { useState } from "react";
import { CheckSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/tasks")({ component: TasksPage });

function TasksPage() {
  const tl = useServerFn(wsTaskLists);
  const tk = useServerFn(wsTasks);
  const lists = useQuery({ queryKey: ["tasklists"], queryFn: () => tl({ data: undefined as any }) });
  const [active, setActive] = useState<string | undefined>();
  const id = active ?? (lists.data?.items?.[0]?.id as string | undefined);
  const tasks = useQuery({ queryKey: ["tasks", id], enabled: !!id, queryFn: () => tk({ data: { taskListId: id } }) });

  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><CheckSquare className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Tâches</h1></header>
      <div className="mb-3 flex flex-wrap gap-2">
        {(lists.data?.items ?? []).map((l: any) => (
          <button key={l.id} onClick={() => setActive(l.id)} className={`rounded-full border border-border px-3 py-1 text-xs ${id === l.id ? "bg-primary text-primary-foreground" : "bg-card/60"}`}>{l.title}</button>
        ))}
      </div>
      <ul className="mx-auto max-w-2xl space-y-2">
        {(tasks.data?.items ?? []).map((t: any) => (
          <li key={t.id} className="bento flex items-start gap-3 p-3">
            <input type="checkbox" defaultChecked={t.status === "completed"} className="mt-1" readOnly />
            <div className="flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
              {t.due && <p className="text-xs text-primary">⏰ {new Date(t.due).toLocaleDateString("fr-FR")}</p>}
            </div>
          </li>
        ))}
        {!tasks.isLoading && !(tasks.data?.items ?? []).length && <p className="text-sm text-muted-foreground">Aucune tâche.</p>}
      </ul>
    </div>
  );
}
