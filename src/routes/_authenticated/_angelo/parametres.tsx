import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { previewReminder, runAnalysisNow } from "@/lib/angelo.functions";

export const Route = createFileRoute("/_authenticated/_angelo/parametres")({
  head: () => ({
    meta: [
      { title: "Paramètres ANGELO — relances sur mesure" },
      { name: "description", content: "Ton, niveaux de relance, mentions légales et planification des analyses." },
      { property: "og:title", content: "Paramètres ANGELO — relances sur mesure" },
      { property: "og:description", content: "Configurez en profondeur le comportement de votre assistant de recouvrement." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type Settings = {
  agent_name: string;
  company_name: string | null;
  tone: string;
  language: string;
  signature: string;
  legal_text: string;
  extra_instructions: string;
  cc_emails: string;
  excluded_partners: string;
  min_amount: number;
  min_days_between_reminders: number;
  auto_send: boolean;
  attach_pdf: boolean;
};

type Rule = {
  id: string;
  level: number;
  days_overdue: number;
  firmness: string;
  instructions: string;
  active: boolean;
};

type Schedule = {
  enabled: boolean;
  frequency: string;
  interval_minutes: number;
  hour_utc: number;
  minute_utc: number;
  weekday: number;
  day_of_month: number;
};

function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["angelo_settings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("angelo_settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const rulesQuery = useQuery({
    queryKey: ["reminder_rules", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reminder_rules")
        .select("*")
        .order("days_overdue", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });

  const scheduleQuery = useQuery({
    queryKey: ["schedule", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("schedules").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data as Settings);
  }, [settingsQuery.data]);

  useEffect(() => {
    if (scheduleQuery.data) setSchedule(scheduleQuery.data as Schedule);
  }, [scheduleQuery.data]);

  async function save() {
    if (!settings || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("angelo_settings")
        .update({ ...settings, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (error) throw error;
      if (schedule) {
        const { error: e2 } = await supabase
          .from("schedules")
          .update({ ...schedule, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
        if (e2) throw e2;
      }
      toast.success("Paramètres enregistrés.");
      qc.invalidateQueries({ queryKey: ["angelo_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function saveRule(rule: Rule) {
    const { error } = await supabase
      .from("reminder_rules")
      .update({
        level: rule.level,
        days_overdue: rule.days_overdue,
        firmness: rule.firmness,
        instructions: rule.instructions,
        active: rule.active,
      })
      .eq("id", rule.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["reminder_rules"] });
  }

  async function addRule() {
    if (!user) return;
    const rules = rulesQuery.data ?? [];
    const { error } = await supabase.from("reminder_rules").insert({
      user_id: user.id,
      level: rules.length + 1,
      days_overdue: (rules[rules.length - 1]?.days_overdue ?? 0) + 15,
      firmness: "ferme",
      instructions: "",
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["reminder_rules"] });
  }

  async function removeRule(id: string) {
    const { error } = await supabase.from("reminder_rules").delete().eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["reminder_rules"] });
  }

  async function doPreview() {
    setPreviewing(true);
    try {
      const res = await previewReminder({ data: {} });
      setPreview(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Aperçu impossible");
    } finally {
      setPreviewing(false);
    }
  }

  if (!settings) {
    return <p className="text-sm text-muted-foreground">Chargement des paramètres…</p>;
  }

  const s = settings;
  const set = (patch: Partial<Settings>) => setSettings({ ...s, ...patch });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paramètres ANGELO</h1>
          <p className="text-sm text-muted-foreground">Personnalisez le ton, les niveaux et la planification.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={doPreview} disabled={previewing}>
            <Sparkles className="size-4" /> {previewing ? "Génération…" : "Aperçu d'un email"}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identité et ton</CardTitle>
          <CardDescription>Comment ANGELO se présente à vos clients.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom de l'agent">
            <Input value={s.agent_name} onChange={(e) => set({ agent_name: e.target.value })} />
          </Field>
          <Field label="Société">
            <Input value={s.company_name ?? ""} onChange={(e) => set({ company_name: e.target.value })} />
          </Field>
          <Field label="Ton par défaut">
            <Select value={s.tone} onValueChange={(v) => set({ tone: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="courtois">Courtois</SelectItem>
                <SelectItem value="professionnel">Professionnel</SelectItem>
                <SelectItem value="neutre">Neutre</SelectItem>
                <SelectItem value="ferme">Ferme</SelectItem>
                <SelectItem value="juridique">Juridique</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Langue">
            <Select value={s.language} onValueChange={(v) => set({ language: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">Anglais</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Signature" className="sm:col-span-2">
            <Textarea rows={3} value={s.signature} onChange={(e) => set({ signature: e.target.value })} />
          </Field>
          <Field label="Consignes supplémentaires" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={s.extra_instructions}
              onChange={(e) => set({ extra_instructions: e.target.value })}
              placeholder="Ex. proposer un échéancier au-delà de 5 000 EUR."
            />
          </Field>
          <Field label="Mentions légales rappelées" className="sm:col-span-2">
            <Textarea rows={4} value={s.legal_text} onChange={(e) => set({ legal_text: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Règles d'envoi</CardTitle>
          <CardDescription>Filtres appliqués avant chaque relance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Montant minimum (EUR)">
            <Input
              type="number"
              value={s.min_amount}
              onChange={(e) => set({ min_amount: Number(e.target.value) })}
            />
          </Field>
          <Field label="Délai minimum entre deux relances (jours)">
            <Input
              type="number"
              value={s.min_days_between_reminders}
              onChange={(e) => set({ min_days_between_reminders: Number(e.target.value) })}
            />
          </Field>
          <Field label="Emails en copie (séparés par des virgules)">
            <Input value={s.cc_emails} onChange={(e) => set({ cc_emails: e.target.value })} />
          </Field>
          <Field label="Clients exclus (noms ou emails, virgules)">
            <Input
              value={s.excluded_partners}
              onChange={(e) => set({ excluded_partners: e.target.value })}
            />
          </Field>
          <Toggle
            label="Envoi automatique des relances"
            checked={s.auto_send}
            onChange={(v) => set({ auto_send: v })}
          />
          <Toggle
            label="Joindre le PDF de la facture"
            checked={s.attach_pdf}
            onChange={(v) => set({ attach_pdf: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Niveaux de relance</CardTitle>
              <CardDescription>Du rappel courtois à la mise en demeure.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={addRule}>
              <Plus className="size-4" /> Niveau
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(rulesQuery.data ?? []).map((rule) => (
            <div key={rule.id} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
              <Field label="Niveau">
                <Input
                  type="number"
                  defaultValue={rule.level}
                  onBlur={(e) => saveRule({ ...rule, level: Number(e.target.value) })}
                />
              </Field>
              <Field label="Jours de retard">
                <Input
                  type="number"
                  defaultValue={rule.days_overdue}
                  onBlur={(e) => saveRule({ ...rule, days_overdue: Number(e.target.value) })}
                />
              </Field>
              <Field label="Fermeté">
                <Select value={rule.firmness} onValueChange={(v) => saveRule({ ...rule, firmness: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="courtois">Courtois</SelectItem>
                    <SelectItem value="ferme">Ferme</SelectItem>
                    <SelectItem value="mise_en_demeure">Mise en demeure</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-end justify-between gap-2">
                <Toggle
                  label="Actif"
                  checked={rule.active}
                  onChange={(v) => saveRule({ ...rule, active: v })}
                />
                <Button variant="ghost" size="icon" onClick={() => removeRule(rule.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              <Field label="Consignes de rédaction" className="sm:col-span-4">
                <Textarea
                  rows={2}
                  defaultValue={rule.instructions}
                  onBlur={(e) => saveRule({ ...rule, instructions: e.target.value })}
                />
              </Field>
            </div>
          ))}
        </CardContent>
      </Card>

      {schedule && (
        <Card>
          <CardHeader>
            <CardTitle>Planification</CardTitle>
            <CardDescription>Quand ANGELO analyse vos factures.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Toggle
              label="Analyse automatique activée"
              checked={schedule.enabled}
              onChange={(v) => setSchedule({ ...schedule, enabled: v })}
            />
            <Field label="Fréquence">
              <Select
                value={schedule.frequency}
                onValueChange={(v) =>
                  setSchedule({
                    ...schedule,
                    frequency: v,
                    interval_minutes: v === "minutes" ? 30 : v === "hourly" ? 120 : schedule.interval_minutes,
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Toutes les X minutes</SelectItem>
                  <SelectItem value="hourly">Toutes les X heures</SelectItem>
                  <SelectItem value="daily">Quotidienne</SelectItem>
                  <SelectItem value="weekly">Hebdomadaire</SelectItem>
                  <SelectItem value="monthly">Mensuelle</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {schedule.frequency === "minutes" && (
              <Field label="Intervalle en minutes (minimum 10)">
                <Input
                  type="number"
                  min={10}
                  max={1440}
                  step={5}
                  value={schedule.interval_minutes}
                  onChange={(e) =>
                    setSchedule({ ...schedule, interval_minutes: Math.max(10, Number(e.target.value)) })
                  }
                />
              </Field>
            )}
            {schedule.frequency === "hourly" && (
              <Field label="Intervalle en heures">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={Math.max(1, Math.round(schedule.interval_minutes / 60))}
                  onChange={(e) =>
                    setSchedule({
                      ...schedule,
                      interval_minutes: Math.max(1, Number(e.target.value)) * 60,
                    })
                  }
                />
              </Field>
            )}
            {schedule.frequency !== "minutes" && schedule.frequency !== "hourly" && (
              <>
                <Field label="Heure (UTC)">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={schedule.hour_utc}
                    onChange={(e) => setSchedule({ ...schedule, hour_utc: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Minute (UTC)">
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={schedule.minute_utc}
                    onChange={(e) => setSchedule({ ...schedule, minute_utc: Number(e.target.value) })}
                  />
                </Field>
              </>
            )}
            {schedule.frequency === "weekly" && (
              <Field label="Jour de la semaine (0 = dimanche)">
                <Input
                  type="number"
                  min={0}
                  max={6}
                  value={schedule.weekday}
                  onChange={(e) => setSchedule({ ...schedule, weekday: Number(e.target.value) })}
                />
              </Field>
            )}
            {schedule.frequency === "monthly" && (
              <Field label="Jour du mois">
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={schedule.day_of_month}
                  onChange={(e) => setSchedule({ ...schedule, day_of_month: Number(e.target.value) })}
                />
              </Field>
            )}
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Les vérifications ont lieu toutes les 10 minutes : un intervalle plus court est arrondi
              à ce rythme. Le détail de chaque passage est visible dans le journal.
            </p>
            <div className="sm:col-span-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await runAnalysisNow({ data: undefined });
                    toast.success(`Analyse terminée : ${res.sent} relance(s).`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Analyse impossible");
                  }
                }}
              >
                Exécuter maintenant
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>Aperçu généré</CardTitle>
            <CardDescription>{preview.subject}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{preview.body}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <Label className="text-sm font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
