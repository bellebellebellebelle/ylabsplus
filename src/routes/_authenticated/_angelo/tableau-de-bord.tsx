import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeEuro, FileWarning, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { money, formatDateTime, daysOverdue } from "@/lib/angelo-format";
import { syncNow, runAnalysisNow } from "@/lib/angelo.functions";

export const Route = createFileRoute("/_authenticated/_angelo/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — ANGELO" },
      { name: "description", content: "Vue d'ensemble des factures impayées et des relances ANGELO." },
      { property: "og:title", content: "Tableau de bord — ANGELO" },
      { property: "og:description", content: "Suivi en temps réel des impayés et des relances automatiques." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"sync" | "run" | null>(null);

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

  const runs = useQuery({
    queryKey: ["run_logs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("run_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices_cache" }, () => {
        qc.invalidateQueries({ queryKey: ["invoices"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "run_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["run_logs"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  const rows = invoices.data ?? [];
  const overdue = rows.filter((r) => daysOverdue(r.due_date) > 0);
  const totalDue = rows.reduce((s, r) => s + Number(r.amount_residual ?? 0), 0);
  const totalOverdue = overdue.reduce((s, r) => s + Number(r.amount_residual ?? 0), 0);
  const remindersSent = rows.reduce((s, r) => s + Number(r.reminder_count ?? 0), 0);

  async function doSync() {
    setBusy("sync");
    try {
      const res = await syncNow({ data: undefined });
      toast.success(`${res.total} factures synchronisées, ${res.overdue} en retard.`);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Synchronisation impossible");
    } finally {
      setBusy(null);
    }
  }

  async function doRun() {
    setBusy("run");
    try {
      const res = await runAnalysisNow({ data: undefined });
      toast.success(`Analyse terminée : ${res.sent ?? 0} relance(s) envoyée(s).`);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analyse impossible");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Vos impayés Odoo, suivis en direct.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={doSync} disabled={busy !== null}>
            <RefreshCw className="size-4" /> {busy === "sync" ? "Synchronisation…" : "Synchroniser"}
          </Button>
          <Button onClick={doRun} disabled={busy !== null}>
            <Send className="size-4" /> {busy === "run" ? "Analyse…" : "Lancer ANGELO"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Factures ouvertes" value={String(rows.length)} icon={<FileWarning className="size-4" />} />
        <Stat label="Factures en retard" value={String(overdue.length)} icon={<AlertTriangle className="size-4 text-warning" />} />
        <Stat label="Encours total" value={money(totalDue)} icon={<BadgeEuro className="size-4" />} />
        <Stat label="Montant en retard" value={money(totalOverdue)} icon={<BadgeEuro className="size-4 text-destructive" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Retards les plus importants</CardTitle>
            <CardDescription>{remindersSent} relance(s) envoyée(s) au total</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overdue.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun retard détecté pour le moment.</p>
            )}
            {[...overdue]
              .sort((a, b) => daysOverdue(b.due_date) - daysOverdue(a.due_date))
              .slice(0, 6)
              .map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.partner_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{inv.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{money(inv.amount_residual, inv.currency)}</p>
                    <p className="text-xs text-destructive">{daysOverdue(inv.due_date)} j de retard</p>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dernières exécutions</CardTitle>
            <CardDescription>Analyses manuelles et planifiées</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(runs.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Aucune exécution enregistrée.</p>
            )}
            {(runs.data ?? []).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize">{run.trigger}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(run.started_at)}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {run.reminders_sent ?? 0} envoi(s) · {run.status}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          {icon} {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
