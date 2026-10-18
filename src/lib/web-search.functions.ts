import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const WEB_SEARCH_MODEL = "openai/gpt-6-sol";

type Source = { title: string; url: string; snippet: string };

async function search(query: string): Promise<Source[]> {
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), { headers: { "User-Agent": "Mozilla/5.0 (IDEALAB web search)" } });
  if (!res.ok) throw new Error(`Recherche web indisponible (${res.status})`);
  const html = await res.text();
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
  const out: Source[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 6) {
    let url = m[1]!;
    const u = /uddg=([^&]+)/.exec(url); if (u) url = decodeURIComponent(u[1]!);
    if (url.startsWith("//")) url = "https:" + url;
    out.push({ title: strip(m[2]!), url, snippet: strip(m[3]!) });
  }
  return out;
}

async function readPage(url: string) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (IDEALAB web search)" } });
    if (!res.ok) return "";
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    return text.slice(0, 4000);
  } catch { return ""; }
}

export const runWebSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ query: z.string().trim().min(2).max(300) }).parse(i))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("L'IA n'est pas configurée.");
    const sources = await search(data.query);
    if (!sources.length) return { answer: "Aucun résultat trouvé sur le web pour cette recherche.", sources };
    const pages = await Promise.all(sources.slice(0, 3).map(s => readPage(s.url)));
    const context = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}${pages[i] ? `\nExtrait : ${pages[i]}` : ""}`).join("\n\n");

    const [{ createOpenAI }, { streamText }, { createLovableAiGatewayRunIdFetch }] = await Promise.all([import("@ai-sdk/openai"), import("ai"), import("./smart-teams/run-id.ts")]);
    const run = createLovableAiGatewayRunIdFetch();
    const openai = createOpenAI({ apiKey, baseURL: "https://ai.gateway.lovable.dev/v1", headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }, fetch: run.fetch });
    const result = streamText({
      model: openai.responses(WEB_SEARCH_MODEL),
      system: "Tu es un moteur de recherche IA. Réponds en français, de façon claire et concise (5 à 8 phrases maximum), uniquement à partir des sources fournies. Cite les sources avec [n]. Si les sources ne suffisent pas, dis-le.",
      messages: [{ role: "user", content: `Question : ${data.query}\n\nSources web du ${new Date().toLocaleDateString("fr-FR")} :\n${context}` }],
      maxRetries: 0,
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
    });
    const answer = (await result.text).trim();
    if (!answer) throw new Error("GPT-6 Sol n'a fourni aucune réponse.");
    return { answer, sources };
  });
