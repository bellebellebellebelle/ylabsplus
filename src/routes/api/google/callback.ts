import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state"); // user_id
        const error = url.searchParams.get("error");
        const origin = `${url.protocol}//${url.host}`;
        const back = (msg: string, ok: boolean) =>
          new Response(null, { status: 302, headers: { Location: `${origin}/connections?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}` } });

        if (error) return back(error, false);
        if (!code || !state) return back("missing_params", false);

        try {
          const { exchangeCodeForTokens, fetchGoogleUserInfo } = await import("@/lib/google-mm.server");
          const tokens = await exchangeCodeForTokens(code, `${origin}/api/google/callback`);
          const info = await fetchGoogleUserInfo(tokens.access_token);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
          const { error: upErr } = await supabaseAdmin.from("google_connections").upsert({
            user_id: state,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? "",
            expires_at: expiresAt,
            scope: tokens.scope,
            google_email: info?.email ?? null,
          }, { onConflict: "user_id" });
          if (upErr) throw new Error(upErr.message);
          return back("connected", true);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return back(msg, false);
        }
      },
    },
  },
});
