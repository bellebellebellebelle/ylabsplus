import type { SupabaseClient } from "@supabase/supabase-js";

import {
  odooAuthenticate,
  odooExecute,
  odooFetchOpenInvoices,
  odooPartnerEmails,
  odooSendReminder,
  type OdooCreds,
} from "./odoo.server";

type DB = SupabaseClient<any, "public", any>;

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Settings = any;
export type Rule = any;
export type InvoiceRow = any;

export function daysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.floor((now - due) / 86400000);
}

export async function loadConnection(db: DB, userId: string): Promise<OdooCreds> {
  const { data, error } = await db
    .from("odoo_connections")
    .select("url, db_name:db, username, api_key")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Aucune base Odoo connectée. Renseignez la connexion Odoo d'abord.");
  return data as unknown as OdooCreds;
}

/** Synchronise les factures ouvertes d'Odoo vers le cache local. */
export async function syncInvoices(db: DB, userId: string) {
  const creds = await loadConnection(db, userId);
  const uid = await odooAuthenticate(creds);
  const invoices = await odooFetchOpenInvoices(creds, uid);

  const partnerIds = Array.from(
    new Set(invoices.map((i) => (i.partner_id ? i.partner_id[0] : 0)).filter(Boolean)),
  );
  const emails = await odooPartnerEmails(creds, uid, partnerIds);

  const rows = invoices.map((i) => ({
    user_id: userId,
    odoo_id: i.id,
    name: i.name,
    partner_id: i.partner_id ? i.partner_id[0] : null,
    partner_name: i.partner_id ? i.partner_id[1] : null,
    partner_email: i.partner_id ? (emails.get(i.partner_id[0]) ?? null) : null,
    amount_total: i.amount_total,
    amount_residual: i.amount_residual,
    currency: i.currency_id ? i.currency_id[1] : null,
    invoice_date: i.invoice_date || null,
    due_date: i.invoice_date_due || null,
    payment_state: i.payment_state,
    sale_orders: i.invoice_origin || null,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await db
      .from("invoices_cache")
      .upsert(rows, { onConflict: "user_id,odoo_id" });
    if (error) throw new Error(error.message);
  }

  // Retire du cache les factures désormais soldées côté Odoo.
  const keptIds = rows.map((r) => r.odoo_id);
  if (keptIds.length > 0) {
    await db
      .from("invoices_cache")
      .delete()
      .eq("user_id", userId)
      .not("odoo_id", "in", `(${keptIds.join(",")})`);
  } else {
    await db.from("invoices_cache").delete().eq("user_id", userId);
  }

  const overdue = rows.filter((r) => daysOverdue(r.due_date) > 0).length;
  return { total: rows.length, overdue, creds, uid };
}

export function pickRule(rules: Rule[], overdue: number): Rule | null {
  const eligible = rules
    .filter((r) => r.active && overdue >= r.days_overdue)
    .sort((a, b) => b.days_overdue - a.days_overdue);
  return eligible[0] ?? null;
}

function stripHtml(text: string) {
  return text.replace(/<[^>]*>/g, "");
}

function toHtml(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** Rédaction du message par ANGELO (Lovable AI, GPT 5.6 Sol). */
export async function composeReminder(
  settings: Settings,
  rule: Rule,
  invoice: InvoiceRow,
  overdue: number,
): Promise<{ subject: string; body: string }> {
  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) throw new Error("LOVABLE_API_KEY manquante.");

  const system = [
    `Tu es ${settings.agent_name || "ANGELO"}, assistant expert en facturation, recouvrement amiable et relation client.`,
    `Tu rédiges des emails de relance de factures impayées, en ${settings.language === "en" ? "anglais" : "français"}.`,
    `Ton: ${settings.tone}. Niveau de fermeté demandé: ${rule.firmness}.`,
    `Société émettrice: ${settings.company_name || "la société"}. Signature: ${settings.signature}.`,
    `Tu rappelles systématiquement les conditions du contrat de vente et l'obligation de paiement conformément à la législation en vigueur, en reprenant ce texte de référence: ${settings.legal_text}`,
    settings.extra_instructions ? `Consignes supplémentaires: ${settings.extra_instructions}` : "",
    rule.instructions ? `Consignes du niveau de relance: ${rule.instructions}` : "",
    `Réponds UNIQUEMENT en JSON: {"subject": "...", "body": "..."} . Le body est du texte brut avec des sauts de ligne, sans balises HTML, 150 à 250 mots, professionnel, précis, sans promesse inventée.`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Facture: ${invoice.name}`,
    `Client: ${invoice.partner_name ?? "Client"}`,
    `Montant total: ${invoice.amount_total} ${invoice.currency ?? ""}`,
    `Solde restant dû: ${invoice.amount_residual} ${invoice.currency ?? ""}`,
    `Date de facture: ${invoice.invoice_date ?? "non précisée"}`,
    `Date d'échéance: ${invoice.due_date ?? "non précisée"}`,
    `Retard: ${overdue} jour(s)`,
    invoice.sale_orders ? `Commande de vente liée: ${invoice.sale_orders}` : "",
    `Numéro de relance: niveau ${rule.level} (relances déjà envoyées: ${invoice.reminder_count ?? 0})`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      reasoning_effort: "none",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Trop de requêtes IA, réessayez dans un instant.");
    if (res.status === 402) throw new Error("Crédits IA épuisés : ajoutez des crédits Lovable AI.");
    throw new Error(`Erreur IA [${res.status}]: ${text}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: { subject?: string; body?: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { subject: `Relance facture ${invoice.name}`, body: stripHtml(content) };
  }

  return {
    subject: parsed.subject?.trim() || `Relance — facture ${invoice.name}`,
    body: (parsed.body || "").trim(),
  };
}

export function buildHtmlBody(body: string, settings: Settings) {
  const cc = String(settings.cc_emails || "").trim();
  const ccNote = cc ? `<p style="color:#888;font-size:12px">Copie: ${cc}</p>` : "";
  return toHtml(body) + ccNote;
}

export function isExcluded(settings: Settings, invoice: InvoiceRow) {
  const raw = String(settings.excluded_partners || "").trim();
  if (!raw) return false;
  const list = raw
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const name = String(invoice.partner_name || "").toLowerCase();
  const email = String(invoice.partner_email || "").toLowerCase();
  return list.some((entry) => name.includes(entry) || email.includes(entry));
}

/** Envoie une relance pour une facture donnée et journalise le résultat. */
export async function sendReminderForInvoice(
  db: DB,
  userId: string,
  creds: OdooCreds,
  uid: number,
  settings: Settings,
  rule: Rule,
  invoice: InvoiceRow,
  overdue: number,
) {
  const { subject, body } = await composeReminder(settings, rule, invoice, overdue);
  const html = buildHtmlBody(body, settings);

  try {
    await odooSendReminder(
      creds,
      uid,
      invoice.odoo_id,
      invoice.partner_id ?? null,
      subject,
      html,
      Boolean(settings.attach_pdf),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de l'envoi";
    await db.from("reminder_logs").insert({
      user_id: userId,
      invoice_odoo_id: invoice.odoo_id,
      invoice_name: invoice.name,
      partner_name: invoice.partner_name,
      partner_email: invoice.partner_email,
      level: rule.level,
      subject,
      body,
      amount_residual: invoice.amount_residual,
      days_overdue: overdue,
      status: "error",
      error: message,
    });
    throw new Error(message);
  }

  await db.from("reminder_logs").insert({
    user_id: userId,
    invoice_odoo_id: invoice.odoo_id,
    invoice_name: invoice.name,
    partner_name: invoice.partner_name,
    partner_email: invoice.partner_email,
    level: rule.level,
    subject,
    body,
    amount_residual: invoice.amount_residual,
    days_overdue: overdue,
    status: "sent",
  });

  await db
    .from("invoices_cache")
    .update({
      reminder_count: (invoice.reminder_count ?? 0) + 1,
      last_reminder_at: new Date().toISOString(),
      last_reminder_level: rule.level,
    })
    .eq("user_id", userId)
    .eq("odoo_id", invoice.odoo_id);

  return { subject, body };
}

/** Analyse complète : synchronisation + relances automatiques. */
export async function runAnalysis(db: DB, userId: string, trigger: "manual" | "cron") {
  const { data: run } = await db
    .from("run_logs")
    .insert({ user_id: userId, trigger, status: "running" })
    .select("id")
    .single();

  const runId = run?.id as string | undefined;

  try {
    const sync = await syncInvoices(db, userId);

    const [{ data: settings }, { data: rules }, { data: invoices }] = await Promise.all([
      db.from("angelo_settings").select("*").eq("user_id", userId).maybeSingle(),
      db.from("reminder_rules").select("*").eq("user_id", userId).order("days_overdue"),
      db.from("invoices_cache").select("*").eq("user_id", userId),
    ]);

    if (!settings) throw new Error("Paramètres ANGELO introuvables.");

    let sent = 0;
    const errors: string[] = [];

    if (settings.auto_send) {
      for (const invoice of invoices ?? []) {
        const overdue = daysOverdue(invoice.due_date);
        if (overdue <= 0) continue;
        if (Number(invoice.amount_residual) < Number(settings.min_amount ?? 0)) continue;
        if (!invoice.partner_email) continue;
        if (isExcluded(settings, invoice)) continue;

        const rule = pickRule(rules ?? [], overdue);
        if (!rule) continue;
        if (invoice.last_reminder_level && invoice.last_reminder_level >= rule.level) {
          const cooldown = Number(settings.min_days_between_reminders ?? 7);
          const last = invoice.last_reminder_at ? new Date(invoice.last_reminder_at).getTime() : 0;
          if (Date.now() - last < cooldown * 86400000) continue;
        }

        try {
          await sendReminderForInvoice(
            db,
            userId,
            sync.creds,
            sync.uid,
            settings,
            rule,
            invoice,
            overdue,
          );
          sent += 1;
        } catch (e) {
          errors.push(`${invoice.name}: ${e instanceof Error ? e.message : "erreur"}`);
        }
      }
    }

    if (runId) {
      await db
        .from("run_logs")
        .update({
          status: errors.length > 0 ? "partial" : "success",
          invoices_found: sync.total,
          overdue_found: sync.overdue,
          reminders_sent: sent,
          message: errors.length > 0 ? errors.slice(0, 5).join(" | ") : null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    return { total: sync.total, overdue: sync.overdue, sent, errors };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    if (runId) {
      await db
        .from("run_logs")
        .update({ status: "error", message, finished_at: new Date().toISOString() })
        .eq("id", runId);
    }
    throw new Error(message);
  }
}

export { odooExecute };
