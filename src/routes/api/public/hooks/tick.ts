import { createFileRoute } from "@tanstack/react-router";

// Called by pg_cron every minute.
// Auth: SUPABASE anon key in `apikey` header.
// Route is under /api/public/* so we re-check defensively.

// Retry policy for cron-triggered runs (does NOT affect manual executions,
// which never provide a triggerId and don't touch the triggers table).
const MAX_ATTEMPTS = 5;
// Exponential backoff in seconds: 1min, 2min, 5min, 15min, 30min (capped).
const BACKOFF_SECONDS = [60, 120, 300, 900, 1800];

function backoffNextRun(failures: number): string {
  const idx = Math.max(0, Math.min(failures - 1, BACKOFF_SECONDS.length - 1));
  return new Date(Date.now() + BACKOFF_SECONDS[idx] * 1000).toISOString();
}

export const Route = createFileRoute("/api/public/hooks/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const tickStart = Date.now();
        const apikey = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { executeAutomation } = await import("@/lib/run-agent.server");
        const { computeNextRun } = await import("@/lib/cron");

        const nowIso = new Date().toISOString();
        const { data: due, error } = await supabaseAdmin
          .from("triggers")
          .select("id, automation_id, cron_expr, type, consecutive_failures, automations!inner(id, user_id, status)")
          .eq("enabled", true)
          .lte("next_run_at", nowIso)
          .limit(20);

        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

        const dueRows = (due ?? []).filter((t) => {
          const a = (t as unknown as { automations: { status: string } }).automations;
          return a && a.status === "active";
        });

        const launched: string[] = [];
        const results: Array<{
          triggerId: string;
          executionId?: string;
          status: "success" | "error";
          error?: string;
          attempts?: number;
          retryAt?: string;
          disabled?: boolean;
        }> = [];

        for (const trig of dueRows) {
          const t = trig as unknown as {
            id: string;
            automation_id: string;
            cron_expr: string | null;
            consecutive_failures: number | null;
            automations: { user_id: string; id: string };
          };
          launched.push(t.id);

          // Pre-schedule the next run at the normal cron slot so a long-running
          // execution cannot be duplicated by the next tick. On failure we
          // override this with a backoff timestamp below.
          const normalNext = t.cron_expr ? computeNextRun(t.cron_expr).toISOString() : new Date(Date.now() + 5 * 60_000).toISOString();
          await supabaseAdmin.from("triggers").update({ last_run_at: nowIso, next_run_at: normalNext }).eq("id", t.id);

          try {
            const result = await executeAutomation(t.automation_id, t.automations.user_id, t.id);

            if (result.status === "error") {
              // executeAutomation already incremented consecutive_failures + last_error.
              const { data: tr } = await supabaseAdmin
                .from("triggers")
                .select("consecutive_failures")
                .eq("id", t.id)
                .maybeSingle();
              const attempts = tr?.consecutive_failures ?? ((t.consecutive_failures ?? 0) + 1);

              if (attempts >= MAX_ATTEMPTS) {
                // Give up: disable trigger and pause the automation so the user notices.
                await supabaseAdmin.from("triggers").update({ enabled: false }).eq("id", t.id);
                await supabaseAdmin.from("automations").update({ status: "paused" }).eq("id", t.automation_id);
                results.push({ triggerId: t.id, ...result, attempts, disabled: true });
              } else {
                const retryAt = backoffNextRun(attempts);
                // Override the pre-scheduled next_run_at with the backoff time
                // (only if the backoff is sooner than the natural cron slot,
                // otherwise keep the natural slot to avoid running LESS often).
                if (new Date(retryAt).getTime() < new Date(normalNext).getTime()) {
                  await supabaseAdmin.from("triggers").update({ next_run_at: retryAt }).eq("id", t.id);
                }
                results.push({ triggerId: t.id, ...result, attempts, retryAt });
              }
            } else {
              results.push({ triggerId: t.id, ...result });
            }
          } catch (e) {
            // Should be rare — executeAutomation catches internally. Treat as an error attempt.
            const message = e instanceof Error ? e.message : String(e);
            console.error("execution failed", t.id, e);
            const attempts = (t.consecutive_failures ?? 0) + 1;
            await supabaseAdmin.from("triggers").update({
              last_error: message,
              consecutive_failures: attempts,
              last_run_at: nowIso,
            }).eq("id", t.id);

            if (attempts >= MAX_ATTEMPTS) {
              await supabaseAdmin.from("triggers").update({ enabled: false }).eq("id", t.id);
              await supabaseAdmin.from("automations").update({ status: "paused" }).eq("id", t.automation_id);
              results.push({ triggerId: t.id, status: "error", error: message, attempts, disabled: true });
            } else {
              const retryAt = backoffNextRun(attempts);
              if (new Date(retryAt).getTime() < new Date(normalNext).getTime()) {
                await supabaseAdmin.from("triggers").update({ next_run_at: retryAt }).eq("id", t.id);
              }
              results.push({ triggerId: t.id, status: "error", error: message, attempts, retryAt });
            }
          }
        }


        // Journal du tick pour l'écran "Journal des ticks".
        try {
          // Enrich results with automation_id so the UI can filter per user's automations.
          const enriched = results.map((r) => {
            const trig = dueRows.find((d) => (d as unknown as { id: string }).id === r.triggerId) as unknown as { automation_id?: string } | undefined;
            return { ...r, automation_id: trig?.automation_id ?? null };
          });
          await supabaseAdmin.from("tick_logs").insert({
            duration_ms: Date.now() - tickStart,
            launched_count: launched.length,
            results: enriched as never,
          });
        } catch (e) {
          console.error("tick_logs insert failed", e);
        }

        return new Response(JSON.stringify({ launched, results, count: launched.length }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
