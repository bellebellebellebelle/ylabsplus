import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PrefsInput = z.object({
  timezone: z.string().optional(),
  background_url: z.string().nullable().optional(),
  background_opacity: z.number().min(0).max(1).optional(),
  sidebar_collapsed: z.boolean().optional(),
});

export const getPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("ui_preferences").select("*").eq("user_id", userId).maybeSingle();
    return data ?? { user_id: userId, timezone: "Indian/Reunion", background_url: null, background_opacity: 0.35, sidebar_collapsed: false };
  });

export const savePrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PrefsInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("ui_preferences").upsert({ user_id: userId, ...data, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
