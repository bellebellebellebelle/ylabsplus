import { getGoogleAccessToken, googleFetch } from "./google.server";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry<T>(operation: (attempt: number) => Promise<T>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Opération Google Chat impossible");
}

export async function sendGoogleChatProgress(userId: string, spaceId: string, text: string) {
  const normalizedSpace = spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`;
  try {
    await googleFetch(userId, `https://chat.googleapis.com/v1/${normalizedSpace}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    return true;
  } catch (error) {
    console.warn("Google Chat progress message unavailable", error);
    return false;
  }
}

async function fetchMedia(userId: string, urls: string[]) {
  return retry(async () => {
    const token = await getGoogleAccessToken(userId);
    let lastStatus = "";
    for (const url of urls) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength < 256) throw new Error("Le message vocal est vide ou incomplet");
        return { bytes, mime: response.headers.get("content-type")?.split(";")[0] ?? "" };
      }
      lastStatus = `${response.status} ${await response.text().catch(() => "")}`;
    }
    throw new Error(`Téléchargement audio refusé: ${lastStatus.slice(0, 240)}`);
  });
}

function extensionForMime(mime: string) {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  return "audio";
}

export async function transcribeGoogleChatAttachment(userId: string, attachment: any, apiKey: string) {
  let mime = String(attachment?.contentType ?? "").split(";")[0];
  let media: { bytes: ArrayBuffer; mime: string } | null = null;
  const driveId = attachment?.driveDataRef?.driveFileId;
  const resourceName = attachment?.attachmentDataRef?.resourceName;

  if (driveId) {
    const metadata = await retry(() =>
      googleFetch(userId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?fields=mimeType,name`),
    );
    mime = metadata?.mimeType || mime;
    media = await fetchMedia(userId, [`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`]);
  } else if (resourceName) {
    const encoded = String(resourceName).split("/").map(encodeURIComponent).join("/");
    media = await fetchMedia(userId, [
      `https://chat.googleapis.com/v1/media/${encoded}?alt=media`,
      `https://chat.googleapis.com/v1/${encoded}?alt=media`,
    ]);
  }

  if (!media) throw new Error("La pièce jointe audio ne contient aucune référence téléchargeable");
  mime = media.mime || mime || "";
  if (!/^audio\//i.test(mime)) throw new Error(`La pièce jointe reçue n'est pas reconnue comme audio (${mime || "type inconnu"})`);

  return retry(async (attempt) => {
    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("file", new File([media.bytes], `message-vocal.${extensionForMime(mime)}`, { type: mime || undefined }));
    if (attempt === 1) form.append("prompt", "Transcris fidèlement en français, sans traduire ni inventer.");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Transcription ${response.status}: ${body.slice(0, 240)}`);
    const parsed = JSON.parse(body) as { text?: string };
    const text = parsed.text?.trim();
    if (!text) throw new Error("La transcription reçue est vide");
    return { text, attempts: attempt };
  });
}