import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestHost } from "@tanstack/react-start/server";
import { z } from "zod";

export const getGoogleAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ origin: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const { buildGoogleAuthUrl } = await import("@/lib/google-mm.server");
    const redirectUri = `${data.origin}/api/google/callback`;
    // state = userId so callback can attach tokens to the right user
    const state = context.userId;
    return { url: buildGoogleAuthUrl(redirectUri, state) };
  });

export const getGoogleConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("google_connections")
      .select("google_email, scope, expires_at, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data;
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("google_connections").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// helper to derive a default origin server-side if client doesn't pass one
export const getServerOrigin = createServerFn({ method: "GET" }).handler(async () => {
  const host = getRequestHost();
  const proto = host.includes("localhost") ? "http" : "https";
  return { origin: `${proto}://${host}` };
});
