// Voice transcription server fn — proxies audio to Lovable AI STT (Gemini-backed).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("FormData required");
    return data;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) throw new Error("LOVABLE_API_KEY manquant");

    const audio = data.get("audio");
    if (!(audio instanceof Blob)) throw new Error("audio file required");

    const upstream = new FormData();
    const mime = audio.type.split(";")[0];
    const ext = ({ "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg" } as Record<string, string>)[mime ?? "audio/webm"] ?? "webm";
    upstream.append("model", "openai/gpt-4o-mini-transcribe");
    upstream.append("file", audio, `recording.${ext}`);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Transcription failed: ${res.status} ${txt.slice(0, 200)}`);
    }
    const json = await res.json();
    return { text: (json.text ?? "").trim() };
  });
