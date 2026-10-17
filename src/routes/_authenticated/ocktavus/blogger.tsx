import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsBlogsList } from "@/lib/workspace.functions";
import { Rss, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/blogger")({ component: BloggerPage });

function BloggerPage() {
  const fn = useServerFn(wsBlogsList);
  const { data, isLoading } = useQuery({ queryKey: ["blogs"], queryFn: () => fn() });
  const items: any[] = (data as any)?.items ?? [];
  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><Rss className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Blogger</h1></header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun blog. L'API Blogger doit être activée dans Google Cloud, ou demande à l'agent de créer un post.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((b) => (
            <a key={b.id} href={b.url} target="_blank" rel="noreferrer" className="bento group flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{b.name}</p>
                <p className="truncate text-xs text-muted-foreground">{b.description || b.url}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{b.posts?.totalItems ?? 0} posts</p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
