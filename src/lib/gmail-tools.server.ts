import { tool } from "ai";
import { z } from "zod";
import { gmailFetch, encodeRawEmail, extractMessageFields } from "./gmail.server";

export function buildGmailTools(userId: string) {
  return {
    list_emails: tool({
      description: "Liste les emails Gmail. Utilise la syntaxe Gmail (is:unread, from:..., subject:..., after:YYYY/MM/DD).",
      inputSchema: z.object({
        query: z.string().describe("Requête Gmail, ex 'is:unread', 'from:alice@x.com'").optional(),
        maxResults: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ query, maxResults }) => {
        const params = new URLSearchParams({ maxResults: String(maxResults ?? 10) });
        if (query) params.set("q", query);
        const data = await gmailFetch(userId, `/users/me/messages?${params.toString()}`);
        const ids = (data.messages ?? []).slice(0, maxResults ?? 10);
        const detailed = await Promise.all(
          ids.map((m: any) =>
            gmailFetch(userId, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`).then(extractMessageFields).catch(() => null),
          ),
        );
        return { emails: detailed.filter(Boolean) };
      },
    }),
    read_email: tool({
      description: "Lit le contenu complet d'un email Gmail par son ID.",
      inputSchema: z.object({ messageId: z.string() }),
      execute: async ({ messageId }) => {
        const data = await gmailFetch(userId, `/users/me/messages/${messageId}?format=full`);
        return extractMessageFields(data);
      },
    }),
    list_threads: tool({
      description: "Liste les threads (conversations) Gmail.",
      inputSchema: z.object({
        query: z.string().optional(),
        maxResults: z.number().int().min(1).max(30).default(10),
      }),
      execute: async ({ query, maxResults }) => {
        const params = new URLSearchParams({ maxResults: String(maxResults ?? 10) });
        if (query) params.set("q", query);
        const data = await gmailFetch(userId, `/users/me/threads?${params.toString()}`);
        return { threads: (data.threads ?? []).map((t: any) => ({ id: t.id, snippet: t.snippet, historyId: t.historyId })) };
      },
    }),
    read_thread: tool({
      description: "Lit tous les messages d'un thread Gmail.",
      inputSchema: z.object({ threadId: z.string() }),
      execute: async ({ threadId }) => {
        const data = await gmailFetch(userId, `/users/me/threads/${threadId}?format=full`);
        return { id: data.id, messages: (data.messages ?? []).map(extractMessageFields) };
      },
    }),
    list_labels: tool({
      description: "Liste les labels Gmail.",
      inputSchema: z.object({}),
      execute: async () => {
        const data = await gmailFetch(userId, "/users/me/labels");
        return { labels: (data.labels ?? []).map((l: any) => ({ id: l.id, name: l.name, type: l.type })) };
      },
    }),
    send_email: tool({
      description: "Envoie un email depuis le compte Gmail de l'utilisateur. Confirme l'envoi avant si la situation le demande.",
      inputSchema: z.object({
        to: z.string().describe("Destinataire(s), séparés par des virgules"),
        cc: z.string().optional(),
        subject: z.string(),
        body: z.string(),
      }),
      execute: async ({ to, cc, subject, body }) => {
        const raw = encodeRawEmail({ to, ...(cc ? { cc } : {}), subject, body });
        const data = await gmailFetch(userId, "/users/me/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return { id: data.id, threadId: data.threadId, status: "sent" };
      },
    }),
    reply_email: tool({
      description: "Répond à un email existant (garde le thread Gmail).",
      inputSchema: z.object({
        messageId: z.string().describe("ID du message auquel répondre"),
        body: z.string(),
      }),
      execute: async ({ messageId, body }) => {
        const original = await gmailFetch(userId, `/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`);
        const headers: Record<string, string> = {};
        for (const h of original.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
        const subject = headers['subject']?.startsWith("Re:") ? headers['subject'] : `Re: ${headers['subject'] ?? ""}`;
        const raw = encodeRawEmail({ to: headers['from'] ?? "", subject, body });
        const data = await gmailFetch(userId, "/users/me/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw, threadId: original.threadId }),
        });
        return { id: data.id, threadId: data.threadId, status: "sent" };
      },
    }),
    create_draft: tool({
      description: "Crée un brouillon Gmail (n'envoie pas).",
      inputSchema: z.object({
        to: z.string(),
        cc: z.string().optional(),
        subject: z.string(),
        body: z.string(),
      }),
      execute: async ({ to, cc, subject, body }) => {
        const raw = encodeRawEmail({ to, ...(cc ? { cc } : {}), subject, body });
        const data = await gmailFetch(userId, "/users/me/drafts", {
          method: "POST",
          body: JSON.stringify({ message: { raw } }),
        });
        return { draftId: data.id, status: "draft_created" };
      },
    }),
    list_drafts: tool({
      description: "Liste les brouillons Gmail.",
      inputSchema: z.object({ maxResults: z.number().int().min(1).max(30).default(10) }),
      execute: async ({ maxResults }) => {
        const data = await gmailFetch(userId, `/users/me/drafts?maxResults=${maxResults ?? 10}`);
        return { drafts: data.drafts ?? [] };
      },
    }),
    send_draft: tool({
      description: "Envoie un brouillon Gmail existant.",
      inputSchema: z.object({ draftId: z.string() }),
      execute: async ({ draftId }) => {
        const data = await gmailFetch(userId, "/users/me/drafts/send", {
          method: "POST",
          body: JSON.stringify({ id: draftId }),
        });
        return { id: data.id, status: "sent" };
      },
    }),
  };
}
