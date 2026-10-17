// One-shot agent server fn — used by the voice orb (and other single-prompt callers).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const askAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { prompt: string; source?: "web" | "voice" }) => d)
  .handler(async ({ data, context }) => {
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const { buildAllTools } = await import("@/lib/google-tools.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateText, stepCountIs } = await import("ai");

    const key = process.env['LOVABLE_API_KEY']!;
    const gateway = createLovableAiGatewayProvider(key);

    const { data: gcreds } = await supabaseAdmin
      .from("gmail_credentials")
      .select("user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: settings } = await supabaseAdmin
      .from("user_settings")
      .select("timezone, ai_model, email_greeting, email_signature, email_tone")
      .eq("user_id", context.userId)
      .maybeSingle();
    const timezone = settings?.timezone ?? "Indian/Reunion";
    const model = settings?.ai_model ?? "google/gemini-3-flash-preview";
    const tools = gcreds ? buildAllTools(context.userId, data.source ?? "web", {
      timezone,
      ...(settings?.email_greeting ? { emailGreeting: settings.email_greeting } : {}),
      ...(settings?.email_signature ? { emailSignature: settings.email_signature } : {}),
      ...(settings?.email_tone ? { emailTone: settings.email_tone } : {}),
      taskId: crypto.randomUUID(),
    }) : undefined;

    const result = await generateText({
      model: gateway(model),
      system: `Tu es OCKTAVUS, agent IA autonome Google Workspace. Exécute la demande en utilisant les outils. Fuseau obligatoire: ${timezone}. Date/heure locale actuelle exacte: ${new Date().toLocaleString("fr-FR", { timeZone: timezone, dateStyle: "full", timeStyle: "long" })}. Pour Agenda, résous demain/semaine prochaine en date locale et fournis YYYY-MM-DDTHH:mm:ss sans Z ni décalage; l'outil applique le fuseau. Pour les e-mails, respecte un ton ${settings?.email_tone ?? "professionnel"}. Termine par un résumé très court et tout lien verificationUrl retourné par les outils. Français.`,
      prompt: data.prompt,
      ...(tools ? { tools } : {}),
      stopWhen: stepCountIs(50),
      providerOptions: model.startsWith("openai/gpt-5.6-") ? { lovable: { reasoningEffort: "none" } } : undefined,
    });

    return { summary: result.text || "Action exécutée." };
  });
