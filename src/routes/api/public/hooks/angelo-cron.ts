import { createFileRoute } from "@tanstack/react-router";

type Schedule = {
  user_id: string;
  enabled: boolean;
  frequency: string;
  interval_minutes: number;
  hour_utc: number;
  minute_utc: number;
  weekday: number;
  day_of_month: number;
  last_run_at: string | null;
};

/** Décide si une planification doit être exécutée maintenant. */
export function isDue(schedule: Schedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  const last = schedule.last_run_at ? new Date(schedule.last_run_at) : null;
  const minutesSince = last ? (now.getTime() - last.getTime()) / 60000 : Infinity;

  if (schedule.frequency === "minutes" || schedule.frequency === "hourly") {
    return minutesSince >= Math.max(1, schedule.interval_minutes ?? 60);
  }

  const matchesTime =
    now.getUTCHours() === (schedule.hour_utc ?? 0) &&
    now.getUTCMinutes() >= (schedule.minute_utc ?? 0) &&
    now.getUTCMinutes() < (schedule.minute_utc ?? 0) + 10;

  if (!matchesTime) return false;
  // Évite les doublons dans la même fenêtre horaire.
  if (minutesSince < 60) return false;

  if (schedule.frequency === "weekly") return now.getUTCDay() === (schedule.weekday ?? 1);
  if (schedule.frequency === "monthly") return now.getUTCDate() === (schedule.day_of_month ?? 1);
  return true; // daily
}

export const Route = createFileRoute("/api/public/hooks/angelo-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAnalysis } = await import("@/lib/angelo-engine.server");

        const provided = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        const { data: tokenRow } = await supabaseAdmin
          .from("cron_tokens")
          .select("token")
          .eq("id", 1)
          .maybeSingle();
        if (!provided || !tokenRow?.token || provided !== tokenRow.token) {
          return new Response("Unauthorized", { status: 401 });
        }

        const now = new Date();
        const { data: schedules, error } = await supabaseAdmin
          .from("schedules")
          .select("*")
          .eq("enabled", true);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let executed = 0;

        for (const raw of schedules ?? []) {
          const schedule = raw as unknown as Schedule;
          if (!isDue(schedule, now)) continue;

          executed += 1;
          const startedAt = Date.now();
          try {
            const result = await runAnalysis(supabaseAdmin as never, schedule.user_id, "cron");
            await supabaseAdmin.from("cron_logs").insert({
              user_id: schedule.user_id,
              trigger: "cron",
              status: result.errors.length > 0 ? "partial" : "success",
              reason: result.errors.length > 0 ? result.errors.slice(0, 3).join(" | ") : null,
              frequency: schedule.frequency,
              invoices_found: result.total,
              overdue_found: result.overdue,
              reminders_sent: result.sent,
              duration_ms: Date.now() - startedAt,
            });
          } catch (e) {
            await supabaseAdmin.from("cron_logs").insert({
              user_id: schedule.user_id,
              trigger: "cron",
              status: "error",
              reason: e instanceof Error ? e.message : "Erreur inconnue",
              frequency: schedule.frequency,
              duration_ms: Date.now() - startedAt,
            });
          }

          await supabaseAdmin
            .from("schedules")
            .update({ last_run_at: new Date().toISOString() })
            .eq("user_id", schedule.user_id);
        }

        return new Response(
          JSON.stringify({ ok: true, checked: schedules?.length ?? 0, executed }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
