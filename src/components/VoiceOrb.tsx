import { useEffect, useState } from "react";
import { AudioLines, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Embedded lab pages use the parent Aura instance rather than another recorder. */
export function VoiceOrb() {
  const [embedded, setEmbedded] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setEmbedded(window.self !== window.top);
    const talk = () => {
      if (window.self !== window.top) window.parent.postMessage({ type: "aura-talk" }, window.location.origin);
      else setOpen(true);
    };
    window.addEventListener("aura-talk", talk);
    return () => window.removeEventListener("aura-talk", talk);
  }, []);
  if (embedded) return null;
  return <>
    {open && <section className="aura-voice-window" aria-label="Conversation avec Aura">
      <iframe src="/?voice=true" title="Conversation Aura" allow="microphone; autoplay"/>
      <Button variant="ghost" size="icon" aria-label="Fermer Aura" onClick={() => setOpen(false)} className="absolute right-2 top-2"><X/></Button>
    </section>}
    <Button variant="ghost" onClick={() => setOpen(value => !value)} aria-label="Parler à Aura" className="aura-standalone-button"><AudioLines/></Button>
  </>;
}
