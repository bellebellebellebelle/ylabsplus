import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createLovableAiGatewayProvider(lovableApiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}

// BYOK providers: reroute to native endpoints when the user provides their own key.
export function createOpenAiProvider(userKey: string) {
  return createOpenAICompatible({
    name: "openai-byok",
    baseURL: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${userKey}` },
  });
}
export function createGeminiProvider(userKey: string) {
  return createOpenAICompatible({
    name: "gemini-byok",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: { Authorization: `Bearer ${userKey}` },
  });
}

// Resolve a provider + model id string using user preference.
// PRIORITÉ (centralisée pour toute la plateforme):
//   1. Clé GEMINI_API_KEY présente dans les Secrets projet → utilisée exclusivement pour tous les modèles google/*
//   2. BYOK utilisateur si compatible avec le vendeur du modèle
//   3. Fallback Lovable AI Gateway
export function resolveProvider(opts: {
  requestedModel: string; // e.g. "google/gemini-3-flash-preview" or "openai/gpt-5-mini"
  lovableKey: string;
  byok?: { preferred_provider: "lovable" | "openai" | "gemini"; openai_key?: string | null; gemini_key?: string | null } | null;
}) {
  const [vendor, ...rest] = opts.requestedModel.split("/");
  const bareModel = rest.join("/") || opts.requestedModel;
  const byok = opts.byok;

  // 1) Clé personnelle Gemini du projet — priorité absolue pour google/*
  const projectGeminiKey = process.env.GEMINI_API_KEY?.trim();
  if (vendor === "google" && projectGeminiKey) {
    return { provider: createGeminiProvider(projectGeminiKey), modelId: bareModel, source: "gemini_personal" as const };
  }

  // 2) BYOK utilisateur
  if (byok?.preferred_provider === "openai" && byok.openai_key && vendor === "openai") {
    return { provider: createOpenAiProvider(byok.openai_key), modelId: bareModel, source: "byok-openai" as const };
  }
  if (byok?.preferred_provider === "gemini" && byok.gemini_key && vendor === "google") {
    return { provider: createGeminiProvider(byok.gemini_key), modelId: bareModel, source: "byok-gemini" as const };
  }

  // 3) Fallback Lovable AI
  return { provider: createLovableAiGatewayProvider(opts.lovableKey), modelId: opts.requestedModel, source: "lovable_ai" as const };
}

// Diagnostic : quel fournisseur sera utilisé pour un modèle donné.
export function currentProviderFor(requestedModel: string): "gemini_personal" | "lovable_ai" {
  const [vendor] = requestedModel.split("/");
  if (vendor === "google" && process.env.GEMINI_API_KEY?.trim()) return "gemini_personal";
  return "lovable_ai";
}

// Rough per-1K token price ($). Kept simple/approximate; refined over time.
const PRICES: Record<string, { input: number; output: number }> = {
  "google/gemini-3-flash-preview": { input: 0.00015, output: 0.0006 },
  "google/gemini-2.5-flash-lite":  { input: 0.0001,  output: 0.0004 },
  "google/gemini-2.5-flash":       { input: 0.00015, output: 0.0006 },
  "google/gemini-2.5-pro":         { input: 0.00125, output: 0.005  },
  "openai/gpt-5-nano":             { input: 0.00015, output: 0.0006 },
  "openai/gpt-5-mini":             { input: 0.00025, output: 0.001  },
  "openai/gpt-5":                  { input: 0.0025,  output: 0.01   },
};
export function estimateCostUSD(model: string, input_tokens: number, output_tokens: number) {
  const p = PRICES[model] ?? { input: 0.0002, output: 0.0008 };
  return (input_tokens / 1000) * p.input + (output_tokens / 1000) * p.output;
}

