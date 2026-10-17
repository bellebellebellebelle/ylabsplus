// Unified Google Workspace OAuth + API helpers — server-only
// Backed by the existing gmail_credentials table (now stores all Workspace scopes).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Gmail
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.labels",
  // Calendar
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  // Drive
  "https://www.googleapis.com/auth/drive",
  // Docs
  "https://www.googleapis.com/auth/documents",
  // Sheets
  "https://www.googleapis.com/auth/spreadsheets",
  // Tasks
  "https://www.googleapis.com/auth/tasks",
  // Contacts (People API)
  "https://www.googleapis.com/auth/contacts",
  // Forms
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  // Slides
  "https://www.googleapis.com/auth/presentations",
  // Blogger
  "https://www.googleapis.com/auth/blogger",
  // Google Chat media sent to the agent
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.messages.create",
];

export function getGoogleOAuthConfig(origin: string) {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET manquant");
  return { clientId, clientSecret, redirectUri: `${origin}/api/public/google/callback` };
}

export function buildGoogleAuthUrl(origin: string, state: string) {
  const cfg = getGoogleOAuthConfig(origin);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(origin: string, code: string) {
  const cfg = getGoogleOAuthConfig(origin);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  }>;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ email?: string; name?: string; picture?: string }>;
}

export async function refreshGoogleToken(refreshToken: string) {
  const clientId = process.env['GOOGLE_CLIENT_ID']!;
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number; scope: string }>;
}

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("gmail_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("Google Workspace non connecté");
  const expiresAt = new Date(data.expires_at).getTime();
  if (expiresAt > Date.now() + 30_000) return data.access_token;
  const refreshed = await refreshGoogleToken(data.refresh_token);
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabaseAdmin
    .from("gmail_credentials")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return refreshed.access_token;
}

export async function googleFetch(
  userId: string,
  url: string,
  init: RequestInit = {},
): Promise<any> {
  const token = await getGoogleAccessToken(userId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google API ${res.status} ${url}: ${txt.slice(0, 500)}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

// Base64url helpers (Edge-safe)
export function b64urlEncode(input: string): string {
  // Use Buffer if available; fallback to btoa
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return btoa(unescape(encodeURIComponent(input))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64Decode(input: string): string {
  const norm = input.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof Buffer !== "undefined") return Buffer.from(norm, "base64").toString("utf-8");
  return decodeURIComponent(escape(atob(norm)));
}

export function encodeRawEmail(opts: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: boolean;
}) {
  const lines = [
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : null,
    opts.bcc ? `Bcc: ${opts.bcc}` : null,
    `Subject: ${opts.subject}`,
    `Content-Type: text/${opts.html ? "html" : "plain"}; charset="UTF-8"`,
    "MIME-Version: 1.0",
    "",
    opts.body,
  ]
    .filter(Boolean)
    .join("\r\n");
  return b64urlEncode(lines);
}

// ---- Signed OAuth state (prevents attaching a Google account to someone else's user) ----
async function hmacKey() {
  const secret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET manquant");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function toB64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export async function signOAuthState(payload: { uid: string; ret: string }) {
  const body = toB64url(new TextEncoder().encode(JSON.stringify({ ...payload, t: Date.now() })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body)));
  return `${body}.${toB64url(sig)}`;
}
export async function verifyOAuthState(state: string): Promise<{ uid: string; ret: string }> {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("state invalide");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(sig), new TextEncoder().encode(body));
  if (!ok) throw new Error("state invalide");
  const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { uid: string; ret: string; t: number };
  if (Date.now() - data.t > 15 * 60_000) throw new Error("state expiré");
  return data;
}
