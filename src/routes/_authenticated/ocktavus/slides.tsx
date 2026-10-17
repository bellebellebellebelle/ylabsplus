import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsSlidesList } from "@/lib/workspace.functions";
import { Presentation, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/slides")({ component: SlidesPage });

function SlidesPage() {
  const fn = useServerFn(wsSlidesList);
  const { data, isLoading } = useQuery({ queryKey: ["slides"], queryFn: () => fn() });
  const files: any[] = (data as any)?.files ?? [];
  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><Presentation className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Slides</h1></header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune présentation. Demande à l'agent : « crée une présentation … ».</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => (
            <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer" className="bento group overflow-hidden p-0">
              {f.thumbnailLink ? (
                <img src={f.thumbnailLink} alt="" className="h-32 w-full object-cover" />
              ) : (
                <div className="grid h-32 w-full place-items-center bg-white/5"><Presentation className="h-8 w-8 text-muted-foreground" /></div>
              )}
              <div className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{new Date(f.modifiedTime).toLocaleDateString("fr-FR")}</p>
                </div>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
