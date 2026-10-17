const GATEWAY = "https://ai.gateway.lovable.dev";
const STT_MODEL = "google/gemini-3.5-transcribe";
const CHAT_MODEL = "openai/gpt-6-astra";
export const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

export class GatewayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readSSE(res: Response, onEvent: (ev: any) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data));
      } catch {
        /* ignore partial */
      }
    }
  }
}

async function failText(res: Response) {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    return j?.error?.message || j?.message || t;
  } catch {
    return t || res.statusText;
  }
}

export async function transcribeAudio(file: File, apiKey: string) {
  const type = file.type.startsWith("audio/") ? file.type : "audio/mpeg";
  const audio = new File([file], file.name || "audio", { type });
  const form = new FormData();
  form.append("model", STT_MODEL);
  form.append("file", audio, audio.name);
  form.append("response_format", "json");
  form.append("stream", "true");
  const res = await fetch(`${GATEWAY}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new GatewayError(res.status, await failText(res));
  let text = "";
  let final = "";
  let err = "";
  await readSSE(res, (ev) => {
    if (ev.type === "transcript.text.delta") text += ev.delta ?? "";
    else if (ev.type === "transcript.text.done") final = ev.text ?? "";
    else if (ev.type === "error" || ev.error) err = ev.error?.message || ev.message || "Erreur de transcription";
  });
  if (err) throw new GatewayError(502, err);
  const out = (final || text).trim();
  if (!out) throw new GatewayError(422, "Aucune parole détectée dans l'enregistrement.");
  return out;
}

const PROMPT = `Tu es un analyste expert en efficacité des réunions d'entreprise.
À partir de la transcription, produis UNIQUEMENT un objet JSON valide (sans markdown) au format:
{
 "title": string (titre court et précis),
 "category": "Stratégie"|"Commercial"|"Projet"|"RH"|"Finance"|"Produit"|"Opérations"|"Général",
 "summary": string (résumé exécutif clair, 3-5 phrases),
 "participants": string[] (noms ou rôles détectés),
 "topics": [{"title": string, "points": string[]}],
 "decisions": string[],
 "actions": [{"task": string, "owner": string, "deadline": string}],
 "risks": string[],
 "next_steps": string[],
 "sentiment": "positif"|"neutre"|"tendu",
 "duration_min": number (estimation),
 "scores": {"efficiency": 0-100, "clarity": 0-100, "engagement": 0-100, "decision": 0-100}
}
Barème: efficiency = ratio contenu utile/digressions; clarity = clarté des objectifs et échanges; engagement = participation équilibrée; decision = décisions concrètes et actions assignées. Sois exigeant et honnête. Langue: français.`;

export async function analyzeTranscript(transcript: string, apiKey: string) {
  const res = await fetch(`${GATEWAY}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      instructions: PROMPT,
      input: `Transcription de la réunion:\n\n${transcript}`,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    }),
  });
  if (!res.ok) throw new GatewayError(res.status, await failText(res));
  let text = "";
  let err = "";
  await readSSE(res, (ev) => {
    if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
    else if (ev.type === "response.failed" || ev.type === "error")
      err = ev.response?.error?.message || ev.error?.message || ev.message || "Analyse échouée";
  });
  if (err) throw new GatewayError(502, err);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new GatewayError(502, "L'analyse n'a renvoyé aucun mémo exploitable.");
  return JSON.parse(m[0]);
}

const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

export function toRow(memo: any, transcript: string, userId: string) {
  const s = memo.scores ?? {};
  const e = clamp(s.efficiency), c = clamp(s.clarity), g = clamp(s.engagement), d = clamp(s.decision);
  return {
    user_id: userId,
    title: String(memo.title || "Réunion").slice(0, 160),
    category: String(memo.category || "Général"),
    summary: String(memo.summary || ""),
    transcript,
    participants: arr(memo.participants),
    topics: arr(memo.topics),
    decisions: arr(memo.decisions),
    actions: arr(memo.actions),
    risks: arr(memo.risks),
    next_steps: arr(memo.next_steps),
    sentiment: ["positif", "neutre", "tendu"].includes(memo.sentiment) ? memo.sentiment : "neutre",
    duration_min: Math.max(0, Math.round(Number(memo.duration_min) || 0)),
    score_efficiency: e,
    score_clarity: c,
    score_engagement: g,
    score_decision: d,
    score_global: Math.round((e + c + g + d) / 4),
  };
}
