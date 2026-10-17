import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PlanInput = z.object({ teamId: z.string().uuid(), objective: z.string().min(3) });
const RunInput = z.object({ taskId: z.string().uuid() });
const SuggestInput = z.object({
  department: z.string().min(2),
  focus: z.string().default(""),
});
const DraftInput = z.object({
  department: z.string().min(2),
  role: z.string().min(2),
  name: z.string().default(""),
});

/** Le chef d'équipe découpe l'ordre de mission et l'attribue à ses agents. */
export const planMission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PlanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { chat, parseJson } = await import("./ai-gateway.server");
    const { supabase, userId } = context;

    const { data: team } = await supabase
      .from("st_teams")
      .select("*")
      .eq("user_id", userId).eq("id", data.teamId)
      .maybeSingle();
    if (!team) throw new Error("Équipe introuvable.");

    const { data: agents } = await supabase
      .from("st_agents")
      .select("id, name, role, is_chief, skills, department")
      .eq("user_id", userId).eq("team_id", data.teamId);

    const members = agents ?? [];
    if (members.length === 0) throw new Error("Ajoutez au moins un agent à cette équipe.");
    const chief = members.find((a) => a.is_chief) ?? members[0];
    if (!chief) throw new Error("Équipe vide.");
    const workers = members.filter((a) => a.id !== chief.id);
    const assignable = workers.length > 0 ? workers : [chief];

    const roster = assignable
      .map((a) => `- id=${a.id} | ${a.name} | rôle: ${a.role || "polyvalent"} | ${a.skills}`)
      .join("\n");

    const raw = await chat(
      "openai/gpt-5.6-terra",
      [
        {
          role: "system",
          content: `Tu es ${chief.name}, chef de l'équipe "${team.name}" du département ${team.department} d'une entreprise. Tu reçois un ordre de mission de la direction et tu le découpes en tâches concrètes, actionnables et non redondantes, chacune attribuée au membre le plus pertinent. Réponds UNIQUEMENT en JSON.`,
        },
        {
          role: "user",
          content: `Mission: ${data.objective}
Contexte permanent de l'équipe: ${team.mission || "aucun"}
Membres attribuables:
${roster}

Retourne ce JSON exact:
{"plan":"1 phrase de stratégie","tasks":[{"agent_id":"uuid d'un membre","title":"titre court","brief":"consigne détaillée et autonome (contexte, attendu, format de livrable)"}]}
Entre 2 et ${Math.max(2, Math.min(6, assignable.length * 2))} tâches. Uniquement des agent_id de la liste.`,
        },
      ],
      { maxTokens: 2000 },
    );

    type PlannedTask = { agent_id?: string; title?: string; brief?: string };
    const parsed = parseJson<{ plan?: string; tasks?: PlannedTask[]; st_tasks?: PlannedTask[] }>(raw);
    const validIds = new Set(assignable.map((a) => a.id));
    const tasks = (parsed?.tasks ?? parsed?.st_tasks ?? [])
      .filter((t) => t.title && validIds.has(t.agent_id ?? ""))
      .slice(0, 8);
    if (tasks.length === 0) throw new Error("Le chef n'a pas réussi à structurer la mission.");

    const { data: mission, error: mErr } = await supabase
      .from("st_missions")
      .insert({
        user_id: userId,
        team_id: data.teamId,
        objective: data.objective,
        status: "dispatched",
        summary: parsed?.plan ?? "",
      })
      .select()
      .single();
    if (mErr) throw new Error(mErr.message);

    const { error: tErr } = await supabase.from("st_tasks").insert(
      tasks.map((t) => ({
        user_id: userId,
        team_id: data.teamId,
        mission_id: mission.id,
        agent_id: t.agent_id ?? "",
        title: (t.title ?? "").slice(0, 160),
        brief: t.brief ?? "",
        status: "todo",
      })),
    );
    if (tErr) throw new Error(tErr.message);

    return { missionId: mission.id, plan: parsed?.plan ?? "", count: tasks.length };
  });

/** Un agent exécute réellement sa tâche avec sa configuration propre. */
export const runTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { chat } = await import("./ai-gateway.server");
    const { supabase, userId } = context;

    const { data: task } = await supabase
      .from("st_tasks")
      .select("*")
      .eq("user_id", userId).eq("id", data.taskId)
      .maybeSingle();
    if (!task) throw new Error("Tâche introuvable.");

    const { data: agent } = await supabase
      .from("st_agents")
      .select("*")
      .eq("user_id", userId).eq("team_id", task.team_id).eq("id", task.agent_id ?? "")
      .maybeSingle();
    if (!agent) throw new Error("Aucun agent n'est assigné à cette tâche.");

    await supabase.from("st_tasks").update({ status: "running" }).eq("id", task.id);
    await supabase.from("st_agents").update({ status: "working" }).eq("id", agent.id);

    // Contexte Odoo réel + boîte à outils d'écriture si la base est connectée.
    let odooContext = "";
    let odooTools: import("./odoo.server").OdooTool[] = [];
    let odooCreds: import("./odoo.server").OdooCreds | null = null;
    let odooUid = 0;
    try {
      const { data: conn } = await supabase
        .from("odoo_connections")
        .select("url, database:db, username, api_key, uid, status")
        .eq("user_id", userId)
        .maybeSingle();
      if (conn?.url && conn.database) {
        const { data: dm } = await supabase
          .from("st_department_modules")
          .select("modules")
          .eq("department", agent.department)
          .maybeSingle();
        const modules = dm?.modules ?? [];
        if (modules.length > 0) {
          const { buildOdooContext, buildOdooTools, odooAuthenticate } = await import("./odoo.server");
          odooCreds = { url: conn.url, database: conn.database, username: conn.username, apiKey: conn.api_key };
          odooUid = conn.uid ?? await odooAuthenticate(odooCreds);
          odooContext = await buildOdooContext(odooCreds, odooUid, modules);
          odooTools = buildOdooTools(modules);
        }
      }
    } catch {
      // Odoo indisponible : l'agent travaille sans contexte externe.
    }

    try {
      const systemPrompt = `Tu es ${agent.name}, ${agent.role || "agent"} du département ${agent.department}.
Expertises: ${agent.skills || "généraliste"}.
Ton: ${agent.tone || "professionnel, direct"}.
Instructions du dirigeant: ${agent.system_prompt || "Livre un travail exploitable immédiatement."}
Tu produis un livrable finalisé, structuré en markdown, sans demander de précisions. Pas de bavardage.${odooContext ? "\nTu disposes de données réelles de l'ERP Odoo de l'entreprise (ci-dessous). Appuie-toi dessus, cite les chiffres exacts." : ""}${odooTools.length > 0 ? `
Tu peux AGIR directement dans Odoo grâce à tes outils (créer, modifier, supprimer, et actions métier comme confirmer un devis, valider ou envoyer une facture). Quand la tâche demande une action dans Odoo, EXÉCUTE-LA réellement avec tes outils, en totale autonomie, puis résume dans ton livrable ce que tu as réellement fait (ids créés, actions exécutées). Pour retrouver l'id d'un client ou d'un enregistrement, utilise odoo_search.` : ""}`;

      const userContent = `Tâche: ${task.title}\n\nConsigne: ${task.brief}${odooContext ? `\n\nDonnées Odoo en temps réel:\n${odooContext}` : ""}`;

      let result: string;
      let actions: string[] = [];

      if (odooTools.length > 0 && odooCreds) {
        const { chatWithTools } = await import("./ai-gateway.server");
        const { runOdooTool, odooSearch } = await import("./odoo.server");
        const creds = odooCreds;
        const uid = odooUid;

        const tools = [
          {
            name: "odoo_search",
            description: "Rechercher un enregistrement Odoo par nom (client, produit, projet...) pour obtenir son id numérique.",
            parameters: {
              type: "object",
              properties: {
                model: { type: "string", description: "modèle Odoo, ex. res.partner, product.product, project.project" },
                query: { type: "string", description: "nom recherché" },
              },
              required: ["model", "query"],
            },
          },
          ...odooTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
        ];

        const out = await chatWithTools(
          agent.model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          tools,
          async (name, args) => {
            if (name === "odoo_search") {
              const rows = await odooSearch(creds, uid, String(args["model"] ?? ""), String(args["query"] ?? ""));
              return JSON.stringify(rows).slice(0, 800);
            }
            const tool = odooTools.find((t) => t.name === name);
            if (!tool) return "ERREUR: outil inconnu.";
            return runOdooTool(creds, uid, tool, args);
          },
          { maxTokens: 3000 },
        );
        result = out.content;
        actions = out.actions;
      } else {
        result = await chat(
          agent.model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          { temperature: Number(agent.temperature) || 0.6, maxTokens: 3000 },
        );
      }

      if (actions.length > 0) {
        result = `**Actions réellement exécutées dans Odoo :**\n${actions.map((a) => `- ${a}`).join("\n")}\n\n---\n\n${result}`;
      }

      await supabase
        .from("st_tasks")
        .update({ status: "done", result })
        .eq("id", task.id);
      await supabase.from("st_agents").update({ status: "done" }).eq("id", agent.id);
      return { result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Échec de l'exécution.";
      await supabase.from("st_tasks").update({ status: "error", result: message }).eq("id", task.id);
      await supabase.from("st_agents").update({ status: "error" }).eq("id", agent.id);
      throw new Error(message);
    }
  });

/** Propose une composition d'équipe complète pour un département. */
export const suggestTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SuggestInput.parse(input))
  .handler(async ({ data }) => {
    const { chat, parseJson } = await import("./ai-gateway.server");
    const raw = await chat(
      "openai/gpt-5.6-terra",
      [
        {
          role: "system",
          content:
            "Tu conçois des équipes d'agents IA qui remplacent une extension d'un département d'entreprise. Réponds UNIQUEMENT en JSON.",
        },
        {
          role: "user",
          content: `Département: ${data.department}. Priorité: ${data.focus || "efficacité générale"}.
Retourne:
{"team_name":"nom court","members":[{"name":"prénom + nom","role":"rôle","is_chief":true|false,"skills":"3 à 5 expertises séparées par des virgules","system_prompt":"instructions de travail précises (3 phrases max)"}]}
Exactement 1 chef et 3 à 4 agents.`,
        },
      ],
      { maxTokens: 1600 },
    );
    const parsed = parseJson<{
      team_name?: string;
      members?: {
        name?: string;
        role?: string;
        is_chief?: boolean;
        skills?: string;
        system_prompt?: string;
      }[];
    }>(raw);
    if (!parsed?.members?.length) throw new Error("Suggestion indisponible, réessayez.");
    return {
      teamName: parsed.team_name ?? `Équipe ${data.department}`,
      members: parsed.members.slice(0, 5).map((m, i) => ({
        name: m.name ?? `Agent ${i + 1}`,
        role: m.role ?? "Agent",
        is_chief: i === 0,
        skills: m.skills ?? "",
        system_prompt: m.system_prompt ?? "",
      })),
    };
  });

/** Génère les instructions détaillées d'un agent (bouton "affiner par IA"). */
export const draftAgentPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DraftInput.parse(input))
  .handler(async ({ data }) => {
    const { chat } = await import("./ai-gateway.server");
    const text = await chat(
      "openai/gpt-5.6-luna",
      [
        {
          role: "system",
          content:
            "Tu rédiges le prompt système d'un agent IA employé d'entreprise. Style: impératif, opérationnel, 4 à 6 lignes, sans titre ni markdown.",
        },
        {
          role: "user",
          content: `Département: ${data.department}. Rôle: ${data.role}. Nom: ${data.name || "agent"}. Rédige ses instructions de travail, ses méthodes et son format de livrable attendu.`,
        },
      ],
      { maxTokens: 700 },
    );
    return { prompt: text };
  });
