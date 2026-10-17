import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError, dynamicTool, jsonSchema, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./gateway-helpers.ts";
import { createLovableAiGatewayRunIdFetch } from "./run-id.ts";

type Msg = { role: "system" | "user" | "assistant"; content: string };
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
const planSchema = z.object({ plan: z.string(), tasks: z.array(z.object({ agent_id: z.string(), title: z.string(), brief: z.string() })) });
const teamSchema = z.object({ team_name: z.string(), members: z.array(z.object({ name: z.string(), role: z.string(), is_chief: z.boolean(), skills: z.string(), system_prompt: z.string() })) });

function key() {
  const value = process.env["LOVABLE_API_KEY"];
  if (!value) throw new Error("Lovable AI n'est pas configuré.");
  return value;
}

export async function chat(model: string, messages: Msg[], opts: { temperature?: number; maxTokens?: number } = {}) {
  const schema = messages.some(m => m.content.includes('"tasks":')) ? planSchema : messages.some(m => m.content.includes('"team_name":')) ? teamSchema : undefined;
  const provider = createLovableAiGatewayProvider(key(), undefined, { baseURL: "https://ai.gateway.lovable.dev/v1", structuredOutputs: Boolean(schema) });
  const result = streamText({
    model: provider(model), messages,
    maxRetries: 0,
    ...(schema ? { output: Output.object({ schema: schema as z.ZodType<unknown> }) } : {}),
    ...(model.startsWith("openai/") ? { providerOptions: { lovable: { ...(opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}), ...(model.includes("gpt-5.6") ? { reasoningEffort: "none" } : {}) } } } : { maxOutputTokens: opts.maxTokens, temperature: opts.temperature }),
  });
  if (schema) {
    try { return JSON.stringify(await result.output); }
    catch (error) {
      if (NoObjectGeneratedError.isInstance(error) && error.text) {
        const parsed = parseJson<unknown>(error.text);
        if (parsed) return JSON.stringify(parsed);
      }
      throw error;
    }
  }
  const text = (await result.text).trim();
  if (!text) throw new Error("L'IA n'a fourni aucun livrable.");
  return text;
}

export async function chatWithTools(model: string, messages: Msg[], definitions: ToolDef[], runTool: (name: string, args: Record<string, unknown>) => Promise<string>, opts: { maxTokens?: number; maxRounds?: number } = {}) {
  const apiKey = key();
  const run = createLovableAiGatewayRunIdFetch();
  const openai = createOpenAI({ apiKey, baseURL: "https://ai.gateway.lovable.dev/v1", headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }, fetch: run.fetch });
  const compatible = createLovableAiGatewayProvider(apiKey, undefined, { baseURL: "https://ai.gateway.lovable.dev/v1" });
  const actions: string[] = [];
  const tools = Object.fromEntries(definitions.map(def => [def.name, dynamicTool({
    description: def.description,
    // Odoo fields permit arbitrary native value types; best-effort schemas are intentional.
    inputSchema: jsonSchema(def.parameters),
    execute: async input => {
      const output = await runTool(def.name, input as Record<string, unknown>);
      actions.push(`${def.name}: ${output.slice(0, 200)}`);
      return output;
    },
  })]));
  const result = streamText({
    model: model.startsWith("openai/") ? openai.responses(model) : compatible(model),
    system: messages.filter(m => m.role === "system").map(m => m.content).join("\n"),
    messages: messages.filter(m => m.role !== "system") as ModelMessage[],
    tools, stopWhen: stepCountIs(50), maxOutputTokens: opts.maxTokens, maxRetries: 0,
    providerOptions: model.startsWith("openai/") ? { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } } : {},
  });
  const content = (await result.text).trim();
  if (!content) throw new Error("L'IA n'a fourni aucun livrable.");
  return { content, actions };
}

export function parseJson<T>(raw: string): T | null {
  try { return JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) as T; }
  catch { return null; }
}