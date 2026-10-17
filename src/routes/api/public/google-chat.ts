import { createFileRoute } from "@tanstack/react-router";

// Google Chat webhook — supports /link CODE binding + autonomous agent execution
// with rolling memory, voice attachment transcription, and parallel tool calls.
export const Route = createFileRoute("/api/public/google-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const message: string = body.message?.text ?? body.message?.argumentText ?? "";
          const spaceId: string = body.space?.name ?? body.message?.space?.name ?? "";
          const senderName: string = body.user?.displayName ?? "";
          const attachments: any[] = body.message?.attachment ?? body.message?.attachments ?? [];

          if (!spaceId) return Response.json({ text: "Espace introuvable." });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // /link CODE
          const linkMatch = message.trim().match(/^\/?link\s+(\d{4,8})$/i);
          if (linkMatch) {
            const code = linkMatch[1];
            const { data: codeRow } = await supabaseAdmin
              .from("chat_link_codes")
              .select("user_id, expires_at, consumed_at")
              .eq("code", code)
              .maybeSingle();
            if (!codeRow) return Response.json({ text: "Code invalide ou expiré." });
            if (codeRow.consumed_at) return Response.json({ text: "Code déjà utilisé." });
            if (new Date(codeRow.expires_at).getTime() < Date.now())
              return Response.json({ text: "Code expiré. Génère-en un nouveau dans l'app." });

            await supabaseAdmin.from("google_chat_links").upsert({
              space_id: spaceId,
              user_id: codeRow.user_id,
              display_name: senderName,
            });
            await supabaseAdmin.from("chat_link_codes").update({ consumed_at: new Date().toISOString() }).eq("code", code);
            return Response.json({ text: "✅ Espace lié. OCKTAVUS est prêt — envoie-moi des instructions (texte ou vocal) !" });
          }

          // Resolve linked user
          const { data: link } = await supabaseAdmin
            .from("google_chat_links")
            .select("user_id")
            .eq("space_id", spaceId)
            .maybeSingle();
          if (!link) {
            return Response.json({
              text: "Espace non lié. Va dans OCKTAVUS → Connexions → génère un code, puis tape `/link CODE`.",
            });
          }
          const userId = link.user_id as string;

          // Settings (timezone + memory size)
          const { data: settings } = await supabaseAdmin
            .from("user_settings")
            .select("timezone, chat_memory_size")
            .eq("user_id", userId)
            .maybeSingle();
          const { data: fullSettings } = await supabaseAdmin
            .from("user_settings")
            .select("timezone, chat_memory_size, ai_model, email_greeting, email_signature, email_tone")
            .eq("user_id", userId)
            .maybeSingle();
          const tz = fullSettings?.timezone ?? "Indian/Reunion";
          const memSize = Math.max(2, Math.min(100, (settings as any)?.chat_memory_size ?? 20));

          // === Voice attachment handling ===
          let transcribedText = "";
          if (attachments?.length) {
            const apiKey = process.env.LOVABLE_API_KEY;
            if (!apiKey) throw new Error("Lovable AI non configuré");
            const { transcribeGoogleChatAttachment } = await import("@/lib/google-chat.server");
            const failures: string[] = [];
            for (const att of attachments) {
              try {
                const transcript = await transcribeGoogleChatAttachment(userId, att, apiKey);
                transcribedText += `${transcribedText ? "\n" : ""}${transcript.text}`;
              } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                failures.push(reason);
                console.error("voice attachment processing failed", reason);
              }
            }
            if (!transcribedText && failures.length) {
              await supabaseAdmin.from("agent_actions_log").insert({ user_id: userId, tool_name: "transcribe_google_chat_audio", args: { attachmentCount: attachments.length }, result: { failures }, status: "error", source: "google-chat", stage: "failed", attempt: 3, error_detail: failures.join(" | ").slice(0, 2000) });
              return Response.json({ text: `❌ Je n’ai pas pu lire ce message vocal après plusieurs tentatives. Détail : ${failures[0]}` });
            }
          }

          const fullInput = [message?.trim(), transcribedText?.trim()].filter(Boolean).join("\n").trim();
          if (!fullInput) return Response.json({ text: "👋 Envoie-moi une instruction (texte ou vocal)." });

          const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
          const { buildAllTools } = await import("@/lib/google-tools.server");
          const { generateText, stepCountIs } = await import("ai");
          const { sendGoogleChatProgress } = await import("@/lib/google-chat.server");
          const objective = fullInput.length > 140 ? `${fullInput.slice(0, 137)}…` : fullInput;
          await sendGoogleChatProgress(userId, spaceId, `🎯 Objectif reçu : ${objective}\n⏳ État : exécution en cours…`);

          const { data: gcreds } = await supabaseAdmin
            .from("gmail_credentials")
            .select("user_id")
            .eq("user_id", userId)
            .maybeSingle();
          const taskId = crypto.randomUUID();
          const tools = gcreds ? buildAllTools(userId, "google-chat", {
            timezone: tz,
            emailGreeting: fullSettings?.email_greeting,
            emailSignature: fullSettings?.email_signature,
            emailTone: fullSettings?.email_tone,
            taskId,
          }) : undefined;

          // === Rolling memory ===
          const { data: history } = await supabaseAdmin
            .from("google_chat_messages")
            .select("role, content, created_at")
            .eq("space_id", spaceId)
            .order("created_at", { ascending: false })
            .limit(memSize);
          const memory = (history ?? []).reverse();

          const key = process.env.LOVABLE_API_KEY!;
          const gateway = createLovableAiGatewayProvider(key);
          const selectedModel = fullSettings?.ai_model ?? "google/gemini-3-flash-preview";
          const result = await generateText({
            model: gateway(selectedModel),
            system: `Tu es OCKTAVUS, agent IA autonome Google Workspace. Réponds en français, court et clair (Google Chat — markdown léger). ${
              gcreds
                ? `Exécute les actions directement avec les outils Workspace. Si l'utilisateur demande PLUSIEURS tâches dans le même message, lance-les en parallèle. Pour les noms issus d'une transcription, cherche avec fragments et variantes phonétiques. Fuseau obligatoire : ${tz}. Pour demain/semaine prochaine, calcule depuis l'heure locale ci-dessous et passe à create_event une date YYYY-MM-DDTHH:mm:ss sans Z ni offset. Pour les e-mails, utilise un ton ${fullSettings?.email_tone ?? "professionnel"} et commence par une salutation. Termine par « ✅ Résultat » avec un résumé, puis les verificationUrl retournés. En cas d'échec, explique brièvement le diagnostic et les tentatives, sans exposer de raisonnement interne privé.`
                : "Demande à l'utilisateur de connecter son compte Google dans l'app web (Paramètres → Connexion Google)."
            } Date/heure locale exacte: ${new Date().toLocaleString("fr-FR", { timeZone: tz, dateStyle: "full", timeStyle: "long" })} (${tz}).`,
            messages: [
              ...memory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
              { role: "user" as const, content: fullInput },
            ],
            tools,
            stopWhen: stepCountIs(50),
            providerOptions: selectedModel.startsWith("openai/gpt-5.6-") ? { lovable: { reasoningEffort: "none" } } : undefined,
          });

          const reply = result.text || "(action exécutée)";

          // Persist memory
          await supabaseAdmin.from("google_chat_messages").insert([
            { space_id: spaceId, user_id: userId, role: "user", content: fullInput },
            { space_id: spaceId, user_id: userId, role: "assistant", content: reply },
          ]);

          return Response.json({ text: reply });
        } catch (e: any) {
          console.error("google-chat webhook", e);
          return Response.json({ text: `Erreur: ${e?.message ?? "inconnue"}` });
        }
      },
    },
  },
});
