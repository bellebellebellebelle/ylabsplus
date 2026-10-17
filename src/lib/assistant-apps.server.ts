import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applications } from "./laboratory";
import { buildAllTools } from "./google-tools.server";
import type { AuraAttachment } from "./aura-attachments";

// Names + descriptions of every Google Workspace tool (Gmail, Agenda, Drive, Docs, Sheets, Slides, Forms, Tâches, Contacts, Blogger).
const googleToolCatalog = Object.entries(buildAllTools("00000000-0000-0000-0000-000000000000", "voice")).map(([name, t]) => ({ name, description: (t as { description?: string }).description ?? "" }));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctx = { db: SupabaseClient<any, "public", any>; userId: string; attachments?: AuraAttachment[] };
type Action = { description: string; input: z.ZodObject<any>; run: (ctx: Ctx, input: any) => Promise<unknown> };

/**
 * Actions the voice assistant can execute, per app key.
 * Every app in the lab catalog is automatically known to the assistant (name + description);
 * add an entry here with the app's key to let the assistant perform tasks in it.
 */
const appActions: Record<string, Record<string, Action>> = {
  smartteams: {
    ouvrir_tableau: {
      description: "Ouvrir le tableau Smart Teams des équipes d'agents IA.",
      input: z.object({}),
      run: async () => ({ open: "/board" }),
    },
    lire_equipes: {
      description: "Lire les équipes, agents, missions et livrables Smart Teams de l'utilisateur.",
      input: z.object({}),
      run: async ({ db, userId }) => {
        const [teams, agents, tasks] = await Promise.all([
          db.from("st_teams").select("id,name,department,mission").eq("user_id", userId),
          db.from("st_agents").select("id,name,role,team_id,status").eq("user_id", userId),
          db.from("st_tasks").select("id,title,status,result").eq("user_id", userId).limit(30),
        ]);
        if (teams.error || agents.error || tasks.error) throw new Error("Lecture des équipes impossible.");
        return { teams: teams.data, agents: agents.data, tasks: tasks.data, open: "/board" };
      },
    },
  },
  ocktavus: {
    joindre_fichier: {
      description: "Importer le fichier original joint à Aura dans Google Drive. attachment_index est l'index de la pièce jointe ; folder_id est le dossier cible facultatif.",
      input: z.object({ attachment_index: z.number().int().min(0), folder_id: z.string().optional() }),
      run: async ({ userId, attachments }, i) => {
        const file = attachments?.[i.attachment_index];
        if (!file) throw new Error("Pièce jointe introuvable.");
        const { googleFetch } = await import("./google.server");
        const metadata = { name: file.name, ...(i.folder_id ? { parents: [i.folder_id] } : {}) };
        const boundary = `aura_${crypto.randomUUID()}`;
        const binary = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
        const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.mime}\r\n\r\n`, binary, `\r\n--${boundary}--`]);
        return googleFetch(userId, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
      },
    },
    outils_google: {
      description: "Lister tous les outils Google Workspace disponibles (nom, description). À appeler avant executer_google si tu ne connais pas le nom exact ou les paramètres.",
      input: z.object({}),
      run: async () => googleToolCatalog,
    },
    executer_google: {
      description: `Exécuter réellement une tâche Google (Gmail, Agenda, Drive, Docs, Sheets, Slides, Forms, Tâches, Contacts, Blogger) avec la connexion Google partagée de l'utilisateur. input = { outil, parametres }. Outils : ${googleToolCatalog.map((t) => t.name).join(", ")}.`,
      input: z.object({ outil: z.string(), parametres: z.record(z.any()).optional() }),
      run: async ({ db, userId }, i) => {
        const { data: conn } = await db.from("gmail_connection_status").select("google_email").maybeSingle();
        if (!conn) return "Aucun compte Google connecté. Demande à l'utilisateur d'aller dans Paramètres → Connexion Google.";
        const { data: settings } = await db.from("user_settings").select("timezone,email_greeting,email_signature,email_tone").eq("user_id", userId).maybeSingle();
        const tools = buildAllTools(userId, "voice", {
          timezone: settings?.timezone ?? "Indian/Reunion",
          emailGreeting: settings?.email_greeting,
          emailSignature: settings?.email_signature,
          emailTone: settings?.email_tone,
          taskId: crypto.randomUUID(),
        }) as Record<string, { inputSchema?: z.ZodTypeAny; execute?: (args: unknown, opts: unknown) => Promise<unknown> }>;
        const t = tools[i.outil];
        if (!t?.execute) return { error: `Outil inconnu « ${i.outil} ». Outils : ${Object.keys(tools).join(", ")}` };
        const parsed = t.inputSchema && "safeParse" in t.inputSchema ? t.inputSchema.safeParse(i.parametres ?? {}) : { success: true as const, data: i.parametres ?? {} };
        if (!parsed.success) return { error: `Paramètres invalides : ${parsed.error.message}` };
        return t.execute(parsed.data, { toolCallId: crypto.randomUUID(), messages: [] });
      },
    },
  },
  lab: {
    lire_donnees: {
      description: "Lire les idées et l'activité récentes de l'utilisateur.",
      input: z.object({}),
      run: async ({ db }) => {
        const [ideas, activity] = await Promise.all([
          db.from("ideas").select("id,title,description,created_at").order("created_at", { ascending: false }).limit(50),
          db.from("lab_activity").select("kind,app_key,seconds_saved,created_at").order("created_at", { ascending: false }).limit(100),
        ]);
        if (ideas.error || activity.error) throw new Error("Lecture impossible");
        return { ideas: ideas.data, activity: activity.data };
      },
    },
    creer_idee: {
      description: "Enregistrer une nouvelle idée dans le laboratoire.",
      input: z.object({ title: z.string(), description: z.string() }),
      run: async ({ db, userId }, i) => {
        const { data, error } = await db.from("ideas").insert({ user_id: userId, title: String(i.title).slice(0, 150), description: String(i.description).slice(0, 5000) }).select("id,title").single();
        if (error) throw new Error(error.message);
        return data;
      },
    },
  },
  memotrack: {
    creer_memo: {
      description: "Enregistrer un mémo MemoTrack à partir du contenu réellement lu dans une pièce jointe (PDF, PNG ou MP3). Fournir le contenu extrait, résumé, décisions et actions sans inventer de scores.",
      input: z.object({ title: z.string(), transcript: z.string().min(1), summary: z.string(), decisions: z.array(z.string()), actions: z.array(z.object({ task: z.string(), owner: z.string().optional(), deadline: z.string().optional() })) }),
      run: async ({ db, userId }, i) => {
        const { data, error } = await db.from("meetings").insert({ user_id: userId, title: i.title.slice(0, 160), transcript: i.transcript, summary: i.summary, decisions: i.decisions, actions: i.actions }).select("id,title,summary").single();
        if (error) throw new Error(error.message);
        return data;
      },
    },
    lister_reunions: {
      description: "Lister les mémos de réunion récents avec résumé et scores.",
      input: z.object({}),
      run: async ({ db }) => {
        const { data, error } = await db.from("meetings").select("id,title,meeting_date,summary,score_global,sentiment,category").order("meeting_date", { ascending: false }).limit(20);
        if (error) throw new Error(error.message);
        return data;
      },
    },
    detail_reunion: {
      description: "Obtenir décisions, actions, risques et prochaines étapes d'une réunion (par id).",
      input: z.object({ id: z.string() }),
      run: async ({ db }, i) => {
        const { data, error } = await db.from("meetings").select("title,meeting_date,summary,decisions,actions,risks,next_steps,participants").eq("id", i.id).maybeSingle();
        if (error) throw new Error(error.message);
        return data ?? "Réunion introuvable";
      },
    },
  },
  angelo: {
    joindre_fichier: {
      description: "Joindre le fichier original fourni à Aura à une facture Odoo existante. attachment_index = index du fichier, odoo_id = id de facture vérifié.",
      input: z.object({ attachment_index: z.number().int().min(0), odoo_id: z.number().int().positive() }),
      run: async ({ db, userId, attachments }, i) => {
        const file = attachments?.[i.attachment_index];
        if (!file) throw new Error("Pièce jointe introuvable.");
        const engine = await import("./angelo-engine.server");
        const { odooAuthenticate, odooExecute } = await import("./odoo.server");
        const creds = await engine.loadConnection(db, userId);
        const uid = await odooAuthenticate(creds);
        return odooExecute(creds, uid, "ir.attachment", "create", [{ name: file.name, datas: file.data, mimetype: file.mime, res_model: "account.move", res_id: i.odoo_id }]);
      },
    },
    lister_impayes: {
      description: "Lister les factures impayées en cache (montant, client, échéance, relances).",
      input: z.object({}),
      run: async ({ db }) => {
        const { data, error } = await db.from("invoices_cache").select("odoo_id,name,partner_name,amount_residual,currency,due_date,reminder_count,partner_email").gt("amount_residual", 0).order("due_date").limit(50);
        if (error) throw new Error(error.message);
        return data;
      },
    },
    synchroniser: {
      description: "Synchroniser les factures depuis Odoo.",
      input: z.object({}),
      run: async ({ db, userId }) => (await import("./angelo-engine.server")).syncInvoices(db, userId),
    },
    lancer_analyse: {
      description: "Lancer l'analyse complète : synchronisation puis relances automatiques selon les règles.",
      input: z.object({ confirmed: z.boolean() }),
      run: async ({ db, userId }, i) => {
        if (!i.confirmed) return "Demande d'abord une confirmation orale explicite.";
        return (await import("./angelo-engine.server")).runAnalysis(db, userId, "manual");
      },
    },
    envoyer_relance: {
      description: "Envoyer une relance email pour une facture (odoo_id).",
      input: z.object({ odoo_id: z.number(), confirmed: z.boolean() }),
      run: async ({ db, userId }, i) => {
        if (!i.confirmed) return "Demande d'abord une confirmation orale explicite.";
        const engine = await import("./angelo-engine.server");
        const { odooAuthenticate } = await import("./odoo.server");
        const creds = await engine.loadConnection(db, userId);
        const uid = await odooAuthenticate(creds);
        const [{ data: settings }, { data: rules }, { data: invoice }] = await Promise.all([
          db.from("angelo_settings").select("*").eq("user_id", userId).maybeSingle(),
          db.from("reminder_rules").select("*").eq("user_id", userId).order("days_overdue"),
          db.from("invoices_cache").select("*").eq("user_id", userId).eq("odoo_id", i.odoo_id).maybeSingle(),
        ]);
        if (!settings) throw new Error("Paramètres introuvables.");
        if (!invoice) throw new Error("Facture introuvable. Lancez une synchronisation.");
        if (!invoice.partner_email) throw new Error("Ce client n'a pas d'email.");
        const overdue = Math.max(1, engine.daysOverdue(invoice.due_date));
        const rule = engine.pickRule(rules ?? [], overdue) ?? (rules ?? [])[0] ?? { level: 1, firmness: "courtois", instructions: "" };
        const sent = await engine.sendReminderForInvoice(db, userId, creds, uid, settings, rule, invoice, overdue);
        return { ok: true, subject: sent.subject };
      },
    },
  },
};

const catalog = [{ key: "lab", name: "Laboratoire IDEALAB", description: "Idées et activité de l'utilisateur." }, { key: "smartteams", name: "Smart Teams", description: "Tableau /board : équipes d'agents IA, départements, missions et livrables." }, ...applications];

/** Short description of every app and its actions, injected into the assistant prompts. */
export function appsSummary() {
  return catalog
    .map((a) => {
      const actions = Object.entries(appActions[a.key] ?? {}).map(([n, x]) => `${n} (${x.description})`).join("; ");
      return `- ${a.name} [${a.key}] : ${a.description} Actions : ${actions || "aucune action disponible pour l'instant"}.`;
    })
    .join("\n");
}

/** Run one registered lab action (used by Aura). */
export async function runAppAction(ctx: Ctx, app: string, action: string, input: unknown) {
  const def = appActions[app]?.[action];
  if (!def) return { error: `Action inconnue. Disponibles :\n${appsSummary()}` };
  const parsed = def.input.safeParse(input ?? {});
  if (!parsed.success) return { error: `Paramètres invalides : ${parsed.error.message}` };
  try {
    return await def.run(ctx, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Échec de l'action" };
  }
}
