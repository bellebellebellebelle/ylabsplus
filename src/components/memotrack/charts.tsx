import { tone, toneVar } from "@/lib/meetings";

export function Ring({ value, size = 88, label }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const color = toneVar[tone(value)];
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--glass-border)" strokeWidth={7} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
            style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-semibold">{Math.round(value)}</span>
      </div>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

export function TrendChart({ points }: { points: { label: string; value: number }[] }) {
  const W = 600, H = 200, P = 24;
  if (points.length < 2)
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Ajoutez au moins 2 réunions pour voir la tendance.</div>;
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => H - P - (v / 100) * (H - 2 * P);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${H - P} L${x(0)},${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="tl" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--holo-1)" />
          <stop offset="50%" stopColor="var(--holo-2)" />
          <stop offset="100%" stopColor="var(--holo-3)" />
        </linearGradient>
        <linearGradient id="ta" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--holo-1)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--holo-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[25, 50, 75].map((g) => (
        <line key={g} x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="var(--glass-border)" strokeDasharray="3 5" />
      ))}
      <path d={area} fill="url(#ta)" />
      <path d={line} fill="none" stroke="url(#tl)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill={toneVar[tone(p.value)]}>
          <title>{`${p.label} — ${p.value}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function Bars({ items }: { items: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted-foreground">{i.label}</span>
            <span className="font-semibold">{i.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-glass">
            <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
