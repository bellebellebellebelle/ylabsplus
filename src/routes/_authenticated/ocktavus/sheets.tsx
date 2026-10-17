import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsSheetsList } from "@/lib/workspace.functions";
import { Sheet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/sheets")({ component: SheetsPage });

function SheetsPage() {
  const list = useServerFn(wsSheetsList);
  const files = useQuery({ queryKey: ["sheets"], queryFn: () => list({ data: undefined as any }) });
  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><Sheet className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Sheets</h1></header>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {(files.data?.files ?? []).map((f: any) => (
          <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer" className="bento p-4">
            <p className="truncate text-sm font-medium">{f.name}</p>
            <p className="text-xs text-muted-foreground">{new Date(f.modifiedTime).toLocaleString("fr-FR")}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
