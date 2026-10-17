import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listAgentTools, saveAgentTool, toggleAgentTool, deleteAgentTool } from "@/lib/tools.functions";
import { GlassCard } from "@/components/glass-card";
import { Wrench, Plus, Trash2, Save, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_mm/tools")({
  head: () => ({ meta: [{ title: "Outils · Nexus" }] }),
  component: ToolsPage,
});

type Row = {
  id: string;
  name: string;
  description: string;
  http_method: string;
  url: string;
  headers: Record<string, string> | unknown;
  body_template: string | null;
  enabled: boolean;
  created_at: string;
};

function ToolsPage() {
  const list = useServerFn(listAgentTools);
  const save = useServerFn(saveAgentTool);
  const toggle = useServerFn(toggleAgentTool);
  const del = useServerFn(deleteAgentTool);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    id: "" as string | undefined,
    name: "",
    description: "",
    http_method: "GET" as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: "",
    headersText: "",
    body_template: "",
    enabled: true,
  });

  async function refresh() {
    setLoading(true);
    try {
      const r = await list();
      setRows(r as unknown as Row[]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  function editRow(r: Row) {
    setForm({
      id: r.id,
      name: r.name,
      description: r.description,
      http_method: (r.http_method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE") ?? "GET",
      url: r.url,
      headersText: JSON.stringify(r.headers ?? {}, null, 2),
      body_template: r.body_template ?? "",
      enabled: r.enabled,
    });
    setShowForm(true);
  }
  function resetForm() {
    setForm({ id: undefined, name: "", description: "", http_method: "GET", url: "", headersText: "", body_template: "", enabled: true });
    setShowForm(true);
  }

  async function submit() {
    try {
      let headers: Record<string, string> = {};
      if (form.headersText.trim()) {
        try { headers = JSON.parse(form.headersText); } catch { toast.error("En-têtes: JSON invalide"); return; }
      }
      await save({ data: {
        id: form.id || undefined,
        name: form.name, description: form.description,
        http_method: form.http_method, url: form.url,
        headers, body_template: form.body_template || null, enabled: form.enabled,
      } });
      toast.success(form.id ? "Outil mis à jour" : "Outil créé");
      setShowForm(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Wrench className="size-7 text-primary" /> Outils personnalisés</h1>
          <p className="text-sm text-muted-foreground mt-1">Ajoutez vos propres outils HTTP. L'agent les reçoit automatiquement lorsqu'ils sont activés. Placeholders <code className="font-mono text-xs bg-white/40 px-1 rounded">{`{{param}}`}</code> dans l'URL, les en-têtes et le body.</p>
        </div>
        <button onClick={resetForm} className="press inline-flex items-center gap-2 rounded-xl holo-gradient animate-holo px-4 py-2.5 text-sm font-medium text-white holo-glow">
          <Plus className="size-4" /> Nouvel outil
        </button>
      </div>

      {showForm && (
        <GlassCard className="space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <input className="rounded-lg bg-white/40 px-3 py-2 text-sm" placeholder="Nom (ex: get_weather)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="rounded-lg bg-white/40 px-3 py-2 text-sm" value={form.http_method} onChange={(e) => setForm({ ...form, http_method: e.target.value as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" })}>
              {(["GET","POST","PUT","PATCH","DELETE"] as const).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm px-3 py-2">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Activé
            </label>
          </div>
          <input className="w-full rounded-lg bg-white/40 px-3 py-2 text-sm" placeholder="URL (https://api.exemple.com/{{id}})" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <textarea className="w-full rounded-lg bg-white/40 px-3 py-2 text-sm min-h-[70px]" placeholder="Description (ce que fait l'outil, quand l'utiliser)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="w-full rounded-lg bg-white/40 px-3 py-2 text-xs font-mono min-h-[70px]" placeholder='En-têtes JSON, ex: {"Authorization":"Bearer XYZ"}' value={form.headersText} onChange={(e) => setForm({ ...form, headersText: e.target.value })} />
          <textarea className="w-full rounded-lg bg-white/40 px-3 py-2 text-xs font-mono min-h-[100px]" placeholder='Body template (JSON avec {{placeholders}})' value={form.body_template} onChange={(e) => setForm({ ...form, body_template: e.target.value })} />
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="press rounded-lg border border-foreground/10 px-4 py-2 text-sm">Annuler</button>
            <button onClick={submit} className="press inline-flex items-center gap-2 rounded-lg holo-gradient text-white px-4 py-2 text-sm"><Save className="size-4" /> Enregistrer</button>
          </div>
        </GlassCard>
      )}

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Chargement…</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <GlassCard key={r.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">custom_{r.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0,40)}</span>
                  <span className="text-[10px] rounded bg-white/40 px-1.5 py-0.5">{r.http_method}</span>
                  {!r.enabled && <span className="text-[10px] rounded bg-amber-500/30 px-1.5 py-0.5">désactivé</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{r.description}</div>
                <div className="text-[10px] font-mono text-muted-foreground/80 truncate">{r.url}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={async () => { await toggle({ data: { id: r.id, enabled: !r.enabled } }); refresh(); }}
                  className="press rounded-lg text-xs border border-foreground/10 px-2.5 py-1.5">
                  {r.enabled ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                </button>
                <button onClick={() => editRow(r)} className="press rounded-lg text-xs border border-foreground/10 px-2.5 py-1.5">Éditer</button>
                <button onClick={async () => { if (confirm("Supprimer cet outil ?")) { await del({ data: { id: r.id } }); refresh(); } }}
                  className="press rounded-lg text-xs border border-red-500/30 text-red-600 px-2.5 py-1.5">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </GlassCard>
          ))}
          {!rows.length && (
            <GlassCard>
              <p className="text-sm text-muted-foreground">Aucun outil pour le moment. Créez-en un pour permettre à l'agent d'appeler vos APIs.</p>
              <p className="text-xs text-muted-foreground mt-2">💡 Si l'agent vous répond « TOOL_MISSING: xxx », créez l'outil ici puis relancez l'automatisation.</p>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
