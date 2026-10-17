import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ToolInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(60).regex(/^[a-zA-Z0-9_\- ]+$/, "Lettres/chiffres/_-espace uniquement"),
  description: z.string().min(3).max(500),
  http_method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  body_template: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});

export const listAgentTools = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("agent_tools")
      .select("id, name, description, http_method, url, headers, body_template, enabled, created_at, updated_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveAgentTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ToolInput.parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      name: data.name,
      description: data.description,
      http_method: data.http_method,
      url: data.url,
      headers: data.headers as never,
      body_template: data.body_template ?? null,
      enabled: data.enabled,
    };
    if (data.id) {
      const { error } = await context.supabase.from("agent_tools").update(payload).eq("id", data.id).eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase.from("agent_tools").insert(payload).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Création échouée");
    return { id: row.id };
  });

export const toggleAgentTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string(), enabled: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("agent_tools").update({ enabled: data.enabled }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAgentTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("agent_tools").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Journal des ticks cron ----------
export const getTickLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Récupère les ticks récents ; l'UI filtre par automation_id de l'utilisateur.
    const { data: ticks, error } = await context.supabase
      .from("tick_logs")
      .select("id, ran_at, duration_ms, launched_count, results, error")
      .order("ran_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const { data: autos } = await context.supabase
      .from("automations").select("id, name").eq("user_id", context.userId);
    return { ticks: ticks ?? [], autos: autos ?? [] };
  });

// ---------- Statut du fournisseur IA courant ----------
export const getAiProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const hasGeminiPersonal = !!process.env.GEMINI_API_KEY?.trim();
    return {
      current_provider: hasGeminiPersonal ? ("gemini_personal" as const) : ("lovable_ai" as const),
      gemini_personal_enabled: hasGeminiPersonal,
    };
  });
