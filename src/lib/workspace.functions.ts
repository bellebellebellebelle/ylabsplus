// Thin server fns for the cockpit UI to read Google Workspace data via the user's tokens.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function withGoogle<T>(fn: (userId: string) => Promise<T>, userId: string) {
  return fn(userId);
}

export const wsGmailList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query?: string; max?: number }) => d)
  .handler(async ({ data, context }) => {
    const { gmailFetch, extractMessageFields } = await import("./gmail.server");
    const params = new URLSearchParams({ maxResults: String(data.max ?? 20) });
    if (data.query) params.set("q", data.query);
    const list = await gmailFetch(context.userId, `/users/me/messages?${params.toString()}`);
    const ids = (list.messages ?? []).slice(0, data.max ?? 20);
    const detail = await Promise.all(
      ids.map((m: any) =>
        gmailFetch(context.userId, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
          .then(extractMessageFields)
          .catch(() => null),
      ),
    );
    return { emails: detail.filter(Boolean) };
  });

export const wsGmailRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { gmailFetch, extractMessageFields } = await import("./gmail.server");
    return extractMessageFields(await gmailFetch(context.userId, `/users/me/messages/${data.id}?format=full`));
  });

export const wsCalendarUpcoming = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { max?: number; timeMin?: string; timeMax?: string }) => d)
  .handler(async ({ data, context }) => {
    const { googleFetch } = await import("./google.server");
    const params = new URLSearchParams({
      timeMin: data.timeMin ?? new Date().toISOString(),
      maxResults: String(data.max ?? 20),
      singleEvents: "true",
      orderBy: "startTime",
    });
    if (data.timeMax) params.set("timeMax", data.timeMax);
    return googleFetch(context.userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`);
  });

export const wsDriveList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query?: string; max?: number }) => d)
  .handler(async ({ data, context }) => {
    const { googleFetch } = await import("./google.server");
    const p = new URLSearchParams({
      pageSize: String(data.max ?? 30),
      fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,owners(displayName))",
      orderBy: "modifiedTime desc",
    });
    if (data.query) p.set("q", `name contains '${data.query.replace(/'/g, "\\'")}'`);
    return googleFetch(context.userId, `https://www.googleapis.com/drive/v3/files?${p.toString()}`);
  });

export const wsTaskLists = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleFetch } = await import("./google.server");
    return googleFetch(context.userId, `https://tasks.googleapis.com/tasks/v1/users/@me/lists`);
  });

export const wsTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskListId?: string }) => d)
  .handler(async ({ data, context }) => {
    const { googleFetch } = await import("./google.server");
    return googleFetch(context.userId, `https://tasks.googleapis.com/tasks/v1/lists/${data.taskListId ?? "@default"}/tasks?showCompleted=false&maxResults=100`);
  });

export const wsContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query?: string }) => d)
  .handler(async ({ data, context }) => {
    const { googleFetch } = await import("./google.server");
    if (data.query) {
      return googleFetch(context.userId, `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(data.query)}&readMask=names,emailAddresses,phoneNumbers,photos`);
    }
    return googleFetch(context.userId, `https://people.googleapis.com/v1/people/me/connections?pageSize=100&personFields=names,emailAddresses,phoneNumbers,photos&sortOrder=FIRST_NAME_ASCENDING`);
  });

export const wsDocsList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleFetch } = await import("./google.server");
    const p = new URLSearchParams({
      pageSize: "30",
      q: "mimeType='application/vnd.google-apps.document' and trashed=false",
      fields: "files(id,name,modifiedTime,webViewLink)",
      orderBy: "modifiedTime desc",
    });
    return googleFetch(context.userId, `https://www.googleapis.com/drive/v3/files?${p.toString()}`);
  });

export const wsSheetsList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleFetch } = await import("./google.server");
    const p = new URLSearchParams({
      pageSize: "30",
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: "files(id,name,modifiedTime,webViewLink)",
      orderBy: "modifiedTime desc",
    });
    return googleFetch(context.userId, `https://www.googleapis.com/drive/v3/files?${p.toString()}`);
  });

export const wsFormsList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleFetch } = await import("./google.server");
    const p = new URLSearchParams({
      pageSize: "30",
      q: "mimeType='application/vnd.google-apps.form' and trashed=false",
      fields: "files(id,name,modifiedTime,webViewLink)",
      orderBy: "modifiedTime desc",
    });
    return googleFetch(context.userId, `https://www.googleapis.com/drive/v3/files?${p.toString()}`);
  });

export const wsSlidesList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleFetch } = await import("./google.server");
    const p = new URLSearchParams({
      pageSize: "30",
      q: "mimeType='application/vnd.google-apps.presentation' and trashed=false",
      fields: "files(id,name,modifiedTime,webViewLink,thumbnailLink)",
      orderBy: "modifiedTime desc",
    });
    return googleFetch(context.userId, `https://www.googleapis.com/drive/v3/files?${p.toString()}`);
  });

export const wsBlogsList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleFetch } = await import("./google.server");
    return googleFetch(context.userId, `https://www.googleapis.com/blogger/v3/users/self/blogs`).catch(() => ({ items: [] }));
  });

export const wsContactDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { resourceName: string }) => d)
  .handler(async ({ data, context }) => {
    const { googleFetch } = await import("./google.server");
    return googleFetch(
      context.userId,
      `https://people.googleapis.com/v1/${data.resourceName}?personFields=names,emailAddresses,phoneNumbers,addresses,organizations,birthdays,biographies,photos,urls,nicknames,events`,
    );
  });
