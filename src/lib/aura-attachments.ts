export type AuraAttachment = { name: string; mime: "application/pdf" | "image/png" | "audio/mpeg"; data: string };
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export function validateAttachments(input: unknown): AuraAttachment[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 3) throw new Error("Choisissez jusqu’à 3 fichiers.");
  return input.map((file: AuraAttachment) => {
    if (!file || typeof file.name !== "string" || !["application/pdf", "image/png", "audio/mpeg"].includes(file.mime) || typeof file.data !== "string") throw new Error("Formats acceptés : PDF, PNG, MP3.");
    if (!file.data || file.data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw new Error("Fichier vide ou trop volumineux (8 Mo maximum).");
    const bytes = atob(file.data);
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("8 Mo maximum par fichier.");
    const pdf = bytes.startsWith("%PDF-");
    const png = bytes.startsWith("\x89PNG\r\n\x1a\n");
    const mp3 = bytes.startsWith("ID3") || (bytes.charCodeAt(0) === 255 && (bytes.charCodeAt(1) & 224) === 224);
    if (!(file.mime === "application/pdf" ? pdf : file.mime === "image/png" ? png : mp3)) throw new Error("Le contenu du fichier ne correspond pas à son format.");
    return { name: file.name.slice(0, 180), mime: file.mime, data: file.data };
  });
}