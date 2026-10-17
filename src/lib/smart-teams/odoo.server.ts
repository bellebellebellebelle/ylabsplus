/** Client Odoo léger via JSON-RPC (aucune dépendance externe). */

export type OdooCreds = {
  url: string;
  database: string;
  username: string;
  apiKey: string;
};

type JsonRpcResult<T> = { result?: T; error?: { message?: string; data?: { message?: string } } };

async function rpc<T>(creds: OdooCreds, service: string, method: string, args: unknown[]): Promise<T> {
  const base = creds.url.replace(/\/+$/, "");
  const res = await fetch(`${base}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Date.now(),
    }),
  });
  if (!res.ok) throw new Error(`Odoo injoignable (${res.status}). Vérifiez l'URL.`);
  const json = (await res.json()) as JsonRpcResult<T>;
  if (json.error) {
    throw new Error(json.error.data?.message || json.error.message || "Odoo a refusé la requête.");
  }
  return json.result as T;
}

/** Authentifie et retourne l'uid Odoo. */
export async function odooAuthenticate(creds: OdooCreds): Promise<number> {
  const uid = await rpc<number | false>(creds, "common", "authenticate", [
    creds.database,
    creds.username,
    creds.apiKey,
    {},
  ]);
  if (!uid) throw new Error("Identifiants Odoo refusés (utilisateur ou clé API).");
  return uid;
}

type OdooRow = Record<string, unknown>;

async function searchRead(
  creds: OdooCreds,
  uid: number,
  model: string,
  fields: string[],
  limit: number,
): Promise<OdooRow[]> {
  try {
    return await rpc<OdooRow[]>(creds, "object", "execute_kw", [
      creds.database,
      uid,
      creds.apiKey,
      model,
      "search_read",
      [[]],
      { fields, limit, order: "write_date desc" },
    ]);
  } catch {
    // Module non installé sur cet Odoo : on ignore silencieusement.
    return [];
  }
}

/** Modules Odoo natifs exposés aux agents, avec les modèles lus pour le contexte. */
export const ODOO_MODULE_READS: Record<
  string,
  { label: string; reads: { model: string; fields: string[]; limit: number; title: string }[] }
> = {
  ventes: {
    label: "Ventes",
    reads: [
      { model: "sale.order", fields: ["name", "partner_id", "amount_total", "state", "date_order"], limit: 10, title: "Commandes récentes" },
    ],
  },
  achats: {
    label: "Achats",
    reads: [
      { model: "purchase.order", fields: ["name", "partner_id", "amount_total", "state", "date_order"], limit: 10, title: "Commandes fournisseurs" },
    ],
  },
  crm: {
    label: "CRM",
    reads: [
      { model: "crm.lead", fields: ["name", "partner_id", "expected_revenue", "stage_id", "probability"], limit: 12, title: "Opportunités en cours" },
    ],
  },
  facturation: {
    label: "Facturation",
    reads: [
      { model: "account.move", fields: ["name", "partner_id", "amount_total", "state", "invoice_date"], limit: 10, title: "Factures récentes" },
    ],
  },
  marketing: {
    label: "Marketing",
    reads: [
      { model: "mailing.mailing", fields: ["name", "subject", "state", "sent_date"], limit: 8, title: "Campagnes e-mail" },
    ],
  },
  agenda: {
    label: "Agenda",
    reads: [
      { model: "calendar.event", fields: ["name", "start", "stop", "location"], limit: 10, title: "Événements à venir" },
    ],
  },
  connaissance: {
    label: "Connaissance",
    reads: [
      { model: "knowledge.article", fields: ["name", "write_date"], limit: 10, title: "Articles de connaissance" },
    ],
  },
  employes: {
    label: "Employés",
    reads: [
      { model: "hr.employee", fields: ["name", "job_title", "department_id"], limit: 15, title: "Effectifs" },
    ],
  },
  projets: {
    label: "Projets",
    reads: [
      { model: "project.task", fields: ["name", "stage_id", "user_ids", "date_deadline"], limit: 12, title: "Tâches projet" },
    ],
  },
  stock: {
    label: "Stock",
    reads: [
      { model: "stock.quant", fields: ["product_id", "location_id", "quantity"], limit: 12, title: "Niveaux de stock" },
    ],
  },
};

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return String(v[1] ?? "");
  if (v === false || v === null || v === undefined) return "";
  return String(v);
}

/** Lit les données réelles des modules autorisés et les formate en contexte markdown. */
export async function buildOdooContext(creds: OdooCreds, uid: number, modules: string[]): Promise<string> {
  const sections: string[] = [];
  for (const key of modules) {
    const mod = ODOO_MODULE_READS[key];
    if (!mod) continue;
    for (const read of mod.reads) {
      const rows = await searchRead(creds, uid, read.model, read.fields, read.limit);
      if (rows.length === 0) continue;
      const lines = rows.map((r) =>
        "- " + read.fields.map((f) => `${f}: ${formatValue(r[f])}`).filter((s) => !s.endsWith(": ")).join(" | "),
      );
      sections.push(`### ${mod.label} — ${read.title}\n${lines.join("\n")}`);
    }
  }
  return sections.join("\n\n");
}

// ================== BOÎTE À OUTILS D'ÉCRITURE (actions natives Odoo) ==================

type WriteModel = {
  model: string;
  label: string;
  /** Champs exposés à la création / modification (nom Odoo -> description). */
  fields: Record<string, string>;
  /** Actions natives supplémentaires (méthodes du modèle, ex. action_confirm). */
  actions?: Record<string, string>;
};

/** Modèles Odoo modifiables par module, avec leurs champs et actions natives. */
export const ODOO_MODULE_WRITES: Record<string, WriteModel[]> = {
  ventes: [
    {
      model: "sale.order",
      label: "commande client / devis",
      fields: {
        partner_id: "id numérique du client (res.partner)",
        date_order: "date (YYYY-MM-DD)",
        validity_date: "date de validité du devis",
        note: "note / conditions",
        order_line: "lignes: [[0,0,{product_id,product_uom_qty,price_unit}]]",
      },
      actions: {
        action_confirm: "Confirmer le devis (le transforme en bon de commande)",
        action_cancel: "Annuler la commande",
        action_quotation_send: "Envoyer le devis par e-mail au client",
      },
    },
  ],
  achats: [
    {
      model: "purchase.order",
      label: "commande fournisseur",
      fields: {
        partner_id: "id numérique du fournisseur",
        date_order: "date (YYYY-MM-DD)",
        notes: "notes",
        order_line: "lignes: [[0,0,{product_id,product_qty,price_unit}]]",
      },
      actions: {
        button_confirm: "Confirmer la commande fournisseur",
        button_cancel: "Annuler la commande fournisseur",
      },
    },
  ],
  crm: [
    {
      model: "crm.lead",
      label: "opportunité / prospect",
      fields: {
        name: "titre de l'opportunité",
        partner_id: "id numérique du client",
        expected_revenue: "revenu attendu (nombre)",
        probability: "probabilité % (0-100)",
        description: "description / notes",
        email_from: "e-mail du contact",
        phone: "téléphone",
      },
      actions: {
        action_set_won: "Marquer comme gagnée",
        action_set_lost: "Marquer comme perdue",
      },
    },
  ],
  facturation: [
    {
      model: "account.move",
      label: "facture",
      fields: {
        move_type: "'out_invoice' (client) ou 'in_invoice' (fournisseur)",
        partner_id: "id numérique du client/fournisseur",
        invoice_date: "date de facture (YYYY-MM-DD)",
        invoice_date_due: "date d'échéance (YYYY-MM-DD)",
        invoice_line_ids: "lignes: [[0,0,{name,quantity,price_unit}]]",
      },
      actions: {
        action_post: "Valider la facture (comptabilisation)",
        button_cancel: "Annuler la facture",
        action_invoice_sent: "Envoyer la facture par e-mail au client",
      },
    },
  ],
  marketing: [
    {
      model: "mailing.mailing",
      label: "campagne e-mail",
      fields: {
        subject: "objet de l'e-mail",
        body_html: "contenu HTML de l'e-mail",
        mailing_model_id: "id du modèle cible (ex. contacts)",
      },
      actions: {
        action_launch: "Envoyer la campagne maintenant",
        action_schedule: "Planifier l'envoi",
      },
    },
  ],
  agenda: [
    {
      model: "calendar.event",
      label: "événement agenda",
      fields: {
        name: "titre",
        start: "début (YYYY-MM-DD HH:MM:SS)",
        stop: "fin (YYYY-MM-DD HH:MM:SS)",
        location: "lieu",
        description: "description",
        partner_ids: "participants: [[6,0,[ids]]]",
      },
    },
  ],
  connaissance: [
    {
      model: "knowledge.article",
      label: "article de connaissance",
      fields: {
        name: "titre de l'article",
        body: "contenu HTML de l'article",
        parent_id: "id de l'article parent (optionnel)",
      },
    },
  ],
  employes: [
    {
      model: "hr.employee",
      label: "employé",
      fields: {
        name: "nom complet",
        job_title: "intitulé de poste",
        work_email: "e-mail professionnel",
        work_phone: "téléphone professionnel",
        department_id: "id du département",
      },
    },
  ],
  projets: [
    {
      model: "project.task",
      label: "tâche projet",
      fields: {
        name: "titre de la tâche",
        project_id: "id numérique du projet",
        description: "description",
        date_deadline: "date limite (YYYY-MM-DD)",
        user_ids: "assignés: [[6,0,[ids]]]",
      },
    },
  ],
  stock: [
    {
      model: "product.product",
      label: "produit",
      fields: {
        name: "nom du produit",
        list_price: "prix de vente (nombre)",
        standard_price: "coût (nombre)",
        default_code: "référence interne",
        description_sale: "description commerciale",
      },
    },
  ],
};

export type OdooTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  module: string;
  model: string;
  kind: "create" | "write" | "unlink" | "action";
  action?: string;
};

/** Construit la liste des outils d'écriture disponibles pour les modules autorisés. */
export function buildOdooTools(modules: string[]): OdooTool[] {
  const tools: OdooTool[] = [];
  for (const key of modules) {
    const writes = ODOO_MODULE_WRITES[key];
    if (!writes) continue;
    for (const wm of writes) {
      const fieldProps: Record<string, unknown> = {};
      for (const [f, desc] of Object.entries(wm.fields)) {
        fieldProps[f] = { description: desc };
      }
      tools.push({
        name: `odoo_create_${wm.model.replace(/\./g, "_")}`,
        description: `Créer un(e) ${wm.label} dans Odoo (module ${key}).`,
        parameters: { type: "object", properties: fieldProps },
        module: key, model: wm.model, kind: "create",
      });
      tools.push({
        name: `odoo_update_${wm.model.replace(/\./g, "_")}`,
        description: `Modifier un(e) ${wm.label} existant(e) dans Odoo.`,
        parameters: {
          type: "object",
          properties: { id: { type: "number", description: "id numérique de l'enregistrement" }, ...fieldProps },
          required: ["id"],
        },
        module: key, model: wm.model, kind: "write",
      });
      tools.push({
        name: `odoo_delete_${wm.model.replace(/\./g, "_")}`,
        description: `Supprimer un(e) ${wm.label} dans Odoo.`,
        parameters: {
          type: "object",
          properties: { id: { type: "number", description: "id numérique de l'enregistrement" } },
          required: ["id"],
        },
        module: key, model: wm.model, kind: "unlink",
      });
      for (const [method, desc] of Object.entries(wm.actions ?? {})) {
        tools.push({
          name: `odoo_${method}_${wm.model.replace(/\./g, "_")}`,
          description: `${desc} (${wm.label}, Odoo).`,
          parameters: {
            type: "object",
            properties: { id: { type: "number", description: "id numérique de l'enregistrement" } },
            required: ["id"],
          },
          module: key, model: wm.model, kind: "action", action: method,
        });
      }
    }
  }
  return tools;
}

async function executeKw(
  creds: OdooCreds,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  return rpc<unknown>(creds, "object", "execute_kw", [
    creds.database, uid, creds.apiKey, model, method, args, kwargs,
  ]);
}

/** Recherche des enregistrements (outil de lecture générique pour retrouver des ids). */
export async function odooSearch(
  creds: OdooCreds, uid: number, model: string, query: string, limit = 10,
): Promise<OdooRow[]> {
  return (await executeKw(creds, uid, model, "name_search", [query], { limit })) as OdooRow[];
}

/** Exécute un outil Odoo et retourne un résumé textuel pour l'agent. */
export async function runOdooTool(
  creds: OdooCreds, uid: number, tool: OdooTool, args: Record<string, unknown>,
): Promise<string> {
  const { id, ...values } = args;
  if (tool.kind === "create") {
    const newId = await executeKw(creds, uid, tool.model, "create", [values]);
    return `Créé avec succès dans ${tool.model}, id=${newId}.`;
  }
  if (typeof id !== "number") throw new Error("Paramètre 'id' (numérique) requis.");
  if (tool.kind === "write") {
    await executeKw(creds, uid, tool.model, "write", [[id], values]);
    return `Enregistrement ${id} modifié dans ${tool.model}.`;
  }
  if (tool.kind === "unlink") {
    await executeKw(creds, uid, tool.model, "unlink", [[id]]);
    return `Enregistrement ${id} supprimé dans ${tool.model}.`;
  }
  const result = await executeKw(creds, uid, tool.model, tool.action ?? "", [[id]]);
  return `Action ${tool.action} exécutée sur ${tool.model} id=${id}. ${JSON.stringify(result ?? "").slice(0, 150)}`;
}
