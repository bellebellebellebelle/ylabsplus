export function money(value: number | string | null | undefined, currency?: string | null) {
  const n = Number(value ?? 0);
  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `${formatted} ${currency || "EUR"}`;
}

export function daysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00Z").getTime();
  return Math.floor((Date.now() - due) / 86400000);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR");
}
