import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsDriveList } from "@/lib/workspace.functions";
import { useState } from "react";
import { HardDrive, Search, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/drive")({ component: DrivePage });

function DrivePage() {
  const [q, setQ] = useState("");
  const list = useServerFn(wsDriveList);
  const files = useQuery({ queryKey: ["drive", q], queryFn: () => list({ data: { ...(q ? { query: q } : {}), max: 50 } }) });

  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><HardDrive className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Drive</h1></header>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un fichier…" className="w-full bg-transparent text-sm outline-none" />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {(files.data?.files ?? []).map((f: any) => (
          <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer" className="bento group flex items-start gap-3 p-4">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-xs">{(f.mimeType ?? "").split(".").pop()?.slice(0, 4) || "file"}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">{new Date(f.modifiedTime).toLocaleString("fr-FR")}</p>
            </div>
            <ExternalLink className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60" />
          </a>
        ))}
      </div>
    </div>
  );
}
