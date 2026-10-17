// Comprehensive Google Workspace tool set for the OCKTAVUS agent.
// Tools call Google APIs via googleFetch (auto-refresh) and log every action to agent_actions_log.
import { tool } from "ai";
import { z } from "zod";
import { googleFetch, encodeRawEmail } from "./google.server";
import { extractMessageFields, gmailFetch } from "./gmail.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Source = "web" | "voice" | "google-chat";
type AgentPreferences = {
  timezone?: string;
  emailGreeting?: string;
  emailSignature?: string;
  emailTone?: string;
  taskId?: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|409|425|429|500|502|503|504)\b|network|fetch failed|timeout/i.test(message);
}

function verificationUrl(name: string, result: any) {
  if (!result || typeof result !== "object") return null;
  if (typeof result.htmlLink === "string") return result.htmlLink;
  if (typeof result.webViewLink === "string") return result.webViewLink;
  const id = result.id ?? result.message?.id ?? result.formId ?? result.presentationId ?? result.spreadsheetId ?? result.documentId;
  if (!id) return null;
  if (/email|draft/.test(name)) return `https://mail.google.com/mail/u/0/#all/${id}`;
  if (/event/.test(name)) return `https://calendar.google.com/calendar/u/0/r`;
  if (/form/.test(name)) return `https://docs.google.com/forms/d/${id}/edit`;
  if (/presentation|slide/.test(name)) return `https://docs.google.com/presentation/d/${id}/edit`;
  if (/sheet/.test(name)) return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  if (/doc/.test(name)) return `https://docs.google.com/document/d/${id}/edit`;
  if (/file|folder/.test(name)) return `https://drive.google.com/open?id=${id}`;
  return null;
}

function localDateTime(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`Date/heure invalide: ${value}. Format attendu YYYY-MM-DDTHH:mm:ss sans décalage.`);
  return `${match[1]}T${match[2]}:${match[3] ?? "00"}`;
}

function personalizeEmail(body: string, preferences: AgentPreferences) {
  const greeting = preferences.emailGreeting?.trim() || "Bonjour";
  const signature = preferences.emailSignature?.trim();
  let next = body.trim();
  if (!/^(bonjour|bonsoir|salut|hello|cher|chère)\b/i.test(next)) next = `${greeting},\n\n${next}`;
  if (signature && !next.endsWith(signature)) next = `${next}\n\n${signature}`;
  return next;
}

async function logAction(
  userId: string,
  toolName: string,
  args: any,
  result: any,
  status: "success" | "error",
  source: Source,
  details: { taskId?: string; attempt?: number; verificationUrl?: string | null; errorDetail?: string } = {},
) {
  try {
    await supabaseAdmin.from("agent_actions_log").insert({
      user_id: userId,
      tool_name: toolName,
      args: args ?? null,
      result: typeof result === "string" ? { text: result.slice(0, 2000) } : result ?? null,
      status,
      source,
      task_id: details.taskId ?? null,
      attempt: details.attempt ?? 1,
      stage: status === "success" ? "verified" : "failed",
      plan: { action: toolName, parameters: args ?? {} },
      verification_url: details.verificationUrl ?? null,
      error_detail: details.errorDetail ?? null,
    });
  } catch (e) {
    console.error("logAction failed", e);
  }
}

function wrap<TArgs extends z.ZodTypeAny>(
  userId: string,
  source: Source,
  name: string,
  description: string,
  schema: TArgs,
  fn: (args: z.infer<TArgs>) => Promise<any>,
  preferences: AgentPreferences,
) {
  return tool({
    description,
    inputSchema: schema,
    execute: async (args) => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await fn(args as any);
          const url = verificationUrl(name, result);
          await logAction(userId, name, args, summarize(result), "success", source, {
            ...(preferences.taskId ? { taskId: preferences.taskId } : {}),
            attempt,
            verificationUrl: url,
          });
          return {
            result,
            verificationUrl: url ?? undefined,
            verified: true,
            attempts: attempt,
          };
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          await logAction(userId, name, args, { error: msg }, "error", source, {
            ...(preferences.taskId ? { taskId: preferences.taskId } : {}),
            attempt,
            errorDetail: `Tentative ${attempt}: ${msg}`,
          });
          if (attempt === 3 || !isTransientError(e)) {
            return { error: msg, attempts: attempt, diagnostic: "L'étape a échoué après analyse de l'erreur; les paramètres doivent être vérifiés ou précisés." };
          }
          await delay(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150));
        }
      }
      return { error: "Échec inattendu" };
    },
  });
}

function summarize(result: any): any {
  if (result == null) return null;
  if (Array.isArray(result)) return { count: result.length, sample: result.slice(0, 3) };
  if (typeof result === "object") {
    const out: any = {};
    let n = 0;
    for (const [k, v] of Object.entries(result)) {
      if (n++ > 8) break;
      if (Array.isArray(v)) out[k] = `[${v.length} items]`;
      else if (typeof v === "string") out[k] = v.slice(0, 200);
      else out[k] = v;
    }
    return out;
  }
  return result;
}

// Google API base URLs
const CAL = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DOCS = "https://docs.googleapis.com/v1";
const SHEETS = "https://sheets.googleapis.com/v4";
const TASKS = "https://tasks.googleapis.com/tasks/v1";
const PEOPLE = "https://people.googleapis.com/v1";
const FORMS = "https://forms.googleapis.com/v1";
const SLIDES = "https://slides.googleapis.com/v1";
const BLOGGER = "https://www.googleapis.com/blogger/v3";

export function buildAllTools(userId: string, source: Source = "web", preferences: AgentPreferences = {}) {
  const u = userId;
  const s = source;
  const W = <T extends z.ZodTypeAny>(name: string, desc: string, schema: T, fn: (a: z.infer<T>) => Promise<any>) =>
    wrap(u, s, name, desc, schema, fn, preferences);

  return {
    // ============ GMAIL ============
    list_emails: W(
      "list_emails",
      "Liste les emails (syntaxe Gmail: is:unread, from:..., subject:..., after:YYYY/MM/DD).",
      z.object({ query: z.string().optional(), maxResults: z.number().int().min(1).max(50).default(10) }),
      async ({ query, maxResults }) => {
        const params = new URLSearchParams({ maxResults: String(maxResults ?? 10) });
        if (query) params.set("q", query);
        const data = await gmailFetch(u, `/users/me/messages?${params.toString()}`);
        const ids = (data.messages ?? []).slice(0, maxResults ?? 10);
        const detailed = await Promise.all(
          ids.map((m: any) =>
            gmailFetch(u, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
              .then(extractMessageFields)
              .catch(() => null),
          ),
        );
        return { emails: detailed.filter(Boolean) };
      },
    ),
    search_emails: W(
      "search_emails",
      "Recherche des emails par requête Gmail.",
      z.object({ query: z.string(), maxResults: z.number().int().min(1).max(50).default(20) }),
      async ({ query, maxResults }) => {
        const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
        const data = await gmailFetch(u, `/users/me/messages?${params.toString()}`);
        return { messageIds: (data.messages ?? []).map((m: any) => m.id) };
      },
    ),
    read_email: W(
      "read_email",
      "Lit le contenu complet d'un email par ID.",
      z.object({ messageId: z.string() }),
      async ({ messageId }) => extractMessageFields(await gmailFetch(u, `/users/me/messages/${messageId}?format=full`)),
    ),
    get_thread: W(
      "get_thread",
      "Lit tous les messages d'un thread.",
      z.object({ threadId: z.string() }),
      async ({ threadId }) => {
        const d = await gmailFetch(u, `/users/me/threads/${threadId}?format=full`);
        return { id: d.id, messages: (d.messages ?? []).map(extractMessageFields) };
      },
    ),
    send_email: W(
      "send_email",
      "Envoie un email immédiatement.",
      z.object({ to: z.string(), cc: z.string().optional(), bcc: z.string().optional(), subject: z.string(), body: z.string() }),
      async (a) => {
        const { cc, bcc, ...rest } = a; const raw = encodeRawEmail({ ...rest, ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}), body: personalizeEmail(a.body, preferences) });
        return gmailFetch(u, "/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
      },
    ),
    reply_email: W(
      "reply_email",
      "Répond à un email en conservant le thread.",
      z.object({ messageId: z.string(), body: z.string() }),
      async ({ messageId, body }) => {
        const orig = await gmailFetch(u, `/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`);
        const headers: Record<string, string> = {};
        for (const h of orig.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
        const subject = headers['subject']?.startsWith("Re:") ? headers['subject'] : `Re: ${headers['subject'] ?? ""}`;
         const raw = encodeRawEmail({ to: headers['from'] ?? "", subject, body: personalizeEmail(body, preferences) });
        return gmailFetch(u, "/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw, threadId: orig.threadId }) });
      },
    ),
    create_draft: W(
      "create_draft",
      "Crée un brouillon (ne l'envoie pas).",
      z.object({ to: z.string(), cc: z.string().optional(), bcc: z.string().optional(), subject: z.string(), body: z.string() }),
      async (a) => {
        const { cc, bcc, ...rest } = a; const raw = encodeRawEmail({ ...rest, ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}), body: personalizeEmail(a.body, preferences) });
        return gmailFetch(u, "/users/me/drafts", { method: "POST", body: JSON.stringify({ message: { raw } }) });
      },
    ),
    archive_email: W(
      "archive_email",
      "Archive un email (retire INBOX).",
      z.object({ messageId: z.string() }),
      async ({ messageId }) => gmailFetch(u, `/users/me/messages/${messageId}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["INBOX"] }) }),
    ),
    delete_email: W(
      "delete_email",
      "Supprime définitivement un email (corbeille).",
      z.object({ messageId: z.string() }),
      async ({ messageId }) => gmailFetch(u, `/users/me/messages/${messageId}/trash`, { method: "POST" }),
    ),
    mark_read: W("mark_read", "Marque un email comme lu.", z.object({ messageId: z.string() }),
      async ({ messageId }) => gmailFetch(u, `/users/me/messages/${messageId}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) })),
    mark_unread: W("mark_unread", "Marque un email comme non lu.", z.object({ messageId: z.string() }),
      async ({ messageId }) => gmailFetch(u, `/users/me/messages/${messageId}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: ["UNREAD"] }) })),
    list_labels: W("list_labels", "Liste les labels Gmail.", z.object({}), async () => gmailFetch(u, "/users/me/labels")),
    add_label: W("add_label", "Ajoute un label à un email.", z.object({ messageId: z.string(), labelId: z.string() }),
      async ({ messageId, labelId }) => gmailFetch(u, `/users/me/messages/${messageId}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: [labelId] }) })),
    remove_label: W("remove_label", "Retire un label d'un email.", z.object({ messageId: z.string(), labelId: z.string() }),
      async ({ messageId, labelId }) => gmailFetch(u, `/users/me/messages/${messageId}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: [labelId] }) })),

    // ============ CALENDAR ============
    list_events: W(
      "list_events",
      "Liste les événements du calendrier (par défaut, à venir).",
      z.object({
        calendarId: z.string().default("primary"),
        timeMin: z.string().optional().describe("ISO 8601, défaut = maintenant"),
        timeMax: z.string().optional(),
        maxResults: z.number().int().min(1).max(50).default(20),
      }),
      async ({ calendarId, timeMin, timeMax, maxResults }) => {
        const params = new URLSearchParams({
          timeMin: timeMin ?? new Date().toISOString(),
          maxResults: String(maxResults),
          singleEvents: "true",
          orderBy: "startTime",
        });
        if (timeMax) params.set("timeMax", timeMax);
        return googleFetch(u, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
      },
    ),
    get_event: W("get_event", "Détails d'un événement.", z.object({ calendarId: z.string().default("primary"), eventId: z.string() }),
      async ({ calendarId, eventId }) => googleFetch(u, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`)),
    create_event: W(
      "create_event",
      "Crée un événement.",
      z.object({
        calendarId: z.string().default("primary"),
        summary: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        startDateTime: z.string().describe("ISO 8601 avec timezone"),
        endDateTime: z.string().describe("ISO 8601 avec timezone"),
        attendees: z.array(z.string()).optional().describe("emails"),
         timeZone: z.string().optional(),
      }),
       async ({ calendarId, summary, description, location, startDateTime, endDateTime, attendees, timeZone }) => {
        const zone = preferences.timezone || timeZone || "Indian/Reunion";
        const start = localDateTime(startDateTime);
        const end = localDateTime(endDateTime);
        return googleFetch(u, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`, {
          method: "POST",
          body: JSON.stringify({
            summary, description, location,
            start: { dateTime: start, timeZone: zone },
            end: { dateTime: end, timeZone: zone },
            attendees: attendees?.map((email) => ({ email })),
          }),
        });
      },
    ),
    update_event: W(
      "update_event",
      "Met à jour un événement (champs partiels).",
      z.object({ calendarId: z.string().default("primary"), eventId: z.string(), patch: z.record(z.string(), z.any()) }),
      async ({ calendarId, eventId, patch }) =>
        googleFetch(u, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`, { method: "PATCH", body: JSON.stringify(patch) }),
    ),
    delete_event: W("delete_event", "Supprime un événement.", z.object({ calendarId: z.string().default("primary"), eventId: z.string() }),
      async ({ calendarId, eventId }) => googleFetch(u, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`, { method: "DELETE" })),
    search_events: W(
      "search_events",
      "Recherche d'événements par texte.",
      z.object({ q: z.string(), calendarId: z.string().default("primary"), maxResults: z.number().int().min(1).max(50).default(20) }),
      async ({ q, calendarId, maxResults }) => {
        const p = new URLSearchParams({ q, maxResults: String(maxResults), singleEvents: "true", orderBy: "startTime" });
        return googleFetch(u, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${p.toString()}`);
      },
    ),
    list_calendars: W("list_calendars", "Liste les calendriers de l'utilisateur.", z.object({}),
      async () => googleFetch(u, `${CAL}/users/me/calendarList`)),
    create_calendar: W("create_calendar", "Crée un calendrier.", z.object({ summary: z.string(), timeZone: z.string().default("Europe/Paris") }),
      async (a) => googleFetch(u, `${CAL}/calendars`, { method: "POST", body: JSON.stringify(a) })),
    get_availability: W(
      "get_availability",
      "Vérifie la disponibilité (freebusy).",
      z.object({ timeMin: z.string(), timeMax: z.string(), calendars: z.array(z.string()).default(["primary"]) }),
      async ({ timeMin, timeMax, calendars }) =>
        googleFetch(u, `${CAL}/freeBusy`, { method: "POST", body: JSON.stringify({ timeMin, timeMax, items: calendars.map((id) => ({ id })) }) }),
    ),

    // ============ DRIVE ============
    list_files: W(
      "list_files",
      "Liste les fichiers Drive (récents par défaut).",
      z.object({ q: z.string().optional(), pageSize: z.number().int().min(1).max(100).default(20) }),
      async ({ q, pageSize }) => {
        const p = new URLSearchParams({
          pageSize: String(pageSize),
          fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)",
          orderBy: "modifiedTime desc",
        });
        if (q) p.set("q", q);
        return googleFetch(u, `${DRIVE}/files?${p.toString()}`);
      },
    ),
    search_files: W("search_files", "Recherche de fichiers.", z.object({ name: z.string() }),
      async ({ name }) => googleFetch(u, `${DRIVE}/files?q=${encodeURIComponent(`name contains '${name.replace(/'/g, "\\'")}'`)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)`)),
    create_folder: W("create_folder", "Crée un dossier Drive.", z.object({ name: z.string(), parentId: z.string().optional() }),
      async ({ name, parentId }) =>
        googleFetch(u, `${DRIVE}/files`, { method: "POST", body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined }) })),
    delete_file: W("delete_file", "Supprime un fichier.", z.object({ fileId: z.string() }),
      async ({ fileId }) => googleFetch(u, `${DRIVE}/files/${fileId}`, { method: "DELETE" })),
    rename_file: W("rename_file", "Renomme un fichier.", z.object({ fileId: z.string(), name: z.string() }),
      async ({ fileId, name }) => googleFetch(u, `${DRIVE}/files/${fileId}`, { method: "PATCH", body: JSON.stringify({ name }) })),
    move_file: W("move_file", "Déplace un fichier (change de parent).", z.object({ fileId: z.string(), newParentId: z.string(), oldParentId: z.string().optional() }),
      async ({ fileId, newParentId, oldParentId }) => {
        const p = new URLSearchParams({ addParents: newParentId, fields: "id,parents" });
        if (oldParentId) p.set("removeParents", oldParentId);
        return googleFetch(u, `${DRIVE}/files/${fileId}?${p.toString()}`, { method: "PATCH", body: "{}" });
      }),
    copy_file: W("copy_file", "Duplique un fichier.", z.object({ fileId: z.string(), name: z.string().optional() }),
      async ({ fileId, name }) => googleFetch(u, `${DRIVE}/files/${fileId}/copy`, { method: "POST", body: JSON.stringify(name ? { name } : {}) })),
    share_file: W(
      "share_file",
      "Partage un fichier avec un email.",
      z.object({ fileId: z.string(), email: z.string(), role: z.enum(["reader", "commenter", "writer"]).default("reader") }),
      async ({ fileId, email, role }) =>
        googleFetch(u, `${DRIVE}/files/${fileId}/permissions?sendNotificationEmail=true`, { method: "POST", body: JSON.stringify({ type: "user", role, emailAddress: email }) }),
    ),

    // ============ DOCS ============
    create_doc: W("create_doc", "Crée un Google Doc vide.", z.object({ title: z.string() }),
      async ({ title }) => googleFetch(u, `${DOCS}/documents`, { method: "POST", body: JSON.stringify({ title }) })),
    read_doc: W("read_doc", "Lit le contenu d'un Google Doc.", z.object({ documentId: z.string() }),
      async ({ documentId }) => googleFetch(u, `${DOCS}/documents/${documentId}`)),
    append_to_doc: W(
      "append_to_doc",
      "Ajoute du texte à la fin d'un Google Doc.",
      z.object({ documentId: z.string(), text: z.string() }),
      async ({ documentId, text }) =>
        googleFetch(u, `${DOCS}/documents/${documentId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: {}, text: `\n${text}` } }] }),
        }),
    ),
    replace_text: W(
      "replace_text",
      "Remplace un texte dans un Doc.",
      z.object({ documentId: z.string(), find: z.string(), replace: z.string(), matchCase: z.boolean().default(false) }),
      async ({ documentId, find, replace, matchCase }) =>
        googleFetch(u, `${DOCS}/documents/${documentId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests: [{ replaceAllText: { containsText: { text: find, matchCase }, replaceText: replace } }] }),
        }),
    ),

    // ============ SHEETS ============
    create_sheet: W("create_sheet", "Crée un Google Sheet.", z.object({ title: z.string() }),
      async ({ title }) => googleFetch(u, `${SHEETS}/spreadsheets`, { method: "POST", body: JSON.stringify({ properties: { title } }) })),
    read_sheet: W("read_sheet", "Lit une plage d'un Google Sheet.", z.object({ spreadsheetId: z.string(), range: z.string().describe("A1, ex 'Feuille1!A1:D10'") }),
      async ({ spreadsheetId, range }) => googleFetch(u, `${SHEETS}/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`)),
    append_row: W(
      "append_row",
      "Ajoute une ligne en bas d'une feuille.",
      z.object({ spreadsheetId: z.string(), range: z.string(), values: z.array(z.union([z.string(), z.number()])) }),
      async ({ spreadsheetId, range, values }) =>
        googleFetch(u, `${SHEETS}/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
          method: "POST",
          body: JSON.stringify({ values: [values] }),
        }),
    ),
    write_range: W(
      "write_range",
      "Écrit dans une plage spécifique.",
      z.object({ spreadsheetId: z.string(), range: z.string(), values: z.array(z.array(z.union([z.string(), z.number()]))) }),
      async ({ spreadsheetId, range, values }) =>
        googleFetch(u, `${SHEETS}/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
          method: "PUT",
          body: JSON.stringify({ values }),
        }),
    ),

    // ============ TASKS ============
    list_task_lists: W("list_task_lists", "Liste les listes de tâches.", z.object({}),
      async () => googleFetch(u, `${TASKS}/users/@me/lists`)),
    list_tasks: W(
      "list_tasks",
      "Liste les tâches d'une liste.",
      z.object({ taskListId: z.string().default("@default"), showCompleted: z.boolean().default(false) }),
      async ({ taskListId, showCompleted }) =>
        googleFetch(u, `${TASKS}/lists/${taskListId}/tasks?showCompleted=${showCompleted}&maxResults=100`),
    ),
    create_task: W(
      "create_task",
      "Crée une tâche.",
      z.object({ taskListId: z.string().default("@default"), title: z.string(), notes: z.string().optional(), due: z.string().optional().describe("ISO 8601 date") }),
      async ({ taskListId, ...body }) => googleFetch(u, `${TASKS}/lists/${taskListId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    ),
    complete_task: W(
      "complete_task",
      "Marque une tâche comme terminée.",
      z.object({ taskListId: z.string().default("@default"), taskId: z.string() }),
      async ({ taskListId, taskId }) =>
        googleFetch(u, `${TASKS}/lists/${taskListId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }),
    ),
    delete_task: W("delete_task", "Supprime une tâche.", z.object({ taskListId: z.string().default("@default"), taskId: z.string() }),
      async ({ taskListId, taskId }) => googleFetch(u, `${TASKS}/lists/${taskListId}/tasks/${taskId}`, { method: "DELETE" })),
    create_task_list: W("create_task_list", "Crée une liste de tâches.", z.object({ title: z.string() }),
      async ({ title }) => googleFetch(u, `${TASKS}/users/@me/lists`, { method: "POST", body: JSON.stringify({ title }) })),

    // ============ CONTACTS (People API) ============
    list_contacts: W(
      "list_contacts",
      "Liste les contacts.",
      z.object({ pageSize: z.number().int().min(1).max(100).default(30) }),
      async ({ pageSize }) =>
        googleFetch(u, `${PEOPLE}/people/me/connections?pageSize=${pageSize}&personFields=names,emailAddresses,phoneNumbers`),
    ),
    search_contacts: W(
      "search_contacts",
      "Recherche des contacts par nom ou email.",
      z.object({ query: z.string() }),
      async ({ query }) =>
        googleFetch(u, `${PEOPLE}/people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,emailAddresses,phoneNumbers`),
    ),
    create_contact: W(
      "create_contact",
      "Crée un contact.",
      z.object({ givenName: z.string(), familyName: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }),
      async ({ givenName, familyName, email, phone }) =>
        googleFetch(u, `${PEOPLE}/people:createContact`, {
          method: "POST",
          body: JSON.stringify({
            names: [{ givenName, familyName }],
            emailAddresses: email ? [{ value: email }] : undefined,
            phoneNumbers: phone ? [{ value: phone }] : undefined,
          }),
        }),
    ),
    delete_contact: W("delete_contact", "Supprime un contact par resource name.", z.object({ resourceName: z.string() }),
      async ({ resourceName }) => googleFetch(u, `${PEOPLE}/${resourceName}:deleteContact`, { method: "DELETE" })),
    get_contact: W("get_contact", "Détails complets d'un contact.", z.object({ resourceName: z.string() }),
      async ({ resourceName }) => googleFetch(u, `${PEOPLE}/${resourceName}?personFields=names,emailAddresses,phoneNumbers,addresses,organizations,birthdays,biographies,photos,urls`)),

    // ============ FORMS ============
    list_forms: W("list_forms", "Liste les Google Forms de l'utilisateur (via Drive).", z.object({ pageSize: z.number().int().min(1).max(100).default(30) }),
      async ({ pageSize }) => googleFetch(u, `${DRIVE}/files?pageSize=${pageSize}&q=${encodeURIComponent("mimeType='application/vnd.google-apps.form' and trashed=false")}&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc`)),
    get_form: W("get_form", "Lit un Google Form.", z.object({ formId: z.string() }),
      async ({ formId }) => googleFetch(u, `${FORMS}/forms/${formId}`)),
    create_form: W("create_form", "Crée un Google Form.", z.object({ title: z.string(), documentTitle: z.string().optional() }),
      async ({ title, documentTitle }) => googleFetch(u, `${FORMS}/forms`, { method: "POST", body: JSON.stringify({ info: { title, documentTitle: documentTitle ?? title } }) })),
    update_form: W("update_form", "Met à jour les infos d'un Form (title/description).", z.object({ formId: z.string(), title: z.string().optional(), description: z.string().optional() }),
      async ({ formId, title, description }) => googleFetch(u, `${FORMS}/forms/${formId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ updateFormInfo: { info: { title, description }, updateMask: [title && "title", description && "description"].filter(Boolean).join(",") } }] }) })),
    delete_form: W("delete_form", "Supprime un Form (via Drive).", z.object({ formId: z.string() }),
      async ({ formId }) => googleFetch(u, `${DRIVE}/files/${formId}`, { method: "DELETE" })),
    add_question: W(
      "add_question",
      "Ajoute une question à un Form.",
      z.object({
        formId: z.string(),
        title: z.string(),
        type: z.enum(["TEXT", "PARAGRAPH", "RADIO", "CHECKBOX", "DROP_DOWN", "SCALE", "DATE", "TIME"]).default("TEXT"),
        options: z.array(z.string()).optional(),
        required: z.boolean().default(false),
        index: z.number().int().min(0).default(0),
      }),
      async ({ formId, title, type, options, required, index }) => {
        let question: any = { required };
        if (type === "TEXT" || type === "PARAGRAPH") question.textQuestion = { paragraph: type === "PARAGRAPH" };
        else if (type === "RADIO" || type === "CHECKBOX" || type === "DROP_DOWN")
          question.choiceQuestion = { type, options: (options ?? []).map((v) => ({ value: v })) };
        else if (type === "SCALE") question.scaleQuestion = { low: 1, high: 5 };
        else if (type === "DATE") question.dateQuestion = {};
        else if (type === "TIME") question.timeQuestion = {};
        return googleFetch(u, `${FORMS}/forms/${formId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests: [{ createItem: { item: { title, questionItem: { question } }, location: { index } } }] }),
        });
      },
    ),
    delete_question: W("delete_question", "Supprime une question d'un Form par index.", z.object({ formId: z.string(), index: z.number().int().min(0) }),
      async ({ formId, index }) => googleFetch(u, `${FORMS}/forms/${formId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ deleteItem: { location: { index } } }] }) })),
    list_form_responses: W("list_form_responses", "Liste les réponses d'un Form.", z.object({ formId: z.string() }),
      async ({ formId }) => googleFetch(u, `${FORMS}/forms/${formId}/responses`)),
    get_form_response: W("get_form_response", "Détails d'une réponse.", z.object({ formId: z.string(), responseId: z.string() }),
      async ({ formId, responseId }) => googleFetch(u, `${FORMS}/forms/${formId}/responses/${responseId}`)),
    share_form: W("share_form", "Partage un Form avec un email.", z.object({ formId: z.string(), email: z.string(), role: z.enum(["reader", "writer"]).default("reader") }),
      async ({ formId, email, role }) => googleFetch(u, `${DRIVE}/files/${formId}/permissions?sendNotificationEmail=true`, { method: "POST", body: JSON.stringify({ type: "user", role, emailAddress: email }) })),

    // ============ SLIDES ============
    list_presentations: W("list_presentations", "Liste les Google Slides.", z.object({ pageSize: z.number().int().min(1).max(100).default(30) }),
      async ({ pageSize }) => googleFetch(u, `${DRIVE}/files?pageSize=${pageSize}&q=${encodeURIComponent("mimeType='application/vnd.google-apps.presentation' and trashed=false")}&fields=files(id,name,modifiedTime,webViewLink,thumbnailLink)&orderBy=modifiedTime desc`)),
    get_presentation: W("get_presentation", "Lit une présentation.", z.object({ presentationId: z.string() }),
      async ({ presentationId }) => googleFetch(u, `${SLIDES}/presentations/${presentationId}`)),
    create_presentation: W("create_presentation", "Crée une présentation vide.", z.object({ title: z.string() }),
      async ({ title }) => googleFetch(u, `${SLIDES}/presentations`, { method: "POST", body: JSON.stringify({ title }) })),
    delete_presentation: W("delete_presentation", "Supprime une présentation (via Drive).", z.object({ presentationId: z.string() }),
      async ({ presentationId }) => googleFetch(u, `${DRIVE}/files/${presentationId}`, { method: "DELETE" })),
    add_slide: W("add_slide", "Ajoute une diapositive.", z.object({ presentationId: z.string(), layout: z.enum(["BLANK", "TITLE", "TITLE_AND_BODY", "TITLE_AND_TWO_COLUMNS", "SECTION_HEADER"]).default("TITLE_AND_BODY") }),
      async ({ presentationId, layout }) => googleFetch(u, `${SLIDES}/presentations/${presentationId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ createSlide: { slideLayoutReference: { predefinedLayout: layout } } }] }) })),
    delete_slide: W("delete_slide", "Supprime une diapositive.", z.object({ presentationId: z.string(), slideObjectId: z.string() }),
      async ({ presentationId, slideObjectId }) => googleFetch(u, `${SLIDES}/presentations/${presentationId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ deleteObject: { objectId: slideObjectId } }] }) })),
    insert_text: W(
      "insert_text",
      "Insère du texte dans une diapositive (crée une zone de texte).",
      z.object({ presentationId: z.string(), slideObjectId: z.string(), text: z.string(), x: z.number().default(50), y: z.number().default(50), width: z.number().default(400), height: z.number().default(100) }),
      async ({ presentationId, slideObjectId, text, x, y, width, height }) => {
        const objectId = `txt_${Date.now()}`;
        return googleFetch(u, `${SLIDES}/presentations/${presentationId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [
              { createShape: { objectId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: slideObjectId, size: { width: { magnitude: width, unit: "PT" }, height: { magnitude: height, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" } } } },
              { insertText: { objectId, text } },
            ],
          }),
        });
      },
    ),
    replace_slide_text: W("replace_slide_text", "Remplace du texte dans toute la présentation.", z.object({ presentationId: z.string(), find: z.string(), replace: z.string() }),
      async ({ presentationId, find, replace }) => googleFetch(u, `${SLIDES}/presentations/${presentationId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ replaceAllText: { containsText: { text: find, matchCase: false }, replaceText: replace } }] }) })),
    duplicate_slide: W("duplicate_slide", "Duplique une diapositive.", z.object({ presentationId: z.string(), slideObjectId: z.string() }),
      async ({ presentationId, slideObjectId }) => googleFetch(u, `${SLIDES}/presentations/${presentationId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ duplicateObject: { objectId: slideObjectId } }] }) })),
    share_presentation: W("share_presentation", "Partage une présentation.", z.object({ presentationId: z.string(), email: z.string(), role: z.enum(["reader", "commenter", "writer"]).default("reader") }),
      async ({ presentationId, email, role }) => googleFetch(u, `${DRIVE}/files/${presentationId}/permissions?sendNotificationEmail=true`, { method: "POST", body: JSON.stringify({ type: "user", role, emailAddress: email }) })),

    // ============ BLOGGER ============
    list_blogs: W("list_blogs", "Liste les blogs Blogger de l'utilisateur.", z.object({}),
      async () => googleFetch(u, `${BLOGGER}/users/self/blogs`)),
    get_blog: W("get_blog", "Détails d'un blog.", z.object({ blogId: z.string() }),
      async ({ blogId }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}`)),
    list_posts: W("list_posts", "Liste les posts d'un blog.", z.object({ blogId: z.string(), status: z.enum(["live", "draft", "scheduled"]).default("live"), maxResults: z.number().int().min(1).max(50).default(20) }),
      async ({ blogId, status, maxResults }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts?status=${status.toUpperCase()}&maxResults=${maxResults}`)),
    get_post: W("get_post", "Lit un post.", z.object({ blogId: z.string(), postId: z.string() }),
      async ({ blogId, postId }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/${postId}`)),
    create_post: W("create_post", "Crée un post (brouillon par défaut).", z.object({ blogId: z.string(), title: z.string(), content: z.string(), labels: z.array(z.string()).optional(), publish: z.boolean().default(false) }),
      async ({ blogId, title, content, labels, publish }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts?isDraft=${!publish}`, { method: "POST", body: JSON.stringify({ title, content, labels }) })),
    update_post: W("update_post", "Met à jour un post.", z.object({ blogId: z.string(), postId: z.string(), title: z.string().optional(), content: z.string().optional(), labels: z.array(z.string()).optional() }),
      async ({ blogId, postId, ...patch }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/${postId}`, { method: "PATCH", body: JSON.stringify(patch) })),
    delete_post: W("delete_post", "Supprime un post.", z.object({ blogId: z.string(), postId: z.string() }),
      async ({ blogId, postId }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/${postId}`, { method: "DELETE" })),
    publish_post: W("publish_post", "Publie un post.", z.object({ blogId: z.string(), postId: z.string(), publishDate: z.string().optional() }),
      async ({ blogId, postId, publishDate }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/${postId}/publish${publishDate ? `?publishDate=${encodeURIComponent(publishDate)}` : ""}`, { method: "POST" })),
    unpublish_post: W("unpublish_post", "Repasse un post en brouillon.", z.object({ blogId: z.string(), postId: z.string() }),
      async ({ blogId, postId }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/${postId}/revert`, { method: "POST" })),
    search_posts: W("search_posts", "Recherche dans les posts d'un blog.", z.object({ blogId: z.string(), q: z.string() }),
      async ({ blogId, q }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/search?q=${encodeURIComponent(q)}`)),
    list_comments: W("list_comments", "Liste les commentaires d'un post.", z.object({ blogId: z.string(), postId: z.string() }),
      async ({ blogId, postId }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/${postId}/comments`)),
    delete_comment: W("delete_comment", "Supprime un commentaire.", z.object({ blogId: z.string(), postId: z.string(), commentId: z.string() }),
      async ({ blogId, postId, commentId }) => googleFetch(u, `${BLOGGER}/blogs/${blogId}/posts/${postId}/comments/${commentId}`, { method: "DELETE" })),
  };
}
