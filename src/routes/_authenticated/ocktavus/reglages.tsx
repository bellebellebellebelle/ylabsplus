import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SlidersHorizontal, Save, Check, Mail, Cpu } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/reglages")({ component: SettingsPage });

const TIMEZONES = [
  "Indian/Reunion",
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Dubai",
  "Africa/Casablanca",
  "UTC",
];

const AI_MODELS = [
  { value: "google/gemini-3-flash-preview", label: "Gemini 3.6 Flash", description: "Rapide et performant pour Workspace" },
  { value: "openai/gpt-5-nano", label: "GPT-5 Nano", description: "Très rapide pour les tâches simples" },
  { value: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Faible latence et tâches agentiques" },
];

function SettingsPage() {
  const [timezone, setTimezone] = useState("Indian/Reunion");
  const [memory, setMemory] = useState(20);
  const [model, setModel] = useState("google/gemini-3-flash-preview");
  const [emailGreeting, setEmailGreeting] = useState("Bonjour");
  const [emailSignature, setEmailSignature] = useState("");
  const [emailTone, setEmailTone] = useState("professionnel");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("user_settings")
        .select("timezone, chat_memory_size, ai_model, email_greeting, email_signature, email_tone")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (data) {
        setTimezone(data.timezone ?? "Indian/Reunion");
        setMemory(data.chat_memory_size ?? 20);
        setModel(data.ai_model ?? "google/gemini-3-flash-preview");
        setEmailGreeting(data.email_greeting ?? "Bonjour");
        setEmailSignature(data.email_signature ?? "");
        setEmailTone(data.email_tone ?? "professionnel");
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("user_settings").upsert({
      user_id: u.user.id,
      timezone,
      chat_memory_size: memory,
      ai_model: model,
      email_greeting: emailGreeting,
      email_signature: emailSignature,
      email_tone: emailTone,
      updated_at: new Date().toISOString(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-6 flex items-center gap-3">
        <SlidersHorizontal className="h-5 w-5 text-primary" />
        <h1 className="font-display text-2xl">Paramètres</h1>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <div className="grid max-w-2xl gap-4">
          <section className="bento p-5">
            <h2 className="font-display text-lg">Fuseau horaire</h2>
            <p className="mb-3 text-xs text-muted-foreground">Utilisé par l'agent pour tous les rendez-vous Google Agenda.</p>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-border bg-card/60 px-3 py-2 text-sm outline-none"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </section>

          <section className="bento p-5">
            <div className="mb-3 flex items-center gap-2"><Cpu className="h-4 w-4 text-primary" /><h2 className="font-display text-lg">Modèle Lovable AI</h2></div>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-border bg-card/60 px-3 py-2 text-sm outline-none">
              {AI_MODELS.map((item) => <option key={item.value} value={item.value}>{item.label} — {item.description}</option>)}
            </select>
          </section>

          <section className="bento p-5">
            <div className="mb-3 flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><h2 className="font-display text-lg">Rédaction des e-mails</h2></div>
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs text-muted-foreground">Formule d’ouverture
                <input value={emailGreeting} onChange={(e) => setEmailGreeting(e.target.value)} placeholder="Bonjour" className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-foreground outline-none" />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">Ton
                <select value={emailTone} onChange={(e) => setEmailTone(e.target.value)} className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-foreground outline-none">
                  <option value="professionnel">Professionnel</option><option value="chaleureux">Chaleureux</option><option value="concis">Concis</option><option value="formel">Formel</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">Signature
                <textarea value={emailSignature} onChange={(e) => setEmailSignature(e.target.value)} rows={3} placeholder="Nom, fonction…" className="resize-none rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-foreground outline-none" />
              </label>
            </div>
          </section>

          <section className="bento p-5">
            <h2 className="font-display text-lg">Mémoire Google Chat</h2>
            <p className="mb-3 text-xs text-muted-foreground">Nombre de messages précédents conservés par espace Google Chat (2–100).</p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={2}
                max={100}
                step={1}
                value={memory}
                onChange={(e) => setMemory(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-12 rounded-md bg-card/60 px-2 py-1 text-center text-sm">{memory}</span>
            </div>
          </section>

          <button
            onClick={save}
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground holo-glow"
          >
            {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "Enregistré" : "Enregistrer"}
          </button>
        </div>
      )}
    </div>
  );
}
