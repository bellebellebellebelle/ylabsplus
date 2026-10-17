// Server-only agent execution engine. Uses Lovable AI Gateway (or BYOK) with tool calling
// to drive Gmail / Calendar / Tasks / Drive / Docs / Sheets / Forms operations.
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { resolveProvider, estimateCostUSD } from "./ai-gateway.server";
import { getValidAccessTokenForUser, gmail, calendar, tasks, drive, docs, sheets, forms } from "./google-mm.server";

type LogFn = (level: "info" | "error", message: string, payload?: unknown) => Promise<void>;
type ActionFn = (label: string, toolName: string, agentName: string, input: unknown) => Promise<string>;
type FinishFn = (id: string, status: "success" | "error", output: unknown, durationMs?: number, attempts?: number, errorMsg?: string) => Promise<void>;

function buildTools(
  token: string,
  agentName: string,
  recordAction: ActionFn,
  finishAction: FinishFn,
  stateRef: { value: Record<string, unknown> },
  saveState: () => Promise<void>,
) {
  const wrap = async <T>(label: string, name: string, input: unknown, fn: () => Promise<T>): Promise<T> => {
    const id = await recordAction(label, name, agentName, input);
    const t0 = Date.now();
    // Retry avec backoff exponentiel pour les erreurs transitoires (429/5xx/network).
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const out = await fn();
        await finishAction(id, "success", out, Date.now() - t0, attempt);
        return out;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const transient = /\b(429|5\d\d|ECONNRESET|ETIMEDOUT|fetch failed|network)\b/i.test(msg);
        if (!transient || attempt === 3) {
          await finishAction(id, "error", { error: msg, attempts: attempt }, Date.now() - t0, attempt, msg);
          throw e;
        }
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt - 1) + Math.random() * 200));
      }
    }
    throw lastErr;
  };

  const t = {
    state_get: tool({
      description: "Lit la mémoire d'idempotence (ids déjà traités) AVANT toute création pour éviter les doublons.",
      inputSchema: z.object({ key: z.string() }),
      execute: async ({ key }) => wrap(`mémoire: lire ${key}`, "state_get", { key }, async () => ({ key, value: stateRef.value[key] ?? null })),
    }),
    state_remember: tool({
      description: "Ajoute un id traité à la mémoire d'idempotence pour ne plus le retraiter.",
      inputSchema: z.object({ key: z.string(), value: z.string() }),
      execute: async ({ key, value }) => wrap(`mémoire: ${key}+=${value.slice(0, 40)}`, "state_remember", { key, value }, async () => {
        const arr = Array.isArray(stateRef.value[key]) ? stateRef.value[key] as string[] : [];
        if (!arr.includes(value)) arr.push(value);
        stateRef.value[key] = arr.slice(-500);
        await saveState();
        return { ok: true, size: (stateRef.value[key] as string[]).length };
      }),
    }),

    // Gmail
    gmail_list: tool({
      description: "Liste les emails Gmail (q = filtre Gmail, ex: 'is:unread newer_than:1d').",
      inputSchema: z.object({ query: z.string().optional(), max: z.number().optional() }),
      execute: async ({ query, max }) => wrap(`Gmail: lister (${query ?? "tous"})`, "gmail_list", { query, max }, () => gmail.list(token, query, max ?? 10)),
    }),
    gmail_read: tool({
      description: "Lit un email Gmail par id.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => wrap(`Gmail: lire ${id.slice(0, 8)}`, "gmail_read", { id }, () => gmail.read(token, id)),
    }),
    gmail_send: tool({
      description: "Envoie un email Gmail.",
      inputSchema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      execute: async ({ to, subject, body }) => wrap(`Gmail: envoi → ${to}`, "gmail_send", { to, subject }, () => gmail.send(token, to, subject, body)),
    }),
    gmail_draft: tool({
      description: "Crée un brouillon Gmail.",
      inputSchema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      execute: async ({ to, subject, body }) => wrap(`Gmail: brouillon → ${to}`, "gmail_draft", { to, subject }, () => gmail.draft(token, to, subject, body)),
    }),
    gmail_modify: tool({
      description: "Modifie les labels d'un email.",
      inputSchema: z.object({ id: z.string(), addLabels: z.array(z.string()).optional(), removeLabels: z.array(z.string()).optional() }),
      execute: async ({ id, addLabels, removeLabels }) => wrap(`Gmail: labels`, "gmail_modify", { id }, () => gmail.modify(token, id, addLabels ?? [], removeLabels ?? [])),
    }),
    gmail_trash: tool({
      description: "Met un email à la corbeille.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => wrap(`Gmail: corbeille`, "gmail_trash", { id }, () => gmail.trash(token, id)),
    }),
    gmail_list_attachments: tool({
      description: "Liste les pièces jointes d'un email (renvoie filename/mimeType/attachmentId/size).",
      inputSchema: z.object({ messageId: z.string() }),
      execute: async ({ messageId }) => wrap(`Gmail: PJ ${messageId.slice(0,8)}`, "gmail_list_attachments", { messageId }, () => gmail.listAttachments(token, messageId)),
    }),
    gmail_get_attachment: tool({
      description: "Télécharge le contenu base64url d'une pièce jointe Gmail. Utilise ensuite drive_upload_file pour l'envoyer sur Drive.",
      inputSchema: z.object({ messageId: z.string(), attachmentId: z.string() }),
      execute: async ({ messageId, attachmentId }) => wrap(`Gmail: PJ get`, "gmail_get_attachment", { messageId, attachmentId }, async () => {
        const r = await gmail.getAttachment(token, messageId, attachmentId);
        // Ne pas remonter les octets bruts dans les logs, seulement la taille.
        return { size: r.size, dataBase64Url: r.data };
      }),
    }),
    gmail_save_attachments_to_drive: tool({
      description: "Pipeline optimisé: pour un message Gmail donné, télécharge TOUTES ses pièces jointes et les envoie sur Google Drive dans le dossier `folderId` (facultatif). Renvoie la liste des fichiers créés. Idempotence: passe un préfixe.",
      inputSchema: z.object({ messageId: z.string(), folderId: z.string().optional(), prefix: z.string().optional() }),
      execute: async ({ messageId, folderId, prefix }) => wrap(`Gmail→Drive PJ ${messageId.slice(0,8)}`, "gmail_save_attachments_to_drive", { messageId, folderId }, async () => {
        const { attachments } = await gmail.listAttachments(token, messageId);
        const uploaded: Array<{ id: string; name: string; webViewLink?: string }> = [];
        for (const a of attachments) {
          const raw = await gmail.getAttachment(token, messageId, a.attachmentId);
          const name = prefix ? `${prefix}_${a.filename}` : a.filename;
          const file = await drive.uploadBase64(token, name, a.mimeType, raw.data, folderId);
          uploaded.push(file);
        }
        return { count: uploaded.length, files: uploaded };
      }),
    }),

    // Calendar
    calendar_list_events: tool({
      description: "Liste les événements à venir.",
      inputSchema: z.object({ calendarId: z.string().optional(), max: z.number().optional() }),
      execute: async ({ calendarId, max }) => wrap(`Agenda: lister`, "calendar_list_events", { calendarId, max }, () => calendar.listEvents(token, calendarId ?? "primary", max ?? 10)),
    }),
    calendar_create_event: tool({
      description: "Crée un événement. AVANT: state_get('planned_events') et liste les événements pour éviter doublon. APRÈS: state_remember('planned_events', <id>).",
      inputSchema: z.object({
        calendarId: z.string().optional(),
        summary: z.string(),
        description: z.string().optional(),
        startISO: z.string(),
        endISO: z.string(),
        attendees: z.array(z.string()).optional(),
      }),
      execute: async ({ calendarId, summary, description, startISO, endISO, attendees }) => wrap(
        `Agenda: créer "${summary}"`, "calendar_create_event", { summary, startISO, endISO },
        () => calendar.createEvent(token, calendarId ?? "primary", {
          summary, description,
          start: { dateTime: startISO },
          end: { dateTime: endISO },
          attendees: attendees?.map((email) => ({ email })),
        }),
      ),
    }),
    calendar_update_event: tool({
      description: "Met à jour un événement.",
      inputSchema: z.object({ calendarId: z.string().optional(), eventId: z.string(), patch: z.record(z.string(), z.any()) }),
      execute: async ({ calendarId, eventId, patch }) => wrap(`Agenda: modifier`, "calendar_update_event", { eventId }, () => calendar.updateEvent(token, calendarId ?? "primary", eventId, patch)),
    }),
    calendar_delete_event: tool({
      description: "Supprime un événement.",
      inputSchema: z.object({ calendarId: z.string().optional(), eventId: z.string() }),
      execute: async ({ calendarId, eventId }) => wrap(`Agenda: supprimer`, "calendar_delete_event", { eventId }, () => calendar.deleteEvent(token, calendarId ?? "primary", eventId)),
    }),
    calendar_list_calendars: tool({
      description: "Liste les calendriers.",
      inputSchema: z.object({}),
      execute: async () => wrap(`Agenda: calendriers`, "calendar_list_calendars", {}, () => calendar.listCalendars(token)),
    }),

    // Tasks
    tasks_list_lists: tool({
      description: "Liste les listes Google Tasks existantes.",
      inputSchema: z.object({}),
      execute: async () => wrap(`Tasks: listes`, "tasks_list_lists", {}, () => tasks.listLists(token)),
    }),
    tasks_create_list: tool({
      description: "Crée une NOUVELLE liste Google Tasks (renvoie l'id de liste). Utilise ceci quand l'utilisateur demande une nouvelle liste avec des tâches.",
      inputSchema: z.object({ title: z.string() }),
      execute: async ({ title }) => wrap(`Tasks: nouvelle liste "${title}"`, "tasks_create_list", { title }, () => tasks.createList(token, title)),
    }),
    tasks_delete_list: tool({
      description: "Supprime une liste Google Tasks.",
      inputSchema: z.object({ listId: z.string() }),
      execute: async ({ listId }) => wrap(`Tasks: supprimer liste`, "tasks_delete_list", { listId }, () => tasks.deleteList(token, listId)),
    }),
    tasks_rename_list: tool({
      description: "Renomme une liste Google Tasks.",
      inputSchema: z.object({ listId: z.string(), title: z.string() }),
      execute: async ({ listId, title }) => wrap(`Tasks: renommer liste`, "tasks_rename_list", { listId, title }, () => tasks.renameList(token, listId, title)),
    }),
    tasks_list: tool({
      description: "Liste les tâches.",
      inputSchema: z.object({ listId: z.string() }),
      execute: async ({ listId }) => wrap(`Tasks: lister`, "tasks_list", { listId }, () => tasks.listTasks(token, listId)),
    }),
    tasks_create: tool({
      description: "Crée une tâche. AVANT: state_get('created_tasks') pour éviter doublon. APRÈS: state_remember('created_tasks', <hash>).",
      inputSchema: z.object({ listId: z.string(), title: z.string(), notes: z.string().optional(), due: z.string().optional() }),
      execute: async ({ listId, title, notes, due }) => wrap(`Tasks: créer "${title}"`, "tasks_create", { title }, () => tasks.create(token, listId, { title, notes, due })),
    }),
    tasks_complete: tool({
      description: "Termine une tâche.",
      inputSchema: z.object({ listId: z.string(), taskId: z.string() }),
      execute: async ({ listId, taskId }) => wrap(`Tasks: terminer`, "tasks_complete", { taskId }, () => tasks.complete(token, listId, taskId)),
    }),
    tasks_delete: tool({
      description: "Supprime une tâche.",
      inputSchema: z.object({ listId: z.string(), taskId: z.string() }),
      execute: async ({ listId, taskId }) => wrap(`Tasks: supprimer`, "tasks_delete", { taskId }, () => tasks.remove(token, listId, taskId)),
    }),

    // Drive
    drive_list: tool({
      description: "Liste/recherche les fichiers Drive (q = requête Drive ex: \"mimeType='application/pdf'\").",
      inputSchema: z.object({ q: z.string().optional(), max: z.number().optional() }),
      execute: async ({ q, max }) => wrap(`Drive: lister`, "drive_list", { q }, () => drive.list(token, q, max ?? 25)),
    }),
    drive_get: tool({
      description: "Métadonnées d'un fichier Drive.",
      inputSchema: z.object({ fileId: z.string() }),
      execute: async ({ fileId }) => wrap(`Drive: méta`, "drive_get", { fileId }, () => drive.get(token, fileId)),
    }),
    drive_create_folder: tool({
      description: "Crée un dossier Drive.",
      inputSchema: z.object({ name: z.string(), parentId: z.string().optional() }),
      execute: async ({ name, parentId }) => wrap(`Drive: dossier "${name}"`, "drive_create_folder", { name }, () => drive.createFolder(token, name, parentId)),
    }),
    drive_delete: tool({
      description: "Supprime un fichier Drive.",
      inputSchema: z.object({ fileId: z.string() }),
      execute: async ({ fileId }) => wrap(`Drive: supprimer`, "drive_delete", { fileId }, () => drive.delete(token, fileId)),
    }),
    drive_rename: tool({
      description: "Renomme un fichier Drive.",
      inputSchema: z.object({ fileId: z.string(), name: z.string() }),
      execute: async ({ fileId, name }) => wrap(`Drive: renommer → ${name}`, "drive_rename", { fileId, name }, () => drive.rename(token, fileId, name)),
    }),
    drive_move: tool({
      description: "Déplace un fichier Drive vers un autre dossier.",
      inputSchema: z.object({ fileId: z.string(), newParent: z.string() }),
      execute: async ({ fileId, newParent }) => wrap(`Drive: déplacer`, "drive_move", { fileId, newParent }, () => drive.move(token, fileId, newParent)),
    }),
    drive_copy: tool({
      description: "Copie un fichier Drive.",
      inputSchema: z.object({ fileId: z.string(), name: z.string().optional() }),
      execute: async ({ fileId, name }) => wrap(`Drive: copier`, "drive_copy", { fileId }, () => drive.copy(token, fileId, name)),
    }),
    drive_share: tool({
      description: "Partage un fichier Drive avec un email.",
      inputSchema: z.object({ fileId: z.string(), email: z.string(), role: z.enum(["reader", "writer", "commenter"]).optional() }),
      execute: async ({ fileId, email, role }) => wrap(`Drive: partager → ${email}`, "drive_share", { fileId, email }, () => drive.share(token, fileId, email, role ?? "reader")),
    }),
    drive_list_permissions: tool({
      description: "Liste les permissions d'un fichier Drive.",
      inputSchema: z.object({ fileId: z.string() }),
      execute: async ({ fileId }) => wrap(`Drive: permissions`, "drive_list_permissions", { fileId }, () => drive.listPermissions(token, fileId)),
    }),
    drive_list_versions: tool({
      description: "Liste les révisions d'un fichier Drive.",
      inputSchema: z.object({ fileId: z.string() }),
      execute: async ({ fileId }) => wrap(`Drive: versions`, "drive_list_versions", { fileId }, () => drive.listVersions(token, fileId)),
    }),
    drive_upload_file: tool({
      description: "Envoie un fichier binaire (base64url ou base64) sur Drive. Utile pour sauvegarder des pièces jointes Gmail.",
      inputSchema: z.object({ name: z.string(), mimeType: z.string(), base64: z.string(), parentId: z.string().optional() }),
      execute: async ({ name, mimeType, base64, parentId }) => wrap(`Drive: upload ${name}`, "drive_upload_file", { name, mimeType, parentId }, () => drive.uploadBase64(token, name, mimeType, base64, parentId)),
    }),

    // Docs
    docs_read: tool({
      description: "Lit le contenu d'un Google Doc.",
      inputSchema: z.object({ documentId: z.string() }),
      execute: async ({ documentId }) => wrap(`Docs: lire`, "docs_read", { documentId }, () => docs.read(token, documentId)),
    }),
    docs_create: tool({
      description: "Crée un Google Doc vide.",
      inputSchema: z.object({ title: z.string() }),
      execute: async ({ title }) => wrap(`Docs: créer "${title}"`, "docs_create", { title }, () => docs.create(token, title)),
    }),
    docs_append: tool({
      description: "Ajoute du texte à la fin d'un Google Doc.",
      inputSchema: z.object({ documentId: z.string(), text: z.string() }),
      execute: async ({ documentId, text }) => wrap(`Docs: ajouter texte`, "docs_append", { documentId }, () => docs.append(token, documentId, text)),
    }),
    docs_replace_text: tool({
      description: "Remplace du texte dans un Google Doc.",
      inputSchema: z.object({ documentId: z.string(), find: z.string(), replace: z.string() }),
      execute: async ({ documentId, find, replace }) => wrap(`Docs: remplacer`, "docs_replace_text", { find }, () => docs.replaceText(token, documentId, find, replace)),
    }),

    // Sheets
    sheets_read: tool({
      description: "Lit une plage A1 d'une Google Sheet.",
      inputSchema: z.object({ spreadsheetId: z.string(), range: z.string() }),
      execute: async ({ spreadsheetId, range }) => wrap(`Sheets: lire ${range}`, "sheets_read", { spreadsheetId, range }, () => sheets.read(token, spreadsheetId, range)),
    }),
    sheets_append_row: tool({
      description: "Ajoute une ou plusieurs lignes à une Google Sheet.",
      inputSchema: z.object({ spreadsheetId: z.string(), range: z.string(), values: z.array(z.array(z.any())) }),
      execute: async ({ spreadsheetId, range, values }) => wrap(`Sheets: append ${range}`, "sheets_append_row", { range }, () => sheets.append(token, spreadsheetId, range, values)),
    }),
    sheets_write_range: tool({
      description: "Écrit des valeurs dans une plage.",
      inputSchema: z.object({ spreadsheetId: z.string(), range: z.string(), values: z.array(z.array(z.any())) }),
      execute: async ({ spreadsheetId, range, values }) => wrap(`Sheets: écrire ${range}`, "sheets_write_range", { range }, () => sheets.write(token, spreadsheetId, range, values)),
    }),
    sheets_create: tool({
      description: "Crée une nouvelle Google Sheet.",
      inputSchema: z.object({ title: z.string() }),
      execute: async ({ title }) => wrap(`Sheets: créer "${title}"`, "sheets_create", { title }, () => sheets.create(token, title)),
    }),

    // Forms
    forms_get: tool({
      description: "Récupère un Google Form.",
      inputSchema: z.object({ formId: z.string() }),
      execute: async ({ formId }) => wrap(`Forms: lire`, "forms_get", { formId }, () => forms.get(token, formId)),
    }),
    forms_create: tool({
      description: "Crée un nouveau Google Form.",
      inputSchema: z.object({ title: z.string() }),
      execute: async ({ title }) => wrap(`Forms: créer "${title}"`, "forms_create", { title }, () => forms.create(token, title)),
    }),
    forms_add_question: tool({
      description: "Ajoute une question (texte ou choix multiple) à un Form.",
      inputSchema: z.object({ formId: z.string(), title: z.string(), options: z.array(z.string()).optional() }),
      execute: async ({ formId, title, options }) => wrap(`Forms: question "${title}"`, "forms_add_question", { formId, title }, () => forms.addQuestion(token, formId, title, options)),
    }),
    forms_list_responses: tool({
      description: "Liste les réponses d'un Form.",
      inputSchema: z.object({ formId: z.string() }),
      execute: async ({ formId }) => wrap(`Forms: réponses`, "forms_list_responses", { formId }, () => forms.listResponses(token, formId)),
    }),
    forms_update_info: tool({
      description: "Met à jour titre/description d'un Form.",
      inputSchema: z.object({ formId: z.string(), title: z.string(), description: z.string().optional() }),
      execute: async ({ formId, title, description }) => wrap(`Forms: maj info`, "forms_update_info", { formId }, () => forms.updateInfo(token, formId, title, description)),
    }),
  };
  return t;
}

// Construit dynamiquement les outils personnalisés (HTTP) définis par l'utilisateur.
type CustomToolRow = {
  id: string;
  name: string;
  description: string;
  http_method: string;
  url: string;
  headers: Record<string, string> | unknown;
  body_template: string | null;
};

function buildCustomTools(
  rows: CustomToolRow[],
  agentName: string,
  recordAction: ActionFn,
  finishAction: FinishFn,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const r of rows) {
    const safeName = `custom_${r.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40)}`;
    out[safeName] = tool({
      description: `[Outil personnalisé] ${r.description}. Méthode ${r.http_method} vers ${r.url}. Passe éventuellement { params } (objet) pour interpoler {{key}} dans l'URL/le body.`,
      inputSchema: z.object({ params: z.record(z.string(), z.any()).optional() }),
      execute: async ({ params }) => {
        const id = await recordAction(`Outil: ${r.name}`, safeName, agentName, { params });
        const t0 = Date.now();
        try {
          const interp = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => {
            const v = (params ?? {})[k];
            return v === undefined || v === null ? "" : String(v);
          });
          const url = interp(r.url);
          const headers: Record<string, string> = { "content-type": "application/json" };
          if (r.headers && typeof r.headers === "object") {
            for (const [k, v] of Object.entries(r.headers as Record<string, string>)) headers[k] = interp(String(v));
          }
          const method = (r.http_method || "GET").toUpperCase();
          const body = r.body_template && method !== "GET" ? interp(r.body_template) : undefined;
          const res = await fetch(url, { method, headers, body });
          const text = await res.text();
          let parsed: unknown = text;
          try { parsed = JSON.parse(text); } catch { /* keep text */ }
          const output = { status: res.status, ok: res.ok, body: parsed };
          await finishAction(id, res.ok ? "success" : "error", output, Date.now() - t0, 1, res.ok ? undefined : `HTTP ${res.status}`);
          return output;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await finishAction(id, "error", { error: msg }, Date.now() - t0, 1, msg);
          throw e;
        }
      },
    });
  }
  return out;
}

export async function executeAutomation(automationId: string, userId: string, triggerId: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: autoRow } = await supabaseAdmin
    .from("automations").select("timezone, state, model").eq("id", automationId).maybeSingle();
  const timezone = autoRow?.timezone || "Indian/Reunion";
  const defaultModel = (autoRow?.model as string) || "google/gemini-2.5-flash-lite";
  const stateRef = { value: (autoRow?.state ?? {}) as Record<string, unknown> };
  const saveState = async () => { await supabaseAdmin.from("automations").update({ state: stateRef.value as never }).eq("id", automationId); };

  const { data: exec, error: execErr } = await supabaseAdmin
    .from("executions")
    .insert({ automation_id: automationId, trigger_id: triggerId, status: "running", input: {} })
    .select("id").single();
  if (execErr || !exec) throw new Error(execErr?.message ?? "Création exécution échouée");
  const executionId = exec.id;

  const log: LogFn = async (level, message, payload) => {
    await supabaseAdmin.from("execution_logs").insert({
      execution_id: executionId, level, message,
      payload: payload ? (JSON.parse(JSON.stringify(payload)) as never) : null,
    });
  };
  const recordAction: ActionFn = async (label, toolName, agentName, input) => {
    const { data } = await supabaseAdmin.from("execution_actions").insert({
      execution_id: executionId, agent_name: agentName, tool: toolName, label,
      status: "running", input: input as never,
    }).select("id").single();
    return data?.id as string;
  };
  const finishAction: FinishFn = async (id, status, output, durationMs, attempts, errorMsg) => {
    if (!id) return;
    await supabaseAdmin.from("execution_actions").update({
      status, finished_at: new Date().toISOString(),
      output: JSON.parse(JSON.stringify(output ?? {})) as never,
      duration_ms: durationMs ?? null,
      attempts: attempts ?? 1,
      error: errorMsg ?? null,
    }).eq("id", id);
  };

  try {
    const tokenInfo = await getValidAccessTokenForUser(userId);
    if (!tokenInfo) throw new Error("Aucune connexion Google. Connectez vos comptes Google.");

    const { data: agents } = await supabaseAdmin
      .from("agents").select("*").eq("automation_id", automationId).order("order", { ascending: true });
    if (!agents?.length) throw new Error("Aucun agent configuré");

    const apiKey = process.env.LOVABLE_API_KEY!;
    // BYOK: lire la clé de l'utilisateur si présente.
    const { data: byokRow } = await supabaseAdmin
      .from("user_ai_keys")
      .select("preferred_provider, openai_key, gemini_key")
      .eq("user_id", userId)
      .maybeSingle();

    // Outils personnalisés (HTTP) activés par l'utilisateur.
    const { data: customToolsRows } = await supabaseAdmin
      .from("agent_tools")
      .select("id, name, description, http_method, url, headers, body_template")
      .eq("user_id", userId)
      .eq("enabled", true);
    const customTools = (customToolsRows ?? []) as CustomToolRow[];
    const customToolsDoc = customTools.length
      ? customTools.map((t) => `- ${`custom_${t.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40)}`} : ${t.description}`).join("\n")
      : "(aucun outil personnalisé activé)";

    const nowLocal = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "long", timeZone: timezone }).format(new Date());
    const transcript: string[] = [];

    for (const agent of agents) {
      const baseTools = buildTools(tokenInfo.token, agent.name, recordAction, finishAction, stateRef, saveState);
      const extra = buildCustomTools(customTools, agent.name, recordAction, finishAction);
      const toolset = { ...baseTools, ...extra };
      await log("info", `Agent ${agent.name} démarre`, { role: agent.role, customTools: customTools.length });
      const sys = `Tu es l'agent autonome "${agent.name}".
Rôle: ${agent.role ?? "exécution"}.
Services disponibles: Gmail (incl. pièces jointes), Calendar, Tasks (listes+tâches, création/suppression de listes), Drive (upload multipart), Docs, Sheets, Forms.
Outils personnalisés activés:
${customToolsDoc}
Fuseau horaire: ${timezone}. Maintenant: ${nowLocal}.

RÈGLES ANTI-DOUBLON CRITIQUES:
- Avant TOUTE création (événement, tâche, doc, message, upload), appelle state_get.
- Clé stable: 'evt:<source_id>' ou 'att:<messageId>:<attachmentId>' pour les pièces jointes.
- Si déjà présent: NE PAS recréer, journalise la raison.
- Après création: appelle state_remember pour mémoriser l'id ou le hash.

TASKS - CRÉATION DE LISTES:
- Si l'utilisateur demande une NOUVELLE liste de tâches, appelle tasks_create_list puis tasks_create sur l'id retourné.
- Ne réutilise une liste existante que si l'utilisateur l'a nommée explicitement.

PIÈCES JOINTES GMAIL → DRIVE:
- Utilise gmail_save_attachments_to_drive pour un pipeline optimisé (liste + get + upload en une passe).
- Pour un dossier Drive existant, passe folderId. Sinon, crée-le avec drive_create_folder puis mémorise-le dans state.

OUTIL MANQUANT:
- Si tu as besoin d'un outil qui n'existe pas dans la liste ci-dessus pour accomplir la mission, ARRÊTE-toi et écris à la fin de ta réponse une ligne EXACTEMENT au format:
  TOOL_MISSING: <nom_court> — <description de l'outil manquant et ce qu'il devrait faire>
  L'utilisateur ajoutera l'outil dans l'onglet "Outils" puis relancera l'automatisation.

EFFICACITÉ: minimise les appels. Batch les lectures. Ne fais pas d'appels redondants.
UTF-8: n'échappe JAMAIS les accents en \\u00XX; garde les caractères tels quels (é, è, à, ê…).

Instructions:
${agent.instructions}

Termine par un résumé court en français.`;

      const userMsg = transcript.length
        ? `Contexte précédent:\n${transcript.join("\n\n")}\n\nExécute ton rôle.`
        : `Exécute ton rôle maintenant.`;

      const requestedModel = (agent.model as string | null) || defaultModel;
      const { provider, modelId, source } = resolveProvider({
        requestedModel,
        lovableKey: apiKey,
        byok: byokRow ? { preferred_provider: (byokRow.preferred_provider ?? "lovable") as "lovable" | "openai" | "gemini", openai_key: byokRow.openai_key, gemini_key: byokRow.gemini_key } : null,
      });

      const result = await generateText({
        model: provider(modelId),
        system: sys,
        prompt: userMsg,
        tools: toolset,
        stopWhen: stepCountIs(50),
      });

      transcript.push(`# ${agent.name}\n${result.text}`);

      // Cost tracking (BYOK = coût 0 côté plateforme).
      const usage = (result as unknown as { usage?: { promptTokens?: number; completionTokens?: number; inputTokens?: number; outputTokens?: number } }).usage ?? {};
      const inp = usage.inputTokens ?? usage.promptTokens ?? 0;
      const outp = usage.outputTokens ?? usage.completionTokens ?? 0;
      const cost = source === "lovable_ai" ? estimateCostUSD(requestedModel, inp, outp) : 0;
      await supabaseAdmin.from("execution_costs").insert({
        execution_id: executionId, automation_id: automationId, user_id: userId,
        model: requestedModel, input_tokens: inp, output_tokens: outp, cost_usd: cost, provider: source,
      });

      await log("info", `Agent ${agent.name} terminé`, { text: result.text, toolCalls: result.toolCalls?.length ?? 0, tokens: { in: inp, out: outp }, provider: source, cost });
    }

    await supabaseAdmin.from("executions").update({
      status: "success", finished_at: new Date().toISOString(),
      output: { summary: transcript.join("\n\n---\n\n") } as never,
    }).eq("id", executionId);

    if (triggerId) {
      await supabaseAdmin.from("triggers")
        .update({ consecutive_failures: 0, last_error: null, last_run_at: new Date().toISOString() })
        .eq("id", triggerId);
    }

    return { executionId, status: "success" as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("error", "Exécution échouée", { error: msg });
    await supabaseAdmin.from("executions").update({
      status: "error", finished_at: new Date().toISOString(), error: msg,
    }).eq("id", executionId);
    if (triggerId) {
      const { data: t } = await supabaseAdmin.from("triggers").select("consecutive_failures").eq("id", triggerId).maybeSingle();
      await supabaseAdmin.from("triggers").update({
        consecutive_failures: (t?.consecutive_failures ?? 0) + 1,
        last_error: msg, last_run_at: new Date().toISOString(),
      }).eq("id", triggerId);
    }
    return { executionId, status: "error" as const, error: msg };
  }
}
