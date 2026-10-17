import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const StartInput = z.object({ automationId: z.string(), issue: z.string().min(5) });

const SYSTEM_PROMPT = `Tu es HELPY, un agent de déboggage autonome ultra performant pour les automatisations Gmail / Calendar / Tasks.
Méthode:
1. Comprendre le problème décrit.
2. Analyser le flux complet (agents, déclencheurs, exécutions récentes, logs, état mémoire).
3. Identifier les causes racine probables.
4. Construire un plan de correction structuré (étapes, outils utilisés, vérifications).
5. Proposer la solution la plus probable avec instructions précises.
6. Si l'utilisateur indique un échec, ajuster la stratégie, mémoriser les tentatives, ne JAMAIS répéter une approche déjà tentée.
Mémorise toutes les tentatives. Reste logique, factuel, en français. Réponds en markdown court et actionnable.`;

async function callAI(messages: Array<{ role: string; content: string }>) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY manquant");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json?.choices?.[0]?.message?.content as string) ?? "";
}

async function gatherContext(supabase: ReturnType<typeof Object>, automationId: string) {
  const sb = supabase as { from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => { order?: (o: string, opts?: { ascending?: boolean }) => unknown; maybeSingle?: () => unknown; limit?: (n: number) => unknown } } } };
  const [a, ag, tr, ex] = await Promise.all([
    (sb.from("automations").select("*").eq("id", automationId) as { maybeSingle: () => Promise<{ data: unknown }> }).maybeSingle(),
    (sb.from("agents").select("*").eq("automation_id", automationId) as { order: (s: string) => Promise<{ data: unknown }> }).order("order"),
    (sb.from("triggers").select("*").eq("automation_id", automationId) as Promise<{ data: unknown }>),
    (sb.from("executions").select("id,status,started_at,finished_at,error,output").eq("automation_id", automationId) as { order: (s: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown }> } }).order("started_at", { ascending: false }).limit(5),
  ]);
  return { automation: a.data, agents: ag.data, triggers: tr.data, executions: ex.data };
}

export const startDebugSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // End any open session for this automation.
    await supabase.from("debug_sessions")
      .update({ status: "closed", ended_at: new Date().toISOString() })
      .eq("user_id", userId).eq("automation_id", data.automationId).eq("status", "open");

    const { data: session, error } = await supabase.from("debug_sessions").insert({
      user_id: userId, automation_id: data.automationId, issue: data.issue, status: "open",
    }).select("id").single();
    if (error || !session) throw new Error(error?.message ?? "Création session échouée");

    await supabase.from("debug_messages").insert({ session_id: session.id, role: "user", content: data.issue });

    const ctx = await gatherContext(supabase, data.automationId);
    const reply = await callAI([
      { role: "user", content: `Contexte automatisation:\n${JSON.stringify(ctx, null, 2).slice(0, 8000)}\n\nProblème: ${data.issue}\n\nAnalyse en profondeur et propose un plan de correction.` },
    ]);
    await supabase.from("debug_messages").insert({ session_id: session.id, role: "assistant", content: reply });
    await supabase.from("debug_sessions").update({ summary: reply.slice(0, 500) }).eq("id", session.id);
    return { sessionId: session.id };
  });

const ChatInput = z.object({ sessionId: z.string(), message: z.string().min(1) });
export const sendDebugMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ChatInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: session } = await supabase.from("debug_sessions").select("automation_id,issue").eq("id", data.sessionId).maybeSingle();
    if (!session) throw new Error("Session introuvable");
    await supabase.from("debug_messages").insert({ session_id: data.sessionId, role: "user", content: data.message });

    const { data: history } = await supabase.from("debug_messages").select("role,content").eq("session_id", data.sessionId).order("created_at", { ascending: true });
    const ctx = await gatherContext(supabase, session.automation_id);
    const messages = [
      { role: "user", content: `Contexte:\n${JSON.stringify(ctx, null, 2).slice(0, 6000)}\n\nProblème initial: ${session.issue}` },
      ...(history ?? []).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
    ];
    const reply = await callAI(messages);
    await supabase.from("debug_messages").insert({ session_id: data.sessionId, role: "assistant", content: reply });
    return { reply };
  });

const EndInput = z.object({ sessionId: z.string() });
export const endDebugSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EndInput.parse(i))
  .handler(async ({ data, context }) => {
    await context.supabase.from("debug_sessions").update({ status: "closed", ended_at: new Date().toISOString() }).eq("id", data.sessionId);
    return { ok: true };
  });
