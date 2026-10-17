import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { money, formatDate, daysOverdue } from "@/lib/angelo-format";
import { syncNow, sendReminderNow } from "@/lib/angelo.functions";

export const Route = createFileRoute("/_authenticated/_angelo/factures")({
  head: () => ({
    meta: [
      { title: "Factures impayées — ANGELO" },
      { name: "description", content: "Liste des factures Odoo impayées avec relance manuelle par email." },
      { property: "og:title", content: "Factures impayées — ANGELO" },
      { property: "og:description", content: "Filtrez vos impayés et relancez un client en un clic." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvoicesPage,
});

type Filter = "all" | "overdue" | "soon";

function InvoicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sending, setSending] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const invoices = useQuery({
    queryKey: ["invoices", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices_cache")
        .select("*")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (invoices.data ?? []).filter((inv) => {
      const late = daysOverdue(inv.due_date);
      if (filter === "overdue" && late <= 0) return false;
      if (filter === "soon" && late > 0) return false;
      if (!term) return true;
      return (
        String(inv.partner_name ?? "").toLowerCase().includes(term) ||
        String(inv.name ?? "").toLowerCase().includes(term)
      );
    });
  }, [invoices.data, search, filter]);

  async function doSync() {
    setSyncing(true);
    try {
      const res = await syncNow({ data: undefined });
      toast.success(`${res.total} factures synchronisées.`);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Synchronisation impossible");
    } finally {
      setSyncing(false);
    }
  }

  async function relance(odooId: number) {
    setSending(odooId);
    try {
      await sendReminderNow({ data: { odooId } });
      toast.success("Relance envoyée depuis Odoo.");
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Factures impayées</h1>
          <p className="text-sm text-muted-foreground">{rows.length} facture(s) affichée(s)</p>
        </div>
        <Button variant="outline" onClick={doSync} disabled={syncing}>
          <RefreshCw className="size-4" /> {syncing ? "Synchronisation…" : "Synchroniser"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un client ou un numéro…"
          className="max-w-xs"
        />
        {(["all", "overdue", "soon"] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "Toutes" : f === "overdue" ? "En retard" : "À échoir"}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {rows.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Aucune facture. Connectez Odoo puis lancez une synchronisation.
            </CardContent>
          </Card>
        )}
        {rows.map((inv) => {
          const late = daysOverdue(inv.due_date);
          return (
            <Card key={inv.id}>
              <CardContent className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-[180px] flex-1">
                  <p className="font-medium">{inv.partner_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.name} · échéance {formatDate(inv.due_date)}
                  </p>
                  <p className="text-xs text-muted-foreground">{inv.partner_email || "Aucun email client"}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{money(inv.amount_residual, inv.currency)}</p>
                  {late > 0 ? (
                    <Badge variant="destructive">{late} j de retard</Badge>
                  ) : (
                    <Badge variant="secondary">À échoir</Badge>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {inv.reminder_count ?? 0} relance(s)
                </div>
                <Button
                  size="sm"
                  disabled={sending !== null || !inv.partner_email}
                  onClick={() => relance(inv.odoo_id)}
                >
                  <Send className="size-4" />
                  {sending === inv.odoo_id ? "Envoi…" : "Relancer"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
