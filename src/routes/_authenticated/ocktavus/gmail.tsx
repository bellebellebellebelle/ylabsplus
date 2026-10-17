import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsGmailList, wsGmailRead } from "@/lib/workspace.functions";
import { useState } from "react";
import { Mail, Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/gmail")({ component: GmailPage });

function GmailPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useServerFn(wsGmailList);
  const read = useServerFn(wsGmailRead);

  const emails = useQuery({
    queryKey: ["gmail-list", q],
    queryFn: () => list({ data: { query: q || undefined, max: 50 } }),
  });
  const detail = useQuery({
    queryKey: ["gmail-read", selected],
    enabled: !!selected,
    queryFn: () => read({ data: { id: selected! } }),
  });

  return (
    <div className="flex h-full">
      <div className="flex w-[420px] flex-col border-r border-border/60">
        <div className="flex items-center gap-2 border-b border-border/60 p-4">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg">Gmail</h2>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (ex: is:unread)" className="w-full bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {emails.isLoading && <div className="grid h-32 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {(emails.data?.emails ?? []).map((m: any) => (
            <button key={m.id} onClick={() => setSelected(m.id)}
              className={`block w-full border-b border-border/40 px-4 py-3 text-left transition hover:bg-white/5 ${selected === m.id ? "bg-white/10" : ""}`}>
              <p className="truncate text-xs text-muted-foreground">{m.from}</p>
              <p className="truncate text-sm font-medium">{m.subject || "(sans objet)"}</p>
              <p className="truncate text-xs text-muted-foreground/80">{m.snippet}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {!selected && <div className="grid h-full place-items-center text-sm text-muted-foreground">Sélectionne un email.</div>}
        {selected && detail.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {detail.data && (
          <article className="bento mx-auto max-w-3xl p-6">
            <h1 className="font-display text-xl">{(detail.data as any).subject}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{(detail.data as any).from} → {(detail.data as any).to}</p>
            <div className="prose prose-invert mt-4 max-w-none whitespace-pre-wrap text-sm">
              {(detail.data as any).body || (detail.data as any).snippet}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
