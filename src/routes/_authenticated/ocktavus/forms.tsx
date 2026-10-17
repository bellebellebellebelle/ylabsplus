import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsFormsList } from "@/lib/workspace.functions";
import { ClipboardList, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/forms")({ component: FormsPage });

function FormsPage() {
  const fn = useServerFn(wsFormsList);
  const { data, isLoading } = useQuery({ queryKey: ["forms"], queryFn: () => fn() });
  const files: any[] = (data as any)?.files ?? [];
  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><ClipboardList className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Forms</h1></header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun formulaire. Demande à l'agent : « crée un Form … ».</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => (
            <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer" className="bento group flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="text-xs text-muted-foreground">{new Date(f.modifiedTime).toLocaleDateString("fr-FR")}</p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
