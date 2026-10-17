import { describe, expect, it } from "vitest";
import { validateAttachments } from "@/lib/aura-attachments";
import { chatAudio, chatImage, chatPDF } from "@/lib/media-parts";
describe("Aura attachments", () => {
  it("accepts PDF bytes as a real inline PDF", () => {
    const file = validateAttachments([{ name: "notes.pdf", mime: "application/pdf", data: btoa("%PDF-1.7 sample") }])[0];
    expect(chatPDF(file.name, file.data).file.file_data).toBe(`data:application/pdf;base64,${file.data}`);
  });
  it("accepts PNG bytes as an image", () => {
    const file = validateAttachments([{ name: "notes.png", mime: "image/png", data: btoa("\x89PNG\r\n\x1a\n sample") }])[0];
    expect(chatImage(`data:${file.mime};base64,${file.data}`).image_url.url).toContain("data:image/png;base64,");
  });
  it("accepts MP3 bytes and sends the mp3 container", () => {
    const file = validateAttachments([{ name: "notes.mp3", mime: "audio/mpeg", data: btoa("ID3 sample") }])[0];
    expect(chatAudio(file.data, "mp3").input_audio).toEqual({ data: file.data, format: "mp3" });
  });
  it("rejects mismatched file content", () => {
    expect(() => validateAttachments([{ name: "fake.pdf", mime: "application/pdf", data: btoa("not a pdf") }])).toThrow("ne correspond pas");
  });
});