import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plug, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/angelo-format";
import { testAndSaveOdooConnection } from "@/lib/angelo.functions";

export const Route = createFileRoute("/_authenticated/_angelo/connexion-odoo")({
  head: () => ({
    meta: [
      { title: "Connexion Odoo — ANGELO" },
      { name: "description", content: "Connectez votre base Odoo : ventes, facturation et comptabilité." },
      { property: "og:title", content: "Connexion Odoo — ANGELO" },
      { property: "og:description", content: "Reliez ANGELO à Odoo en quelques secondes avec une clé API." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OdooPage,
});

function OdooPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ url: "", db_name: "", username: "", api_key: "" });
  const [busy, setBusy] = useState(false);

  const connection = useQuery({
    queryKey: ["odoo_connection", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("odoo_connections").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const c = connection.data;
    if (c) {
      setForm({ url: c.url ?? "", db_name: c.db ?? "", username: c.username ?? "", api_key: "" });
    }
  }, [connection.data]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await testAndSaveOdooConnection({ data: form });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      qc.invalidateQueries({ queryKey: ["odoo_connection"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  const c = connection.data;
  const modules = (c?.modules ?? {}) as Record<string, boolean>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connexion Odoo</h1>
        <p className="text-sm text-muted-foreground">
          ANGELO lit vos ventes, factures et écritures comptables, et envoie les relances via la messagerie
          native d'Odoo.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="size-5" /> Identifiants
            </CardTitle>
            <CardDescription>La clé API reste stockée côté serveur.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">URL de l'instance</Label>
                <Input
                  id="url"
                  required
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://masociete.odoo.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="db">Base de données</Label>
                <Input
                  id="db"
                  required
                  value={form.db_name}
                  onChange={(e) => setForm({ ...form, db_name: e.target.value })}
                  placeholder="masociete"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user">Utilisateur (email Odoo)</Label>
                <Input
                  id="user"
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="admin@masociete.fr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key">Clé API</Label>
                <Input
                  id="key"
                  type="password"
                  required
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder="••••••••••••"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Test en cours…" : "Tester et enregistrer"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>État</CardTitle>
            <CardDescription>
              {c?.last_tested_at ? `Dernier test : ${formatDateTime(c.last_tested_at)}` : "Jamais testé"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex items-center gap-2">
              {c?.status === "connected" ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <XCircle className="size-4 text-destructive" />
              )}
              {c?.status === "connected" ? "Connecté à Odoo" : c?.status_message || "Non connecté"}
            </p>
            <div className="space-y-1">
              {["account.move", "sale.order", "account.move.line", "mail.message", "res.partner"].map((m) => (
                <p key={m} className="flex items-center gap-2 text-xs text-muted-foreground">
                  {modules[m] ? (
                    <CheckCircle2 className="size-3.5 text-success" />
                  ) : (
                    <XCircle className="size-3.5 text-muted-foreground" />
                  )}
                  {m}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
