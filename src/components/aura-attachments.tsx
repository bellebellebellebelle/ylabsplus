import { useRef, useState } from "react";
import { Paperclip, X, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_ATTACHMENT_BYTES, validateAttachments, type AuraAttachment } from "@/lib/aura-attachments";

export function AuraAttachments({ files, onChange, busy = false, floating = false }: { files: AuraAttachment[]; onChange: (files: AuraAttachment[]) => void; busy?: boolean; floating?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  async function load(selected: FileList | null) {
    if (!selected) return;
    setReading(true); setError("");
    try {
      const incoming = await Promise.all(Array.from(selected).map(async file => {
        if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error("8 Mo maximum par fichier.");
        const mime = file.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : file.type;
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
          reader.readAsDataURL(file);
        });
        return { name: file.name, mime, data };
      }));
      onChange(validateAttachments([...files, ...incoming]));
    } catch (e) { setError(e instanceof Error ? e.message : "Lecture impossible."); }
    finally { setReading(false); if (input.current) input.current.value = ""; }
  }
  return <div className={`aura-attachments ${floating ? "aura-attachments-floating" : ""}`}>
    <input ref={input} type="file" accept="application/pdf,image/png,audio/mpeg,.mp3" multiple hidden onChange={e => void load(e.target.files)} />
    <Button type="button" variant="ghost" size="icon" title="Joindre un fichier PDF, PNG ou MP3" aria-label="Joindre un fichier" disabled={busy || reading} onClick={() => input.current?.click()}>{reading ? <LoaderCircle className="animate-spin" /> : <Paperclip />}</Button>
    {files.map((file, i) => <span className="aura-file" key={`${file.name}-${i}`}><span>{file.name}</span><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Retirer ${file.name}`} onClick={() => onChange(files.filter((_, index) => index !== i))}><X /></Button></span>)}
    {error && <span role="alert" className="text-destructive-foreground">{error}</span>}
  </div>;
}