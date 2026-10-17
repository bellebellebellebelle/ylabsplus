// Unified streaming agent endpoint — used by both /chat (legacy) and /agent (cockpit).
// Selects the persistence tables via `surface` param.
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
          const { buildAllTools } = await import("@/lib/google-tools.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { createClient } = await import("@supabase/supabase-js");

          const auth = request.headers.get("authorization");
          if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
          const token = auth.slice(7);

          const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data: userData, error: userErr } = await sb.auth.getUser(token);
          if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
          const userId = userData.user.id;

          const body = (await request.json()) as {
            messages: UIMessage[];
            threadId?: string;
            surface?: "chat" | "agent";
          };
          const { messages, threadId } = body;
          const surface: "chat" | "agent" = body.surface === "agent" ? "agent" : "chat";
          if (!Array.isArray(messages)) return new Response("messages required", { status: 400 });

          const key = process.env.LOVABLE_API_KEY;
          if (!key) return new Response("AI gateway not configured", { status: 500 });

          const { data: gcreds } = await supabaseAdmin.from("gmail_credentials").select("user_id").eq("user_id", userId).maybeSingle();
          const hasGoogle = !!gcreds;
          const { data: settings } = await supabaseAdmin
            .from("user_settings")
            .select("timezone, ai_model, email_greeting, email_signature, email_tone")
            .eq("user_id", userId)
            .maybeSingle();
          const tz = settings?.timezone ?? "Indian/Reunion";
          const selectedModel = settings?.ai_model ?? "google/gemini-3-flash-preview";
          const taskId = crypto.randomUUID();
          const tools = hasGoogle ? buildAllTools(userId, "web", {
            timezone: tz,
            emailGreeting: settings?.email_greeting,
            emailSignature: settings?.email_signature,
            emailTone: settings?.email_tone,
            taskId,
          }) : undefined;

          const gateway = createLovableAiGatewayProvider(key);
          const system = `Tu es **OCKTAVUS**, agent IA autonome de l'utilisateur sur son Google Workspace (Gmail, Agenda, Drive, Docs, Sheets, Tâches, Contacts, Forms, Slides, Blogger). Tu réponds en français, de façon concise et efficace.

${hasGoogle
  ? `Tu as accès à tous les outils Google Workspace de l'utilisateur. EXÉCUTE les actions directement, en autonomie totale, sans demander de confirmation — chaque action est tracée dans le journal et l'utilisateur peut l'annuler après coup.

RÈGLES IMPORTANTES :
- Si l'utilisateur demande PLUSIEURS tâches dans un seul message, exécute-les TOUTES en parallèle quand c'est possible (lance plusieurs tool calls dans le même tour).
- Pour les noms (contacts, fichiers, événements), la requête peut venir d'une transcription vocale et contenir des erreurs d'orthographe. Ne te limite JAMAIS à une correspondance exacte : utilise les outils de recherche (search_contacts, search_files, list_emails avec q=…) avec des fragments / variantes phonétiques, puis choisis le résultat le plus probable.
- Fuseau horaire de l'utilisateur : **${tz}**. Utilise-le pour TOUS les rendez-vous Google Agenda (champ timeZone).
- Pour toute date relative (demain, après-demain, lundi prochain, semaine prochaine), pars exclusivement de la date/heure locale exacte indiquée ci-dessous. Pour create_event, transmets startDateTime/endDateTime au format local YYYY-MM-DDTHH:mm:ss, sans Z et sans offset UTC. Ne convertis jamais toi-même en UTC : l'outil impose ${tz}.
- Pour chaque e-mail, applique une salutation initiale et le ton **${settings?.email_tone ?? "professionnel"}**. Ne commence jamais directement par le contenu brut.
- Enchaîne plusieurs outils si nécessaire pour accomplir la tâche complète (par ex. chercher un contact → créer un événement → l'inviter).
- Une fois terminé, fais un récapitulatif clair de ce que tu as fait et inclus chaque verificationUrl retourné par les outils.`
  : `⚠️ L'utilisateur n'a PAS encore connecté son compte Google. Invite-le à aller dans **Paramètres → Connexion Google** pour autoriser l'accès Workspace.`}

Date/heure locale exacte : ${new Date().toLocaleString("fr-FR", { timeZone: tz, dateStyle: "full", timeStyle: "long" })} (${tz}).
Format : Markdown propre, listes claires.`;

          const tablesThreads = surface === "agent" ? "agent_conversations" : "chat_threads";
          const tablesMessages = surface === "agent" ? "agent_messages" : "chat_messages";
          const threadKey = surface === "agent" ? "conversation_id" : "thread_id";

          const result = streamText({
            model: gateway(selectedModel),
            system,
            messages: await convertToModelMessages(messages),
            tools,
            stopWhen: stepCountIs(50),
            providerOptions: selectedModel.startsWith("openai/gpt-5.6-") ? { lovable: { reasoningEffort: "none" } } : undefined,
          });

          return result.toUIMessageStreamResponse({
            originalMessages: messages,
            onFinish: async ({ messages: finalMessages }) => {
              if (!threadId) return;
              try {
                const newUserMsg = messages[messages.length - 1];
                const assistantNew = finalMessages.slice(messages.length);
                const rows = [
                  ...(newUserMsg ? [{ [threadKey]: threadId, user_id: userId, role: newUserMsg.role, parts: newUserMsg.parts as any }] : []),
                  ...assistantNew.map((m) => ({ [threadKey]: threadId, user_id: userId, role: m.role, parts: m.parts as any })),
                ];
                if (rows.length) {
                  await supabaseAdmin.from(tablesMessages as any).insert(rows as any);
                  await supabaseAdmin.from(tablesThreads as any).update({ updated_at: new Date().toISOString() }).eq("id", threadId);
                  if (newUserMsg?.role === "user") {
                    const { data: thr } = await supabaseAdmin.from(tablesThreads as any).select("title").eq("id", threadId).maybeSingle();
                    if ((thr as any)?.title === "Nouvelle conversation") {
                      const txt = (newUserMsg.parts as any[]).find((p) => p.type === "text")?.text ?? "";
                      const title = txt.slice(0, 60) || "Nouvelle conversation";
                      await supabaseAdmin.from(tablesThreads as any).update({ title }).eq("id", threadId);
                    }
                  }
                }
              } catch (e) {
                console.error("persist chat error", e);
              }
            },
          });
        } catch (e: any) {
          console.error("/api/chat error", e);
          return new Response(e?.message ?? "Internal error", { status: 500 });
        }
      },
    },
  },
});
