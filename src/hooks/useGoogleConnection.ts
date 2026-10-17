import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { startGmailOAuth, disconnectGmail } from "@/lib/oauth.functions";

export const googleStatusKey = ["google-connection-status"] as const;

/**
 * Shared Google connection for every app (one account, all Workspace scopes).
 * Apps only read the status; connecting happens in Paramètres → Connexion Google.
 */
export function useGoogleConnection() {
  const qc = useQueryClient();
  const start = useServerFn(startGmailOAuth);
  const disconnectFn = useServerFn(disconnectGmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const status = useQuery({
    queryKey: googleStatusKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("gmail_connection_status").select("google_email,expires_at,updated_at,scopes").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: googleStatusKey });
    void qc.invalidateQueries({ queryKey: ["gmail-status"] });
  }, [qc]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.data?.type !== "google-connection") return;
      setBusy(false);
      if (e.data.status === "ok") { setError(""); refresh(); }
      else if (e.data.status === "no_refresh") setError("Google n'a pas accordé l'accès permanent. Réessayez en acceptant toutes les autorisations.");
      else setError(e.data.msg ? `Connexion échouée : ${e.data.msg}` : "Connexion échouée.");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  const connect = useCallback(async () => {
    setError("");
    setBusy(true);
    const popup = window.open("", "google-connection", "width=520,height=720");
    try {
      const { url } = await start({ data: { returnTo: "/settings?tab=google" } });
      if (popup) {
        popup.location.href = url;
        const timer = window.setInterval(() => { if (popup.closed) { window.clearInterval(timer); setBusy(false); refresh(); } }, 600);
      } else {
        window.top!.location.href = url;
      }
    } catch (e) {
      popup?.close();
      setBusy(false);
      setError(e instanceof Error ? e.message : "Impossible de démarrer la connexion Google.");
    }
  }, [start, refresh]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try { await disconnectFn(); refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Échec"); } finally { setBusy(false); }
  }, [disconnectFn, refresh]);

  return { connection: status.data ?? null, loading: status.isLoading, busy, error, connect, disconnect };
}
