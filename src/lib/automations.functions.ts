import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Centralised list of Lovable AI models exposed to the UI.
export const AI_MODELS = [
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview (dernier, recommandé)", tier: "default" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (rapide, économique)", tier: "cheap" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (équilibré)", tier: "balanced" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (raisonnement)", tier: "smart" },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano (rapide)", tier: "cheap" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini (équilibré)", tier: "balanced" },
  { id: "openai/gpt-5", label: "GPT-5 (raisonnement)", tier: "smart" },
] as const;

const ServiceEnum = z.enum(["gmail", "calendar", "tasks", "drive", "docs", "sheets", "forms"]);

const AgentSchema = z.object({
  name: z.string(),
  role: z.string(),
  instructions: z.string(),
  services: z.array(ServiceEnum).default([]),
  order: z.number().default(0),
});
const TriggerSchema = z.object({
  type: z.enum(["cron", "new_email", "new_event", "new_task"]),
  cron_expr: z.string().nullable().optional(),
  config: z.record(z.string(), z.any()).default({}),
});
const PlanSchema = z.object({
  name: z.string(),
  summary: z.string(),
  timezone: z.string().default("Indian/Reunion"),
  agents: z.array(AgentSchema).min(1),
  triggers: z.array(TriggerSchema).min(1),
});
export type AutomationPlan = z.infer<typeof PlanSchema>;

const SYSTEM_PROMPT = `Tu es un architecte d'automatisations expert pour Gmail, Google Agenda, Google Tasks, Google Drive, Docs, Sheets et Forms.
À partir d'une demande en français, tu conçois un plan EXÉCUTABLE en UN SEUL appel.

PRINCIPES FONDAMENTAUX:
1) Les automatisations sont PILOTÉES PAR CRON, pas par "déclencheurs". Chaque automatisation polle périodiquement les services Google et détecte les nouveautés depuis le dernier cycle (idempotence par mémoire d'état).
2) Si l'utilisateur précise un intervalle (ex: "toutes les 5 minutes"), respecte-le EXACTEMENT (cron 5 champs). Sinon choisis un cron raisonnable selon le besoin: emails → */5, agenda → */15, fichiers → */30, rapports quotidiens → '0 8 * * *'.
3) Comprends finement l'intention: extrais les VERBES (lister, créer, envoyer, archiver, classer, résumer), les OBJETS (emails, événements, tâches, fichiers, lignes), les FILTRES (non lus, aujourd'hui, expéditeur X, dossier Y), et la DESTINATION (créer tâche, envoyer mail, ajouter ligne Sheet, créer doc).
4) Anti-doublon obligatoire: chaque agent qui CRÉE doit utiliser state_get/state_remember avec une clé stable (ex: 'evt:gmail:<msgId>', 'evt:cal:<eventId>').
5) Crée 1 à 3 agents seulement (orchestrateur + 1-2 exécuteurs spécialisés) — minimiser la complexité.

RÉPONSE: UNIQUEMENT un objet JSON strict (sans markdown, sans préambule):
{
  "name": "nom court et clair",
  "summary": "1 phrase",
  "timezone": "Indian/Reunion",
  "agents": [
    { "name": "...", "role": "rôle bref", "instructions": "Instructions détaillées et actionnables (étapes numérotées, outils à appeler, règles anti-doublon).", "services": ["gmail"|"calendar"|"tasks"|"drive"|"docs"|"sheets"|"forms"], "order": 0 }
  ],
  "triggers": [
    { "type": "cron", "cron_expr": "*/5 * * * *", "config": {} }
  ]
}`;

const AnalyzeCreate = z.object({ description: z.string().min(5), model: z.string().optional() });

export const analyzeAndCreate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AnalyzeCreate.parse(i))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const model = data.model || "google/gemini-3-flash-preview";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: data.description },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`AI Gateway ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new Error("Réponse IA invalide"); }
    const plan = PlanSchema.parse(parsed);

    // Single-call also creates the automation immediately (no second AI call needed).
    const { supabase, userId } = context;
    const { data: automation, error } = await supabase
      .from("automations")
      .insert({
        user_id: userId,
        name: plan.name,
        description: plan.summary,
        prompt: data.description,
        status: "draft",
        timezone: plan.timezone,
        model,
      })
      .select("id").single();
    if (error || !automation) throw new Error(error?.message ?? "Création échouée");

    const agentsRows = plan.agents.map((a, i) => ({
      automation_id: automation.id,
      name: a.name, role: a.role, instructions: a.instructions,
      services: a.services, order: a.order ?? i,
    }));
    if (agentsRows.length) {
      const { error: ae } = await supabase.from("agents").insert(agentsRows);
      if (ae) throw new Error(ae.message);
    }

    const { computeNextRun } = await import("@/lib/cron");
    const triggersRows = plan.triggers.map((t) => {
      // Force CRON-driven automations: convert legacy types to cron.
      const cron = t.cron_expr ?? "*/5 * * * *";
      return {
        automation_id: automation.id,
        type: "cron" as const,
        cron_expr: cron,
        config: t.config ?? {},
        next_run_at: computeNextRun(cron).toISOString(),
        enabled: true,
      };
    });
    if (triggersRows.length) {
      const { error: te } = await supabase.from("triggers").insert(triggersRows);
      if (te) throw new Error(te.message);
    }

    return { id: automation.id, plan };
  });

// Legacy two-step still available for compatibility (kept as a thin wrapper).
const AnalyzeInput = z.object({ description: z.string().min(5) });
export const analyzePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AnalyzeInput.parse(i))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY!;
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: data.description }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`AI Gateway ${res.status}`);
    const json = await res.json();
    return PlanSchema.parse(JSON.parse(json?.choices?.[0]?.message?.content ?? "{}"));
  });

const CreateInput = z.object({ description: z.string(), plan: PlanSchema });
export const createAutomationFromPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: automation, error } = await supabase
      .from("automations").insert({
        user_id: userId, name: data.plan.name, description: data.plan.summary,
        prompt: data.description, status: "draft", timezone: data.plan.timezone,
      }).select("id").single();
    if (error || !automation) throw new Error(error?.message ?? "Création échouée");
    const agentsRows = data.plan.agents.map((a, i) => ({
      automation_id: automation.id, name: a.name, role: a.role, instructions: a.instructions,
      services: a.services, order: a.order ?? i,
    }));
    if (agentsRows.length) await supabase.from("agents").insert(agentsRows);
    const { computeNextRun } = await import("@/lib/cron");
    const triggersRows = data.plan.triggers.map((t) => {
      const cron = t.cron_expr ?? "*/5 * * * *";
      return { automation_id: automation.id, type: "cron" as const, cron_expr: cron, config: t.config ?? {},
        next_run_at: computeNextRun(cron).toISOString(), enabled: true };
    });
    if (triggersRows.length) await supabase.from("triggers").insert(triggersRows);
    return { id: automation.id };
  });

const ToggleInput = z.object({ id: z.string(), status: z.enum(["draft", "active", "paused"]) });
export const setAutomationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ToggleInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("automations").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    // When activating: fire on next tick + reset failure counter.
    if (data.status === "active") {
      await context.supabase.from("triggers")
        .update({ enabled: true, next_run_at: new Date().toISOString(), consecutive_failures: 0, last_error: null })
        .eq("automation_id", data.id);
    }
    return { ok: true };
  });

const RunInput = z.object({ id: z.string() });
export const runAutomationNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RunInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: auto } = await context.supabase.from("automations").select("id").eq("id", data.id).maybeSingle();
    if (!auto) throw new Error("Automatisation introuvable");
    const { executeAutomation } = await import("@/lib/run-agent.server");
    return await executeAutomation(auto.id, context.userId, null);
  });

const DeleteInput = z.object({ id: z.string() });
export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("automations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const TriggerUpdate = z.object({ id: z.string(), cron_expr: z.string().optional(), enabled: z.boolean().optional() });
export const updateTrigger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TriggerUpdate.parse(i))
  .handler(async ({ data, context }) => {
    const patch: { cron_expr?: string; next_run_at?: string; enabled?: boolean } = {};
    if (data.cron_expr !== undefined) {
      const { computeNextRun } = await import("@/lib/cron");
      patch.cron_expr = data.cron_expr;
      patch.next_run_at = computeNextRun(data.cron_expr).toISOString();
    }
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    const { error } = await context.supabase.from("triggers").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateAutoInput = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  timezone: z.string().optional(),
  model: z.string().optional(),
});
export const updateAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateAutoInput.parse(i))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("automations").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateAgentInput = z.object({
  id: z.string(),
  name: z.string().optional(),
  role: z.string().optional(),
  instructions: z.string().optional(),
  services: z.array(ServiceEnum).optional(),
  model: z.string().optional(),
});
export const updateAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateAgentInput.parse(i))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("agents").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ResetState = z.object({ id: z.string() });
export const resetAutomationState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ResetState.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("automations").update({ state: {} }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- AI Optimizer ----------
const OptimizeInput = z.object({ id: z.string() });
export const optimizeAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => OptimizeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: auto } = await supabase.from("automations").select("*").eq("id", data.id).maybeSingle();
    if (!auto) throw new Error("Automatisation introuvable");
    const { data: agents } = await supabase.from("agents").select("*").eq("automation_id", data.id).order("order");
    const { data: triggers } = await supabase.from("triggers").select("*").eq("automation_id", data.id);
    const { data: recent } = await supabase.from("executions").select("status, error, started_at, finished_at").eq("automation_id", data.id).order("started_at", { ascending: false }).limit(20);

    const key = process.env.LOVABLE_API_KEY!;
    const sys = `Tu es un auditeur d'automatisations. Analyse l'automatisation fournie et propose des AMÉLIORATIONS CONCRÈTES.
Renvoie UNIQUEMENT un JSON: {
  "score": 0-100,
  "strengths": ["..."],
  "issues": ["..."],
  "recommendations": [{ "title": "...", "detail": "...", "impact": "low"|"medium"|"high" }],
  "suggested_cron": "expression cron suggérée ou null",
  "suggested_instructions": { "<agentName>": "instructions améliorées..." }
}`;
    const payload = { automation: { name: auto.name, prompt: auto.prompt, timezone: auto.timezone }, agents, triggers, recent };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(payload) }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const json = await res.json();
    return JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
  });

const ApplyOptimization = z.object({
  id: z.string(),
  suggested_cron: z.string().nullable().optional(),
  suggested_instructions: z.record(z.string(), z.string()).optional(),
});
export const applyOptimization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApplyOptimization.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.suggested_cron) {
      const { computeNextRun } = await import("@/lib/cron");
      await supabase.from("triggers").update({
        cron_expr: data.suggested_cron,
        next_run_at: computeNextRun(data.suggested_cron).toISOString(),
      }).eq("automation_id", data.id);
    }
    if (data.suggested_instructions) {
      const { data: agents } = await supabase.from("agents").select("id, name").eq("automation_id", data.id);
      for (const a of agents ?? []) {
        const instr = data.suggested_instructions[a.name];
        if (instr) await supabase.from("agents").update({ instructions: instr }).eq("id", a.id);
      }
    }
    return { ok: true };
  });

// ---------- DB cleanup / cache ----------
export const cleanupDatabase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // delete old finished executions (>30d) for current user
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: autos } = await supabase.from("automations").select("id").eq("user_id", userId);
    const ids = (autos ?? []).map((a) => a.id);
    if (!ids.length) return { deleted: 0 };
    const { count } = await supabase
      .from("executions").delete({ count: "exact" })
      .in("automation_id", ids)
      .lt("started_at", cutoff)
      .in("status", ["success", "error"]);
    // Reset idempotency state for all user automations
    await supabase.from("automations").update({ state: {} }).eq("user_id", userId);
    return { deleted: count ?? 0 };
  });

// ---------- Reset account (full purge, keep auth + google connection) ----------
export const resetAccountData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: autos } = await supabase.from("automations").select("id").eq("user_id", userId);
    const ids = (autos ?? []).map((a) => a.id);
    if (ids.length) {
      await supabase.from("executions").delete().in("automation_id", ids);
      await supabase.from("triggers").delete().in("automation_id", ids);
      await supabase.from("agents").delete().in("automation_id", ids);
    }
    await supabase.from("automations").delete().eq("user_id", userId);
    await supabase.from("debug_sessions").delete().eq("user_id", userId);
    return { ok: true, purged: ids.length };
  });

// ---------- BYOK: user's own AI keys ----------
const KeysInput = z.object({
  openai_key: z.string().nullable().optional(),
  gemini_key: z.string().nullable().optional(),
  preferred_provider: z.enum(["lovable", "openai", "gemini"]).optional(),
});
export const saveUserAiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => KeysInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("user_ai_keys").upsert({
      user_id: context.userId,
      openai_key: data.openai_key ?? null,
      gemini_key: data.gemini_key ?? null,
      preferred_provider: data.preferred_provider ?? "lovable",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getUserAiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_ai_keys")
      .select("openai_key, gemini_key, preferred_provider")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      preferred_provider: (data?.preferred_provider ?? "lovable") as "lovable" | "openai" | "gemini",
      has_openai: !!data?.openai_key,
      has_gemini: !!data?.gemini_key,
    };
  });

// ---------- Costs summary ----------
export const getCostsSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: rows } = await supabase
      .from("execution_costs")
      .select("automation_id, model, cost_usd, input_tokens, output_tokens, provider, created_at")
      .eq("user_id", userId)
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(500);
    const { data: autos } = await supabase.from("automations").select("id, name").eq("user_id", userId);
    return { rows: rows ?? [], autos: autos ?? [] };
  });

