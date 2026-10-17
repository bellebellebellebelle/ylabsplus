import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  MAX_AUDIO_BYTES,
  GatewayError,
  transcribeAudio,
  analyzeTranscript,
  toRow,
} from "@/lib/analyze.server";

function userClient(token: string) {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

function friendly(e: unknown) {
  if (e instanceof GatewayError) {
    if (e.status === 402) return "Crédits IA épuisés. Rechargez votre espace pour continuer.";
    if (e.status === 429) return "Trop de demandes en cours. Réessayez dans un instant.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Erreur inattendue";
}

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? "";
        if (token.split(".").length !== 3) return new Response("Unauthorized", { status: 401 });
        const len = Number(request.headers.get("content-length") || 0);
        if (len > MAX_AUDIO_BYTES + 512 * 1024)
          return Response.json({ error: "Fichier trop volumineux (14 Mo max)." }, { status: 413 });

        const supabase = userClient(token);
        const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (authErr || !userId) return new Response("Unauthorized", { status: 401 });

        const form = await request.formData();
        const file = form.get("file");
        const date = String(form.get("date") || "");
        if (!(file instanceof File) || !file.size)
          return Response.json({ error: "Aucun fichier audio reçu." }, { status: 400 });
        if (file.size > MAX_AUDIO_BYTES)
          return Response.json({ error: "Fichier trop volumineux (14 Mo max)." }, { status: 413 });

        const apiKey = process.env["LOVABLE_API_KEY"]!;
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(ctrl) {
            const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
            try {
              send({ stage: "transcribe" });
              const transcript = await transcribeAudio(file, apiKey);
              send({ stage: "analyze" });
              const memo = await analyzeTranscript(transcript, apiKey);
              send({ stage: "save" });
              const row = toRow(memo, transcript, userId);
              const { data, error } = await supabase
                .from("meetings")
                .insert({ ...row, ...(date ? { meeting_date: new Date(date).toISOString() } : {}) })
                .select("id")
                .single();
              if (error) throw new Error(error.message);
              send({ stage: "done", id: data.id });
            } catch (e) {
              console.error(e);
              send({ stage: "error", error: friendly(e) });
            }
            ctrl.close();
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      },
    },
  },
});
