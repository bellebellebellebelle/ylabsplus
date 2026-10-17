import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/angelo-format";

export const Route = createFileRoute("/_authenticated/_angelo/journal")({
  head: () => ({
    meta: [
      { title: "Journal — ANGELO" },
      { name: "description", content: "Historique des relances envoyées et des analyses exécutées." },
      { property: "og:title", content: "Journal — ANGELO" },
      { property: "og:description", content: "Traçabilité complète des emails de relance envoyés depuis Odoo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: JournalPage,
});

function JournalPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const logs = useQuery({
    queryKey: ["reminder_logs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reminder_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const runs = useQuery({
    queryKey: ["run_logs_all", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("run_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const crons = useQuery({
    queryKey: ["cron_logs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("journal-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "reminder_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["reminder_logs"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "run_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["run_logs_all"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cron_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["cron_logs"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm text-muted-foreground">Toutes les relances et exécutions, en temps réel.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Relances envoyées</CardTitle>
          <CardDescription>Emails expédiés par Odoo au nom de votre société</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(logs.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune relance pour le moment.</p>
          )}
          {(logs.data ?? []).map((log) => (
            <div key={log.id} className="space-y-1 border-b pb-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {log.partner_name} · {log.invoice_name}
                </p>
                <Badge variant={log.status === "sent" ? "secondary" : "destructive"}>
                  {log.status === "sent" ? `Niveau ${log.level}` : "Erreur"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{log.subject}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(log.created_at)} · {log.partner_email}
              </p>
              {log.error && <p className="text-xs text-destructive">{log.error}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exécutions</CardTitle>
          <CardDescription>Analyses manuelles et planifiées</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(runs.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune exécution enregistrée.</p>
          )}
          {(runs.data ?? []).map((run) => (
            <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
              <span className="capitalize">{run.trigger}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(run.started_at)}</span>
              <span className="text-xs text-muted-foreground">
                {run.invoices_found ?? 0} analysée(s) · {run.reminders_sent ?? 0} relance(s)
              </span>
              <Badge variant={run.status === "error" ? "destructive" : "secondary"}>{run.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Planifications automatiques</CardTitle>
          <CardDescription>Chaque passage programmé, avec son statut</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(crons.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun passage automatique pour le moment.</p>
          )}
          {(crons.data ?? []).map((c) => (
            <div key={c.id} className="space-y-1 border-b pb-2 text-sm last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{formatDateTime(c.created_at)}</span>
                <span className="text-xs text-muted-foreground">
                  {c.invoices_found ?? 0} facture(s) · {c.overdue_found ?? 0} en retard ·{" "}
                  {c.reminders_sent ?? 0} relance(s) · {Math.round((c.duration_ms ?? 0) / 1000)}s
                </span>
                <Badge
                  variant={
                    c.status === "error" ? "destructive" : c.status === "success" ? "secondary" : "outline"
                  }
                >
                  {c.status}
                </Badge>
              </div>
              {c.reason && <p className="text-xs text-destructive">{c.reason}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
