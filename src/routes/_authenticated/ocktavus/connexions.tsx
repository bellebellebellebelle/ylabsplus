import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { generateChatLinkCode, unlinkChatSpace } from "@/lib/oauth.functions";
import { Mail, MessageSquare, Check, X, Copy, Loader2, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/ocktavus/connexions")({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const qc = useQueryClient();
  const genCode = useServerFn(generateChatLinkCode);
  const unlink = useServerFn(unlinkChatSpace);

  const { data: gmail, isLoading: gmailLoading } = useQuery({
    queryKey: ["gmail-status"],
    queryFn: async () => {
      const { data } = await supabase.from("gmail_connection_status").select("*").maybeSingle();
      return data;
    },
  });

  const { data: links = [] } = useQuery({
    queryKey: ["chat-links"],
    queryFn: async () => {
      const { data } = await supabase.from("google_chat_links").select("*");
      return data ?? [];
    },
  });

  const [code, setCode] = useState<{ code: string; endpoint: string } | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => genCode({}),
    onSuccess: (res) => { setCode(res); toast.success("Code généré, valable 15 minutes"); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  function copy(s: string) { navigator.clipboard.writeText(s); toast.success("Copié !"); }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-5">
        <h1 className="font-display text-2xl font-semibold">Connexions</h1>
        <p className="text-sm text-muted-foreground">Lie Google Chat à ton agent IA.</p>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Google account: managed once in Paramètres → Connexion Google */}
          <section className="ock-glass rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold">Compte Google</h2>
                  {gmailLoading ? (
                    <p className="text-sm text-muted-foreground">Chargement…</p>
                  ) : gmail ? (
                    <p className="mt-1 flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-primary" />Connecté : <span className="font-medium">{gmail.google_email}</span></p>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Aucun compte connecté.</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">La connexion Google est partagée par toutes vos apps et se gère dans Paramètres → Connexion Google.</p>
                </div>
              </div>
              <Button asChild className="neon-glow"><Link to="/settings" search={{ tab: "google" }}>{gmail ? "Gérer" : "Connecter"}</Link></Button>
            </div>
          </section>

          {/* Google Chat */}
          <section className="ock-glass rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-violet/10 ring-1 ring-violet/30">
                <MessageSquare className="h-6 w-6 text-violet" />
              </div>
              <div className="flex-1">
                <h2 className="font-display text-lg font-semibold">Google Chat</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Discute avec ton agent depuis Google Chat. Configure une fois, utilise partout.
                </p>

                <ol className="mt-4 space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">1</span>
                    <div>
                      <p className="font-medium">Ajoute l'endpoint dans Google Cloud Console</p>
                      <p className="text-muted-foreground">APIs &amp; Services → Google Chat API → Configuration → URL HTTP endpoint :</p>
                      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs">
                        <code className="flex-1 break-all">{typeof window !== "undefined" ? `${window.location.origin}/api/public/google-chat` : "/api/public/google-chat"}</code>
                        <button onClick={() => copy(`${window.location.origin}/api/public/google-chat`)} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">2</span>
                    <div>
                      <p className="font-medium">Génère un code de liaison</p>
                      <Button size="sm" className="mt-2" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                        {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                        Générer un code
                      </Button>
                      {code && (
                        <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                          <p className="text-xs text-muted-foreground">Code valable 15 minutes :</p>
                          <div className="mt-1 flex items-center gap-2">
                            <code className="font-display text-3xl font-bold tracking-widest neon-text">{code.code}</code>
                            <button onClick={() => copy(code.code)} className="text-muted-foreground hover:text-foreground">
                              <Copy className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">3</span>
                    <div>
                      <p className="font-medium">Dans Google Chat, ajoute le bot et tape :</p>
                      <code className="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono text-sm">/link {code?.code ?? "123456"}</code>
                    </div>
                  </li>
                </ol>

                {links.length > 0 && (
                  <div className="mt-6">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Espaces liés</p>
                    <ul className="mt-2 space-y-2">
                      {links.map((l) => (
                        <li key={l.space_id} className="flex items-center justify-between rounded-md border border-border bg-card/50 px-3 py-2 text-sm">
                          <span className="truncate"><MessageSquare className="mr-2 inline h-3.5 w-3.5" />{l.display_name ?? l.space_id}</span>
                          <button
                            onClick={async () => { await unlink({ data: { spaceId: l.space_id } }); qc.invalidateQueries({ queryKey: ["chat-links"] }); toast.success("Espace délié"); }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
