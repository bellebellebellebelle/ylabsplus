// Client JSON-RPC Odoo (aucune dépendance externe).

export type OdooCreds = {
  url: string;
  db_name: string;
  username: string;
  api_key: string;
};

function endpoint(url: string) {
  return url.replace(/\/+$/, "") + "/jsonrpc";
}

async function rpc(url: string, service: string, method: string, args: unknown[]) {
  const res = await fetch(endpoint(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Date.now(),
    }),
  });

  if (!res.ok) {
    throw new Error(`Odoo a répondu avec le statut ${res.status}`);
  }

  const json = (await res.json()) as {
    result?: unknown;
    error?: { message?: string; data?: { message?: string } };
  };

  if (json.error) {
    throw new Error(json.error.data?.message || json.error.message || "Erreur Odoo inconnue");
  }
  return json.result;
}

export async function odooAuthenticate(creds: OdooCreds): Promise<number> {
  const uid = (await rpc(creds.url, "common", "authenticate", [
    creds.db_name,
    creds.username,
    creds.api_key,
    {},
  ])) as number | false;

  if (!uid) {
    throw new Error("Identifiants Odoo refusés (base, utilisateur ou clé API incorrects).");
  }
  return uid;
}

export async function odooExecute<T = unknown>(
  creds: OdooCreds,
  uid: number,
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  return (await rpc(creds.url, "object", "execute_kw", [
    creds.db_name,
    uid,
    creds.api_key,
    model,
    method,
    args,
    kwargs,
  ])) as T;
}

export type OdooInvoice = {
  id: number;
  name: string;
  invoice_date: string | false;
  invoice_date_due: string | false;
  amount_total: number;
  amount_residual: number;
  payment_state: string;
  partner_id: [number, string] | false;
  currency_id: [number, string] | false;
  invoice_origin: string | false;
};

/** Factures clients comptabilisées et non soldées (modules Facturation / Comptabilité). */
export async function odooFetchOpenInvoices(creds: OdooCreds, uid: number) {
  return odooExecute<OdooInvoice[]>(creds, uid, "account.move", "search_read", [
    [
      ["move_type", "=", "out_invoice"],
      ["state", "=", "posted"],
      ["payment_state", "in", ["not_paid", "partial"]],
    ],
    [
      "name",
      "invoice_date",
      "invoice_date_due",
      "amount_total",
      "amount_residual",
      "payment_state",
      "partner_id",
      "currency_id",
      "invoice_origin",
    ],
  ], { limit: 500, order: "invoice_date_due asc" });
}

export async function odooPartnerEmails(creds: OdooCreds, uid: number, partnerIds: number[]) {
  if (partnerIds.length === 0) return new Map<number, string>();
  const partners = await odooExecute<{ id: number; email: string | false }[]>(
    creds,
    uid,
    "res.partner",
    "read",
    [partnerIds, ["email"]],
  );
  const map = new Map<number, string>();
  for (const p of partners) if (p.email) map.set(p.id, p.email);
  return map;
}

/** Vérifie l'accès aux modules Ventes / Facturation / Comptabilité / Emails. */
export async function odooCheckModules(creds: OdooCreds, uid: number) {
  const check = async (model: string) => {
    try {
      await odooExecute(creds, uid, model, "search_count", [[]], {});
      return true;
    } catch {
      return false;
    }
  };
  const [facturation, ventes, comptabilite, emails, partenaires] = await Promise.all([
    check("account.move"),
    check("sale.order"),
    check("account.move.line"),
    check("mail.message"),
    check("res.partner"),
  ]);
  return { facturation, ventes, comptabilite, emails, partenaires };
}

/**
 * Envoie la relance via la messagerie native d'Odoo : le message est posté sur la
 * facture et expédié par email au client, avec la facture PDF en pièce jointe.
 */
export async function odooSendReminder(
  creds: OdooCreds,
  uid: number,
  invoiceId: number,
  partnerId: number | null,
  subject: string,
  htmlBody: string,
  attachPdf: boolean,
) {
  let attachmentIds: number[] = [];

  if (attachPdf) {
    try {
      attachmentIds = await odooExecute<number[]>(creds, uid, "ir.attachment", "search", [
        [
          ["res_model", "=", "account.move"],
          ["res_id", "=", invoiceId],
          ["mimetype", "=", "application/pdf"],
        ],
      ], { limit: 1 });
    } catch {
      attachmentIds = [];
    }
  }

  const kwargs: Record<string, unknown> = {
    body: htmlBody,
    subject,
    message_type: "comment",
    subtype_xmlid: "mail.mt_comment",
    partner_ids: partnerId ? [partnerId] : [],
  };
  if (attachmentIds.length > 0) kwargs['attachment_ids'] = attachmentIds;

  return odooExecute(creds, uid, "account.move", "message_post", [[invoiceId]], kwargs);
}
