import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/glass-card";
import { GlowButton } from "@/components/glow-button";
import { Mail, Calendar, ListTodo, Link2, Unlink, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getGoogleAuthUrl, getGoogleConnection, disconnectGoogle } from "@/lib/google.functions";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/_mm/connections")({
  head: () => ({ meta: [{ title: "Connexions · Nexus" }] }),
  component: Connections,
});

type Conn = { google_email: string | null; scope: string | null; expires_at: string | null; created_at: string };

function Connections() {
  const [conn, setConn] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(true);
  const getUrl = useServerFn(getGoogleAuthUrl);
  const getConn = useServerFn(getGoogleConnection);
  const disconnect = useServerFn(disconnectGoogle);

  async function load() {
    setLoading(true);
    const c = await getConn({});
    setConn(c as Conn | null);
    setLoading(false);
  }
  useEffect(() => {
    load();
    const url = new URL(window.location.href);
    if (url.searchParams.get("ok") === "connected") {
      toast.success("Google connecté ✓");
      url.searchParams.delete("ok"); window.history.replaceState(null, "", url.toString());
    }
    if (url.searchParams.get("error")) {
      toast.error(url.searchParams.get("error")!);
      url.searchParams.delete("error"); window.history.replaceState(null, "", url.toString());
    }
  }, []);

  async function onConnect() {
    const { url } = await getUrl({ data: { origin: window.location.origin } });
    window.location.href = url;
  }
  async function onDisconnect() {
    if (!confirm("Déconnecter Google ?")) return;
    await disconnect({});
    toast.success("Déconnecté");
    load();
  }

  const scopes = conn?.scope?.split(/\s+/).filter(Boolean) ?? [];
  const services = [
    { id: "gmail", label: "Gmail", icon: Mail, color: "text-red-300", scope: "gmail" },
    { id: "calendar", label: "Google Agenda", icon: Calendar, color: "text-blue-300", scope: "calendar" },
    { id: "tasks", label: "Google Tasks", icon: ListTodo, color: "text-emerald-300", scope: "tasks" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Connexions</h1>
        <p className="text-sm text-muted-foreground mt-1">Reliez votre compte Google pour activer les agents.</p>
      </div>

      <GlassCard>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Link2 className="size-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Compte Google</h3>
              {loading ? <p className="text-sm text-muted-foreground mt-1">Chargement…</p>
                : conn ? (
                  <>
                    <p className="text-sm mt-1">{conn.google_email}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Connecté le {format(new Date(conn.created_at), "dd MMM yyyy", { locale: fr })}
                      {conn.expires_at && <> · Token expire {format(new Date(conn.expires_at), "dd/MM HH:mm")}</>}
                    </p>
                  </>
                ) : <p className="text-sm text-muted-foreground mt-1">Aucune connexion.</p>}
            </div>
          </div>
          <div className="flex gap-2">
            {conn ? (
              <>
                <GlowButton variant="ghost" onClick={onConnect}><RefreshCw className="size-4" /> Ré-authentifier</GlowButton>
                <GlowButton variant="danger" onClick={onDisconnect}><Unlink className="size-4" /> Déconnecter</GlowButton>
              </>
            ) : (
              <GlowButton onClick={onConnect}><Link2 className="size-4" /> Connecter Google</GlowButton>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="font-semibold">Services disponibles</h3>
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          {services.map((s) => {
            const granted = scopes.some((sc) => sc.includes(s.scope));
            return (
              <div key={s.id} className="rounded-xl border border-white/10 p-4">
                <div className="flex items-center justify-between">
                  <s.icon className={`size-5 ${s.color}`} />
                  {granted && <CheckCircle2 className="size-4 text-emerald-300" />}
                </div>
                <div className="mt-2 font-medium">{s.label}</div>
                <div className={`text-xs mt-1 ${granted ? "text-emerald-300" : "text-muted-foreground"}`}>
                  {granted ? "Scope accordé" : "Non accordé"}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
