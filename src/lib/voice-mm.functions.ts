import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Voice transcription via Lovable AI Gateway (openai/gpt-4o-mini-transcribe).
// The client uploads a recording (multipart/form-data field "audio") and we
// forward to the gateway, returning the transcript text.
export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const form = await req.formData();
    const file = form.get("audio") as unknown as Blob | null;
    if (!file || typeof (file as Blob).arrayBuffer !== "function") {
      throw new Error("Audio manquant");
    }
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const upstream = new FormData();
    upstream.append("model", "openai/gpt-4o-mini-transcribe");
    // Derive an extension that matches the actual container.
    const mime = (file as { type?: string }).type || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "webm";
    upstream.append("file", file as Blob, `recording.${ext}`);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: upstream,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Transcription échouée (${res.status}): ${txt.slice(0, 240)}`);
    }
    const json = await res.json() as { text?: string };
    return { text: json.text ?? "" };
  });
