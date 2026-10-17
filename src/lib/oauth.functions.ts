import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestHeader } from "@tanstack/react-start/server";

function getOrigin() {
  const host = getRequestHeader("x-forwarded-host") ?? getRequestHeader("host");
  const proto = getRequestHeader("x-forwarded-proto") ?? "https";
  if (!host) throw new Error("no host header");
  return `${proto}://${host}`;
}

/** Starts the shared Google connection (all Workspace scopes). Used by every app. */
export const startGmailOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { returnTo?: string } | undefined) => ({ returnTo: d?.returnTo && d.returnTo.startsWith("/") && !d.returnTo.startsWith("//") ? d.returnTo : "/settings?tab=google" }))
  .handler(async ({ data, context }) => {
    const { buildGoogleAuthUrl, signOAuthState } = await import("./google.server");
    const origin = getOrigin();
    const state = await signOAuthState({ uid: context.userId, ret: data.returnTo });
    return { url: buildGoogleAuthUrl(origin, state), redirectUri: `${origin}/api/public/google/callback` };
  });

export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("gmail_credentials").select("access_token").eq("user_id", context.userId).maybeSingle();
    if (data?.access_token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.access_token)}`, { method: "POST" }).catch(() => null);
    }
    await supabaseAdmin.from("gmail_credentials").delete().eq("user_id", context.userId);
    return { ok: true };
  });

export const generateChatLinkCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const n = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 900000;
    const code = (100000 + n).toString();
    await supabaseAdmin.from("chat_link_codes").delete().eq("user_id", context.userId);
    const { error } = await supabaseAdmin.from("chat_link_codes").insert({ code, user_id: context.userId });
    if (error) throw new Error(error.message);
    return { code, endpoint: `${getOrigin()}/api/public/google-chat` };
  });

export const unlinkChatSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { spaceId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("google_chat_links").delete().eq("space_id", data.spaceId).eq("user_id", context.userId);
    return { ok: true };
  });
