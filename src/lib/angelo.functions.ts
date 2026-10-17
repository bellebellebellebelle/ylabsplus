import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ConnectionInput = {
  url: string;
  db_name: string;
  username: string;
  api_key: string;
};

export const testAndSaveOdooConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ConnectionInput) => {
    if (!input?.url || !input.db_name || !input.username || !input.api_key) {
      throw new Error("Tous les champs de connexion Odoo sont requis.");
    }
    if (!/^https?:\/\//i.test(input.url)) {
      throw new Error("L'URL Odoo doit commencer par https:// ou http://");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { odooAuthenticate, odooCheckModules } = await import("./odoo.server");
    const { supabase, userId } = context;

    const creds = {
      url: data.url.trim(),
      db_name: data.db_name.trim(),
      username: data.username.trim(),
      api_key: data.api_key.trim(),
    };

    let uid: number;
    let modules: Record<string, boolean>;
    try {
      uid = await odooAuthenticate(creds);
      modules = await odooCheckModules(creds, uid);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Connexion impossible";
      await supabase
        .from("odoo_connections")
        .upsert(
          { user_id: userId, url: creds.url, db: creds.db_name, username: creds.username, api_key: creds.api_key, status: "error", status_message: message, last_tested_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      return { ok: false as const, message, modules: null };
    }

    const { error } = await supabase.from("odoo_connections").upsert(
      {
        user_id: userId,
        url: creds.url, db: creds.db_name, username: creds.username, api_key: creds.api_key,
        uid,
        status: "connected",
        status_message: null,
        modules,
        last_tested_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    return { ok: true as const, message: "Connexion Odoo établie.", modules };
  });

export const syncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncInvoices } = await import("./angelo-engine.server");
    const result = await syncInvoices(context.supabase, context.userId);
    return { total: result.total, overdue: result.overdue };
  });

export const runAnalysisNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runAnalysis } = await import("./angelo-engine.server");
    return await runAnalysis(context.supabase, context.userId, "manual");
  });

export const previewReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { odooId?: number }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { composeReminder, daysOverdue, pickRule } = await import("./angelo-engine.server");
    const { supabase, userId } = context;

    const [{ data: settings }, { data: rules }] = await Promise.all([
      supabase.from("angelo_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("reminder_rules").select("*").eq("user_id", userId).order("days_overdue"),
    ]);
    if (!settings) throw new Error("Paramètres introuvables.");

    let invoice: Record<string, unknown> | null = null;
    if (data.odooId) {
      const { data: row } = await supabase
        .from("invoices_cache")
        .select("*")
        .eq("user_id", userId)
        .eq("odoo_id", data.odooId)
        .maybeSingle();
      invoice = row;
    }

    if (!invoice) {
      invoice = {
        name: "FACT/2026/0042",
        partner_name: "Client Exemple SARL",
        amount_total: 2400,
        amount_residual: 2400,
        currency: "EUR",
        invoice_date: "2026-01-10",
        due_date: "2026-02-09",
        sale_orders: "S00123",
        reminder_count: 0,
      };
    }

    const overdue = Math.max(1, daysOverdue(invoice['due_date'] as string));
    const rule = pickRule(rules ?? [], overdue) ?? {
      level: 1,
      firmness: "courtois",
      instructions: "",
    };

    return await composeReminder(settings, rule, invoice, overdue);
  });

export const sendReminderNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { odooId: number }) => {
    if (!input?.odooId) throw new Error("Facture manquante.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const engine = await import("./angelo-engine.server");
    const { odooAuthenticate } = await import("./odoo.server");
    const { supabase, userId } = context;

    const creds = await engine.loadConnection(supabase, userId);
    const uid = await odooAuthenticate(creds);

    const [{ data: settings }, { data: rules }, { data: invoice }] = await Promise.all([
      supabase.from("angelo_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("reminder_rules").select("*").eq("user_id", userId).order("days_overdue"),
      supabase
        .from("invoices_cache")
        .select("*")
        .eq("user_id", userId)
        .eq("odoo_id", data.odooId)
        .maybeSingle(),
    ]);

    if (!settings) throw new Error("Paramètres introuvables.");
    if (!invoice) throw new Error("Facture introuvable dans le cache. Lancez une synchronisation.");
    if (!invoice.partner_email) throw new Error("Ce client n'a pas d'adresse email dans Odoo.");

    const overdue = Math.max(1, engine.daysOverdue(invoice.due_date));
    const rule = engine.pickRule(rules ?? [], overdue) ??
      (rules ?? [])[0] ?? { level: 1, firmness: "courtois", instructions: "" };

    await engine.sendReminderForInvoice(
      supabase,
      userId,
      creds,
      uid,
      settings,
      rule,
      invoice,
      overdue,
    );

    return { ok: true as const };
  });
