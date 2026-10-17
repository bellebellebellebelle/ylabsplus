// Server-only Google OAuth + REST helpers for Gmail / Calendar / Tasks / Drive / Docs / Sheets / Forms.

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
].join(" ");

export function buildGoogleAuthUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number; scope?: string };
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as { email?: string; name?: string };
}

export async function getValidAccessTokenForUser(userId: string): Promise<{ token: string; email: string | null } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await supabaseAdmin
    .from("google_connections")
    .select("access_token, refresh_token, expires_at, google_email")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) return null;
  const expires = new Date(conn.expires_at).getTime();
  if (expires - Date.now() > 60_000) {
    return { token: conn.access_token, email: conn.google_email };
  }
  const fresh = await refreshAccessToken(conn.refresh_token);
  const newExpires = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
  await supabaseAdmin
    .from("google_connections")
    .update({ access_token: fresh.access_token, expires_at: newExpires })
    .eq("user_id", userId);
  return { token: fresh.access_token, email: conn.google_email };
}

async function gapi(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

// ---------------- Gmail ----------------
export const gmail = {
  list: (token: string, q?: string, max = 10) =>
    gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  read: (token: string, id: string) =>
    gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`),
  send: async (token: string, to: string, subject: string, body: string) => {
    const raw = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
    const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
      method: "POST", body: JSON.stringify({ raw: encoded }),
    });
  },
  modify: (token: string, id: string, addLabels: string[] = [], removeLabels: string[] = []) =>
    gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST", body: JSON.stringify({ addLabelIds: addLabels, removeLabelIds: removeLabels }),
    }),
  trash: (token: string, id: string) =>
    gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, { method: "POST" }),
  draft: (token: string, to: string, subject: string, body: string) => {
    const raw = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
    const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/drafts`, {
      method: "POST", body: JSON.stringify({ message: { raw: encoded } }),
    });
  },
  thread: (token: string, id: string) =>
    gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}`),
  // Récupère une pièce jointe (base64url). Renvoie { data, size }.
  getAttachment: (token: string, messageId: string, attachmentId: string) =>
    gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`) as Promise<{ data: string; size: number }>,
  // Liste les pièces jointes d'un message (metadata) — parcourt les parts.
  listAttachments: async (token: string, messageId: string) => {
    const msg = await gapi(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`) as {
      payload?: { parts?: Array<{ filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: unknown[] }> };
    };
    const out: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = [];
    const walk = (parts: unknown[] | undefined) => {
      for (const p of (parts ?? []) as Array<{ filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: unknown[] }>) {
        if (p.filename && p.body?.attachmentId) {
          out.push({ filename: p.filename, mimeType: p.mimeType ?? "application/octet-stream", attachmentId: p.body.attachmentId, size: p.body.size ?? 0 });
        }
        if (p.parts) walk(p.parts);
      }
    };
    walk(msg.payload?.parts);
    return { attachments: out };
  },
};

// ---------------- Calendar ----------------
export const calendar = {
  listEvents: (token: string, calendarId = "primary", max = 10) =>
    gapi(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=${max}&orderBy=startTime&singleEvents=true&timeMin=${encodeURIComponent(new Date().toISOString())}`),
  getEvent: (token: string, calendarId: string, eventId: string) =>
    gapi(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`),
  createEvent: (token: string, calendarId: string, event: Record<string, unknown>) =>
    gapi(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST", body: JSON.stringify(event),
    }),
  updateEvent: (token: string, calendarId: string, eventId: string, patch: Record<string, unknown>) =>
    gapi(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
      method: "PATCH", body: JSON.stringify(patch),
    }),
  deleteEvent: (token: string, calendarId: string, eventId: string) =>
    gapi(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { method: "DELETE" }),
  listCalendars: (token: string) =>
    gapi(token, `https://www.googleapis.com/calendar/v3/users/me/calendarList`),
};

// ---------------- Tasks ----------------
export const tasks = {
  listLists: (token: string) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/users/@me/lists`),
  createList: (token: string, title: string) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/users/@me/lists`, {
      method: "POST", body: JSON.stringify({ title }),
    }),
  deleteList: (token: string, listId: string) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${listId}`, { method: "DELETE" }),
  renameList: (token: string, listId: string, title: string) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${listId}`, {
      method: "PATCH", body: JSON.stringify({ title }),
    }),
  listTasks: (token: string, listId: string) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`),
  create: (token: string, listId: string, task: { title: string; notes?: string; due?: string }) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
      method: "POST", body: JSON.stringify(task),
    }),
  update: (token: string, listId: string, taskId: string, patch: Record<string, unknown>) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
      method: "PATCH", body: JSON.stringify(patch),
    }),
  complete: (token: string, listId: string, taskId: string) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
      method: "PATCH", body: JSON.stringify({ status: "completed" }),
    }),
  remove: (token: string, listId: string, taskId: string) =>
    gapi(token, `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, { method: "DELETE" }),
};

// ---------------- Drive ----------------
export const drive = {
  list: (token: string, q?: string, max = 25) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files?pageSize=${max}&fields=files(id,name,mimeType,modifiedTime,size,parents,webViewLink)${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  get: (token: string, fileId: string) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,parents,webViewLink,owners`),
  createFolder: (token: string, name: string, parentId?: string) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files`, {
      method: "POST",
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined }),
    }),
  delete: (token: string, fileId: string) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE" }),
  rename: (token: string, fileId: string, name: string) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  move: async (token: string, fileId: string, newParent: string) => {
    const meta = await gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`) as { parents?: string[] };
    const prev = (meta.parents ?? []).join(",");
    return gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${newParent}&removeParents=${prev}`, { method: "PATCH", body: "{}" });
  },
  copy: (token: string, fileId: string, name?: string) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}/copy`, { method: "POST", body: JSON.stringify({ name }) }),
  share: (token: string, fileId: string, email: string, role: "reader" | "writer" | "commenter" = "reader") =>
    gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: "POST", body: JSON.stringify({ type: "user", role, emailAddress: email }),
    }),
  listPermissions: (token: string, fileId: string) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,emailAddress,role,type)`),
  listVersions: (token: string, fileId: string) =>
    gapi(token, `https://www.googleapis.com/drive/v3/files/${fileId}/revisions`),
  // Upload multipart depuis un contenu base64 (utile pour PJ Gmail → Drive).
  uploadBase64: async (token: string, name: string, mimeType: string, base64: string, parentId?: string) => {
    // base64 peut être base64url (venant de Gmail): normaliser en base64 standard puis en binaire.
    const std = base64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = std.length % 4 === 0 ? std : std + "=".repeat(4 - (std.length % 4));
    const bin = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
    const boundary = `nx${Date.now().toString(36)}`;
    const metadata = { name, mimeType, parents: parentId ? [parentId] : undefined };
    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`
    );
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.byteLength + bin.byteLength + tail.byteLength);
    body.set(head, 0); body.set(bin, head.byteLength); body.set(tail, head.byteLength + bin.byteLength);
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,parents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Drive upload ${res.status}: ${await res.text()}`);
    return await res.json() as { id: string; name: string; webViewLink?: string };
  },
};

// ---------------- Docs ----------------
export const docs = {
  read: (token: string, documentId: string) =>
    gapi(token, `https://docs.googleapis.com/v1/documents/${documentId}`),
  create: (token: string, title: string) =>
    gapi(token, `https://docs.googleapis.com/v1/documents`, { method: "POST", body: JSON.stringify({ title }) }),
  append: async (token: string, documentId: string, text: string) => {
    const doc = await gapi(token, `https://docs.googleapis.com/v1/documents/${documentId}`) as { body?: { content?: Array<{ endIndex?: number }> } };
    const last = doc.body?.content?.[doc.body.content.length - 1]?.endIndex ?? 1;
    return gapi(token, `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
      method: "POST", body: JSON.stringify({ requests: [{ insertText: { location: { index: Math.max(1, last - 1) }, text } }] }),
    });
  },
  replaceText: (token: string, documentId: string, find: string, replace: string) =>
    gapi(token, `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
      method: "POST", body: JSON.stringify({ requests: [{ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace } }] }),
    }),
  batchUpdate: (token: string, documentId: string, requests: unknown[]) =>
    gapi(token, `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
      method: "POST", body: JSON.stringify({ requests }),
    }),
};

// ---------------- Sheets ----------------
export const sheets = {
  read: (token: string, spreadsheetId: string, range: string) =>
    gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`),
  append: (token: string, spreadsheetId: string, range: string, values: unknown[][]) =>
    gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`, {
      method: "POST", body: JSON.stringify({ values }),
    }),
  write: (token: string, spreadsheetId: string, range: string, values: unknown[][]) =>
    gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
      method: "PUT", body: JSON.stringify({ values }),
    }),
  create: (token: string, title: string) =>
    gapi(token, `https://sheets.googleapis.com/v4/spreadsheets`, {
      method: "POST", body: JSON.stringify({ properties: { title } }),
    }),
  getMeta: (token: string, spreadsheetId: string) =>
    gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`),
  batchUpdate: (token: string, spreadsheetId: string, requests: unknown[]) =>
    gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST", body: JSON.stringify({ requests }),
    }),
};

// ---------------- Forms ----------------
export const forms = {
  get: (token: string, formId: string) =>
    gapi(token, `https://forms.googleapis.com/v1/forms/${formId}`),
  create: (token: string, title: string) =>
    gapi(token, `https://forms.googleapis.com/v1/forms`, { method: "POST", body: JSON.stringify({ info: { title } }) }),
  addQuestion: (token: string, formId: string, title: string, options?: string[]) => {
    const item: Record<string, unknown> = options?.length
      ? { title, questionItem: { question: { required: false, choiceQuestion: { type: "RADIO", options: options.map((o) => ({ value: o })) } } } }
      : { title, questionItem: { question: { required: false, textQuestion: { paragraph: false } } } };
    return gapi(token, `https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ createItem: { item, location: { index: 0 } } }] }),
    });
  },
  listResponses: (token: string, formId: string) =>
    gapi(token, `https://forms.googleapis.com/v1/forms/${formId}/responses`),
  updateInfo: (token: string, formId: string, title: string, description?: string) =>
    gapi(token, `https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ updateFormInfo: { info: { title, description }, updateMask: "title,description" } }] }),
    }),
};
