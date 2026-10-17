import { createFileRoute } from "@tanstack/react-router";

// Google OAuth callback for the shared "Connexion Google". The signed state carries the user id.
function finish(origin: string, ret: string, status: "ok" | "error" | "no_refresh", msg = "") {
  const sep = ret.includes("?") ? "&" : "?";
  const target = `${origin}${ret}${sep}google=${status}${msg ? `&msg=${encodeURIComponent(msg.slice(0, 200))}` : ""}`;
  const payload = JSON.stringify({ type: "google-connection", status, msg: msg.slice(0, 200) }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connexion Google</title></head><body style="font-family:system-ui;background:#1a1016;color:#fff;display:grid;place-items:center;height:100vh"><p>${status === "ok" ? "Connexion Google réussie, fermeture…" : "Connexion Google échouée."}</p><script>
var p=${payload};if(window.opener&&window.opener!==window){try{window.opener.postMessage(p,${JSON.stringify(origin)});}catch(e){}window.close();}else{location.replace(${JSON.stringify(target)});}
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const Route = createFileRoute("/api/public/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const fwd = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
        const origin = fwd ? `https://${fwd}` : url.origin;
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        let ret = "/settings?tab=google";
        try {
          if (!state) throw new Error("state manquant");
          const { verifyOAuthState, exchangeGoogleCode, fetchGoogleUserInfo } = await import("@/lib/google.server");
          const st = await verifyOAuthState(state);
          ret = st.ret;
          const error = url.searchParams.get("error");
          if (error || !code) return finish(origin, ret, "error", error ?? "code manquant");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const tokens = await exchangeGoogleCode(origin, code);
          const info = await fetchGoogleUserInfo(tokens.access_token);
          const { data: existing } = await supabaseAdmin.from("gmail_credentials").select("refresh_token").eq("user_id", st.uid).maybeSingle();
          const refreshToken = tokens.refresh_token ?? existing?.refresh_token;
          if (!refreshToken) return finish(origin, ret, "no_refresh");
          const { error: upErr } = await supabaseAdmin.from("gmail_credentials").upsert({
            user_id: st.uid,
            google_email: info?.email ?? null,
            access_token: tokens.access_token,
            refresh_token: refreshToken,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            scopes: tokens.scope,
            updated_at: new Date().toISOString(),
          });
          if (upErr) throw upErr;
          return finish(origin, ret, "ok");
        } catch (e) {
          console.error("google oauth callback error", e);
          return finish(origin, ret, "error", e instanceof Error ? e.message : "");
        }
      },
    },
  },
});
