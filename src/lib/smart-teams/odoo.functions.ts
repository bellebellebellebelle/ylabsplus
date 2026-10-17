import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ConnectInput = z.object({
  url: z.string().url("URL invalide (ex. https://mon-entreprise.odoo.com)"),
  database: z.string().min(1, "Nom de base requis"),
  username: z.string().min(1, "Identifiant requis"),
  apiKey: z.string().min(4, "Clé API requise"),
});

const ModulesInput = z.object({
  department: z.string().min(1),
  modules: z.array(z.string()).max(20),
});

/** Enregistre la connexion Odoo après vérification réelle des identifiants. */
export const connectOdoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { odooAuthenticate } = await import("./odoo.server");
    const { supabase, userId } = context;

    const uid = await odooAuthenticate({
      url: data.url,
      database: data.database,
      username: data.username,
      apiKey: data.apiKey,
    });

    const { error } = await supabase.from("odoo_connections").upsert(
      {
        user_id: userId,
        url: data.url.replace(/\/+$/, ""),
        db: data.database,
        username: data.username,
        api_key: data.apiKey,
        uid,
        status: "connected",
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, uid };
  });

/** Déconnecte Odoo (supprime les identifiants stockés). */
export const disconnectOdoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("odoo_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Définit les modules Odoo accessibles à un département. */
export const setDepartmentModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ModulesInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("st_department_modules").upsert(
      { user_id: userId, department: data.department, modules: data.modules },
      { onConflict: "user_id,department" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
