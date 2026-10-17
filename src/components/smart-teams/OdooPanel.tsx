import { useEffect, useState } from "react";
import { Check, Loader2, Plug, PlugZap, X } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEPARTMENTS, DEPARTMENT_MODULE_DEFAULTS, ODOO_MODULES } from "@/lib/smart-teams/agent-config";
import { connectOdoo, disconnectOdoo, setDepartmentModules } from "@/lib/smart-teams/odoo.functions";
import type { CustomDepartment, OdooState } from "@/lib/smart-teams/board-data";
import { cn } from "@/lib/utils";

type Props = {
  odoo: OdooState;
  customDepartments: CustomDepartment[];
  onClose: () => void;
  onChanged: () => void;
};

export function OdooPanel({ odoo, customDepartments, onClose, onChanged }: Props) {
  const connect = useServerFn(connectOdoo);
  const disconnect = useServerFn(disconnectOdoo);
  const saveModules = useServerFn(setDepartmentModules);

  const [form, setForm] = useState({ url: odoo.url, database: odoo.database, username: odoo.username, apiKey: "" });
  const [modules, setModules] = useState<Record<string, string[]>>(odoo.modulesByDept);
  const [busy, setBusy] = useState(false);
  const [openDept, setOpenDept] = useState<string | null>(null);

  useEffect(() => {
    setForm((f) => ({ ...f, url: odoo.url, database: odoo.database, username: odoo.username }));
    setModules(odoo.modulesByDept);
  }, [odoo]);

  const allDepartments = [
    ...DEPARTMENTS.map((d) => ({ key: d.key, label: d.label })),
    ...customDepartments.map((d) => ({ key: d.key, label: d.label })),
  ];

  function toggle(dept: string, mod: string) {
    setModules((prev) => {
      const current = prev[dept] ?? DEPARTMENT_MODULE_DEFAULTS[dept] ?? [];
      const next = current.includes(mod) ? current.filter((m) => m !== mod) : [...current, mod];
      return { ...prev, [dept]: next };
    });
  }

  function effectiveModules(dept: string): string[] {
    return modules[dept] ?? DEPARTMENT_MODULE_DEFAULTS[dept] ?? [];
  }

  async function handleConnect() {
    setBusy(true);
    try {
      await connect({ data: form });
      toast.success("Base Odoo connectée");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await disconnect({});
      toast.success("Odoo déconnecté");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveModules(dept: string) {
    try {
      await saveModules({ data: { department: dept, modules: effectiveModules(dept) } });
      toast.success("Accès enregistrés");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Échec");
    }
  }

  return (
    <aside className="scroll-slim absolute inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col overflow-y-auto border-l border-border st-panel">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-base font-semibold">
            <PlugZap className="size-4 text-accent" /> Connexion Odoo
          </p>
          <p className="text-xs text-muted-foreground">
            {odoo.connected ? `Connecté à ${odoo.database}` : "Reliez votre ERP à vos agents"}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X className="size-4" />
        </Button>
      </header>

      <div className="space-y-5 p-4">
        <div className="space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
          <div className="space-y-1.5">
            <Label>URL de l'instance</Label>
            <Input
              placeholder="https://mon-entreprise.odoo.com"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Base de données</Label>
              <Input
                placeholder="ma-base"
                value={form.database}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Utilisateur</Label>
              <Input
                placeholder="admin@entreprise.com"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Clé API Odoo</Label>
            <Input
              type="password"
              placeholder={odoo.connected ? "•••••••• (enregistrée)" : "Clé API de l'utilisateur"}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Odoo → Préférences → Sécurité → Clés API. Les identifiants sont vérifiés avant enregistrement.
            </p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleConnect} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
              {odoo.connected ? "Mettre à jour" : "Connecter"}
            </Button>
            {odoo.connected && (
              <Button variant="ghost" onClick={handleDisconnect} disabled={busy}>
                Déconnecter
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Accès aux modules par département
          </p>
          <p className="text-xs text-muted-foreground">
            Les agents d'un département ne lisent que les modules cochés ici.
          </p>
          {allDepartments.map((d) => {
            const active = effectiveModules(d.key);
            const open = openDept === d.key;
            return (
              <div key={d.key} className="rounded-xl border border-border">
                <Button variant="ghost"
                  onClick={() => setOpenDept(open ? null : d.key)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                >
                  <span className="text-sm font-medium">{d.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {active.length} module(s)
                  </span>
                </Button>
                {open && (
                  <div className="space-y-1 border-t border-border p-2">
                    {ODOO_MODULES.map((m) => {
                      const checked = active.includes(m.key);
                      return (
                        <Button variant="ghost"
                          key={m.key}
                          onClick={() => toggle(d.key, m.key)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                            checked ? "bg-secondary" : "hover:bg-secondary/60",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                            )}
                          >
                            {checked && <Check className="size-3" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm">{m.label}</span>
                            <span className="block truncate text-xs text-muted-foreground">{m.blurb}</span>
                          </span>
                        </Button>
                      );
                    })}
                    <Button size="sm" className="mt-1 w-full" onClick={() => handleSaveModules(d.key)}>
                      Enregistrer les accès
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
