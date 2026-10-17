import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/glass-card";
import { GlowButton } from "@/components/glow-button";
import { LogOut, User, Image as ImageIcon, Database, Trash2, Upload, Loader2, KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { cleanupDatabase, saveUserAiKeys, getUserAiKeys, resetAccountData } from "@/lib/automations.functions";

export const Route = createFileRoute("/_authenticated/_mm/preferences")({
  head: () => ({ meta: [{ title: "Paramètres · Nexus" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ email: string | null; full_name: string | null } | null>(null);
  const [name, setName] = useState("");
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgOpacity, setBgOpacity] = useState(0.35);
  const [uploading, setUploading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cleanup = useServerFn(cleanupDatabase);
  const saveKeys = useServerFn(saveUserAiKeys);
  const getKeys = useServerFn(getUserAiKeys);
  const resetAccount = useServerFn(resetAccountData);
  const [preferred, setPreferred] = useState<"lovable" | "openai" | "gemini">("lovable");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [hasOpenai, setHasOpenai] = useState(false);
  const [hasGemini, setHasGemini] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: p }, { data: prefs }] = await Promise.all([
        supabase.from("profiles").select("email, full_name").eq("id", user.id).maybeSingle(),
        supabase.from("ui_preferences").select("background_url, background_opacity").maybeSingle(),
      ]);
      setProfile(p ?? { email: user.email ?? "", full_name: null });
      setName(p?.full_name ?? "");
      if (prefs) { setBgUrl(prefs.background_url); setBgOpacity(prefs.background_opacity ?? 0.35); }
      try {
        const k = await getKeys();
        setPreferred(k.preferred_provider);
        setHasOpenai(k.has_openai);
        setHasGemini(k.has_gemini);
      } catch { /* */ }
    })();
  }, []);

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
    if (error) toast.error(error.message); else toast.success("Profil mis à jour");
  }
  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("backgrounds").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("backgrounds").createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = signed?.signedUrl ?? null;
      const { error: prefErr } = await supabase.from("ui_preferences").upsert({ user_id: user.id, background_url: url, background_opacity: bgOpacity });
      if (prefErr) throw prefErr;
      setBgUrl(url);
      toast.success("Fond d'écran mis à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'upload");
    } finally { setUploading(false); }
  }

  async function clearBg() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("ui_preferences").upsert({ user_id: user.id, background_url: null });
    setBgUrl(null);
    toast.success("Fond retiré");
  }

  async function saveOpacity(v: number) {
    setBgOpacity(v);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("ui_preferences").upsert({ user_id: user.id, background_opacity: v });
  }

  async function runCleanup() {
    setCleaning(true);
    try {
      const r = await cleanup({ data: undefined as never });
      toast.success(`Nettoyage terminé · ${r.deleted} exécutions supprimées`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setCleaning(false); }
  }

  async function clearCache() {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* */ }
    toast.success("Cache navigateur vidé");
  }

  async function saveAiKeys() {
    setSavingKeys(true);
    try {
      await saveKeys({ data: {
        preferred_provider: preferred,
        openai_key: openaiKey.trim() || (hasOpenai ? undefined : null),
        gemini_key: geminiKey.trim() || (hasGemini ? undefined : null),
      } });
      toast.success("Clés IA enregistrées");
      setOpenaiKey(""); setGeminiKey("");
      if (openaiKey.trim()) setHasOpenai(true);
      if (geminiKey.trim()) setHasGemini(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setSavingKeys(false); }
  }

  async function doReset() {
    if (!confirm("Réinitialiser votre compte : toutes les automatisations, agents, triggers et exécutions seront supprimés. Continuer ?")) return;
    setResetting(true);
    try {
      await resetAccount({ data: undefined as never });
      toast.success("Compte réinitialisé");
      router.navigate({ to: "/cockpit", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setResetting(false); }
  }


  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div className="animate-in fade-in slide-in-from-top-2">
        <h1 className="text-3xl font-bold font-display">Paramètres</h1>
        <p className="text-sm text-muted-foreground mt-1">Gérez votre profil, votre apparence et votre stockage.</p>
      </div>

      <GlassCard className="animate-in fade-in slide-in-from-bottom-2">
        <div className="flex items-center gap-3 mb-4">
          <User className="size-5 text-primary" />
          <h3 className="font-semibold">Profil</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Email</label>
            <input value={profile?.email ?? ""} readOnly className="mt-1 w-full rounded-xl bg-white/30 border border-foreground/10 px-4 py-2.5 text-muted-foreground" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Nom complet</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl bg-white/40 border border-foreground/10 px-4 py-2.5 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
          </div>
          <GlowButton onClick={save}>Enregistrer</GlowButton>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center gap-3 mb-4">
          <ImageIcon className="size-5 text-primary" />
          <h3 className="font-semibold">Fond d'écran</h3>
        </div>
        {bgUrl && (
          <div className="rounded-xl overflow-hidden border border-foreground/10 mb-3 aspect-[3/1] bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl})` }} />
        )}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Opacité de la transparence ({Math.round(bgOpacity * 100)}%)</label>
            <input type="range" min={0} max={1} step={0.05} value={bgOpacity} onChange={(e) => saveOpacity(Number(e.target.value))} className="w-full accent-primary" />
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          <div className="flex flex-wrap gap-2">
            <GlowButton onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploading ? "Upload…" : "Téléverser une image"}
            </GlowButton>
            {bgUrl && <GlowButton variant="ghost" onClick={clearBg}>Retirer</GlowButton>}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center gap-3 mb-4">
          <Database className="size-5 text-primary" />
          <h3 className="font-semibold">Maintenance</h3>
        </div>
        <p className="text-xs text-muted-foreground">Supprime les anciennes exécutions (&gt; 30 jours) et réinitialise la mémoire d'idempotence de toutes vos automatisations.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <GlowButton variant="danger" onClick={runCleanup} disabled={cleaning}>
            <Trash2 className="size-4" /> {cleaning ? "Nettoyage…" : "Nettoyer la base"}
          </GlowButton>
          <GlowButton variant="ghost" onClick={clearCache}>Vider le cache navigateur</GlowButton>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center gap-3 mb-4">
          <KeyRound className="size-5 text-primary" />
          <h3 className="font-semibold">Clés IA (BYOK)</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Utilisez votre propre clé OpenAI ou Gemini pour bypasser Lovable AI. Si aucune clé n'est fournie, la plateforme utilise Lovable AI par défaut. Les clés sont chiffrées côté serveur et ne sont jamais renvoyées au navigateur.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Fournisseur préféré</label>
            <select value={preferred} onChange={(e) => setPreferred(e.target.value as "lovable" | "openai" | "gemini")} className="mt-1 w-full rounded-xl bg-white/40 border border-foreground/10 px-3 py-2 outline-none focus:border-primary/50">
              <option value="lovable">Lovable AI Gateway (défaut, tous modèles)</option>
              <option value="openai">OpenAI (nécessite clé)</option>
              <option value="gemini">Google Gemini (nécessite clé)</option>
            </select>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Clé OpenAI {hasOpenai && <span className="text-emerald-600">· active</span>}</label>
              <input type="password" placeholder={hasOpenai ? "•••• (clé enregistrée)" : "sk-…"} value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} className="mt-1 w-full rounded-xl bg-white/40 border border-foreground/10 px-3 py-2 outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Clé Gemini {hasGemini && <span className="text-emerald-600">· active</span>}</label>
              <input type="password" placeholder={hasGemini ? "•••• (clé enregistrée)" : "AIza…"} value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} className="mt-1 w-full rounded-xl bg-white/40 border border-foreground/10 px-3 py-2 outline-none focus:border-primary/50" />
            </div>
          </div>
          <GlowButton onClick={saveAiKeys} disabled={savingKeys}>
            {savingKeys ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Enregistrer les clés
          </GlowButton>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center gap-3 mb-4">
          <ShieldAlert className="size-5 text-destructive" />
          <h3 className="font-semibold">Réinitialiser le compte</h3>
        </div>
        <p className="text-xs text-muted-foreground">Supprime <b>toutes</b> vos automatisations, agents, triggers, exécutions et sessions HELPY. Votre profil et vos connexions Google sont conservés.</p>
        <div className="mt-3">
          <GlowButton variant="danger" onClick={doReset} disabled={resetting}>
            {resetting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Réinitialiser mon compte
          </GlowButton>
        </div>
      </GlassCard>


      <GlassCard>
        <h3 className="font-semibold">Session</h3>
        <p className="text-sm text-muted-foreground mt-1">Déconnectez-vous de votre compte.</p>
        <div className="mt-4">
          <GlowButton variant="danger" onClick={signOut}><LogOut className="size-4" /> Se déconnecter</GlowButton>
        </div>
      </GlassCard>
    </div>
  );
}
