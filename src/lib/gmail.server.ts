// Backward-compat wrapper — re-exports from the unified Google helper.
// Old code referenced gmailFetch / getValidAccessToken / GMAIL_SCOPES; keep them working.
export {
  GOOGLE_SCOPES as GMAIL_SCOPES,
  buildGoogleAuthUrl as buildAuthUrl,
  exchangeGoogleCode as exchangeCodeForTokens,
  refreshGoogleToken as refreshAccessToken,
  getGoogleAccessToken as getValidAccessToken,
  getGoogleOAuthConfig,
  encodeRawEmail,
} from "./google.server";

import { googleFetch, b64Decode } from "./google.server";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export async function gmailFetch(userId: string, path: string, init: RequestInit = {}) {
  return googleFetch(userId, `${GMAIL_API}${path}`, init);
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.email ?? null;
}

export function extractMessageFields(msg: any) {
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  function findBody(part: any): string {
    if (!part) return "";
    if (part.mimeType === "text/plain" && part.body?.data) return b64Decode(part.body.data);
    if (part.parts) for (const p of part.parts) { const b = findBody(p); if (b) return b; }
    if (part.body?.data) return b64Decode(part.body.data);
    return "";
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet,
    from: headers['from'],
    to: headers['to'],
    subject: headers['subject'],
    date: headers['date'],
    body: findBody(msg.payload).slice(0, 8000),
    labelIds: msg.labelIds,
  };
}
