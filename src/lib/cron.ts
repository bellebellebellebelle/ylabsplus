// Cron helper utilities (client-safe).
const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"];

export function describeCron(expr: string | null | undefined): string {
  if (!expr) return "—";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [m, h, dom, mon, dow] = parts;
  if (expr === "* * * * *") return "Chaque minute";
  if (expr === "*/5 * * * *") return "Toutes les 5 minutes";
  if (expr === "0 * * * *") return "Chaque heure";
  if (expr === "0 9 * * *") return "Tous les jours à 9h00";
  if (expr === "0 0 * * *") return "Tous les jours à minuit";
  if (dom === "*" && mon === "*" && dow === "*" && h !== "*" && m !== "*") {
    return `Tous les jours à ${h.padStart(2, "0")}h${m.padStart(2, "0")}`;
  }
  return `${FIELD_NAMES.map((n, i) => `${n}=${parts[i]}`).join(" · ")}`;
}

// Tiny next-run estimator (minute precision, supports * and */N and exact values).
export function computeNextRun(expr: string, from = new Date()): Date {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(from.getTime() + 60_000);
  const matchers = parts.map(parseField);
  const d = new Date(from.getTime() + 60_000);
  d.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    if (
      matchers[0](d.getUTCMinutes()) &&
      matchers[1](d.getUTCHours()) &&
      matchers[2](d.getUTCDate()) &&
      matchers[3](d.getUTCMonth() + 1) &&
      matchers[4](d.getUTCDay())
    ) return d;
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return new Date(from.getTime() + 60_000);
}

function parseField(field: string): (v: number) => boolean {
  if (field === "*") return () => true;
  if (field.startsWith("*/")) { const n = parseInt(field.slice(2), 10); return (v) => v % n === 0; }
  const vals = field.split(",").map((s) => parseInt(s, 10));
  return (v) => vals.includes(v);
}
