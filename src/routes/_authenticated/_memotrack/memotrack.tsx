import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, Clock, CalendarCheck, Gavel, ListChecks,
  Sparkles, AlertTriangle, Smile, Meh, Frown, ChevronRight, Target,
} from "lucide-react";
import { AppHeader } from "@/components/memotrack/AppHeader";
import { UploadCard } from "@/components/memotrack/UploadCard";
import { Ring, TrendChart, Bars } from "@/components/memotrack/charts";
import { useMeetings, avg, tone, toneText, fmtDate, type Meeting } from "@/lib/meetings";

export const Route = createFileRoute("/_authenticated/_memotrack/memotrack")({
  head: () => ({
    meta: [
      { title: "Studio Board — MemoTrack" },
      { name: "description", content: "KPI d'efficacité de vos réunions, tendances et mémos." },
      { property: "og:title", content: "Studio Board — MemoTrack" },
      { property: "og:description", content: "Pilotez la performance de vos réunions." },
    ],
  }),
  component: Studio,
});

const RANGES = [
  { key: "all", label: "Tout" },
  { key: "90", label: "90 j" },
  { key: "30", label: "30 j" },
] as const;

const DIMS = [
  { key: "score_efficiency", label: "Efficacité" },
  { key: "score_clarity", label: "Clarté" },
  { key: "score_engagement", label: "Engagement" },
  { key: "score_decision", label: "Décision" },
] as const;

function Delta({ v, suffix = "" }: { v: number | null; suffix?: string }) {
  if (v === null) return <span className="text-xs text-muted-foreground">—</span>;
  const r = Math.round(v * 10) / 10;
  const Icon = r > 0 ? TrendingUp : r < 0 ? TrendingDown : Minus;
  const c = r > 0 ? "text-good" : r < 0 ? "text-bad" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${c}`}>
      <Icon className="size-3.5" /> {r > 0 ? "+" : ""}{r}{suffix}
    </span>
  );
}

function Stat({ icon: Icon, label, value, delta, hint, color }: {
  icon: typeof Clock; label: string; value: string; delta: React.ReactNode; hint: string; color: string;
}) {
  return (
    <div className="glass rise flex flex-col justify-between p-5" title={hint}>
      <div className="flex items-center justify-between">
        <span className="flex size-9 items-center justify-center rounded-xl bg-glass" style={{ color }}>
          <Icon className="size-4.5" />
        </span>
        {delta}
      </div>
      <div className="mt-4">
        <div className="font-display text-3xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function Studio() {
  const { data = [], isLoading } = useMeetings();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");

  const list = useMemo(() => {
    if (range === "all") return data;
    const since = Date.now() - Number(range) * 864e5;
    return data.filter((m) => new Date(m.meeting_date).getTime() >= since);
  }, [data, range]);

  const k = useMemo(() => {
    const half = Math.floor(list.length / 2);
    const prev = list.slice(0, half), cur = list.slice(half);
    const cmp = (f: (xs: Meeting[]) => number) => (prev.length ? f(cur) - f(prev) : null);
    const g = (xs: Meeting[]) => avg(xs.map((m) => m.score_global));
    const dec = (xs: Meeting[]) => avg(xs.map((m) => (m.decisions as unknown[]).length));
    const act = (xs: Meeting[]) => avg(xs.map((m) => (m.actions as unknown[]).length));
    const dur = (xs: Meeting[]) => avg(xs.map((m) => m.duration_min));
    const dims = DIMS.map((d) => ({ ...d, value: avg(list.map((m) => m[d.key])), delta: cmp((xs) => avg(xs.map((m) => m[d.key]))) }));
    const sorted = [...dims].sort((a, b) => b.value - a.value);
    const sentiment = { positif: 0, neutre: 0, tendu: 0 } as Record<string, number>;
    list.forEach((m) => { sentiment[m.sentiment] = (sentiment[m.sentiment] ?? 0) + 1; });
    const cats: Record<string, number> = {};
    list.forEach((m) => { cats[m.category] = (cats[m.category] ?? 0) + 1; });
    const totalMin = list.reduce((a, m) => a + m.duration_min, 0);
    const totalDec = list.reduce((a, m) => a + (m.decisions as unknown[]).length, 0);
    return {
      global: g(list), globalDelta: cmp(g),
      decisions: dec(list), decDelta: cmp(dec),
      actions: act(list), actDelta: cmp(act),
      duration: dur(list), durDelta: cmp(dur),
      totalMin, dims, best: sorted[0]!, worst: sorted[sorted.length - 1]!, sentiment,
      cats: Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 5),
      decPerHour: totalMin ? (totalDec / totalMin) * 60 : 0,
    };
  }, [list]);

  const risks = list.slice(-5).flatMap((m) => (m.risks as string[]).map((r) => ({ r, m }))).slice(-4).reverse();

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 md:px-6">
      <AppHeader />

      <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Studio <span className="holo-text">Board</span></h1>
          <p className="mt-1 text-sm text-muted-foreground">{list.length} réunion{list.length > 1 ? "s" : ""} analysée{list.length > 1 ? "s" : ""} · comparaison période récente vs précédente</p>
        </div>
        <div className="glass flex rounded-full p-1">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${range === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid auto-rows-[minmax(150px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Global score */}
        <div className="glass holo-border rise flex flex-col justify-between p-6 sm:col-span-2 lg:row-span-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-muted-foreground"><Target className="size-4 text-primary" /> Indice de performance</span>
            <Delta v={k.globalDelta} suffix=" pts" />
          </div>
          <div className="flex flex-col items-center gap-6 py-4 md:flex-row md:justify-around">
            <Ring value={k.global} size={150} />
            <div className="grid grid-cols-2 gap-4">
              {k.dims.map((d) => <Ring key={d.key} value={d.value} size={70} label={d.label} />)}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="text-good">●</span> ≥75 performant · <span className="text-warn">●</span> 50–74 à consolider · <span className="text-bad">●</span> &lt;50 critique
          </p>
        </div>

        <div className="sm:col-span-2 lg:row-span-2"><UploadCard /></div>

        <Stat icon={CalendarCheck} label="Réunions analysées" value={String(list.length)} color="var(--holo-1)"
          delta={<span className="text-xs text-muted-foreground">{Math.round(k.totalMin / 60 * 10) / 10} h cumulées</span>} hint="Volume de réunions" />
        <Stat icon={Clock} label="Durée moyenne (min)" value={String(Math.round(k.duration))} color="var(--holo-3)"
          delta={<Delta v={k.durDelta === null ? null : -k.durDelta} suffix=" min gagnées" />} hint="Plus court = mieux, à décisions égales" />
        <Stat icon={Gavel} label="Décisions / réunion" value={k.decisions.toFixed(1)} color="var(--holo-4)"
          delta={<Delta v={k.decDelta} />} hint="Capacité à trancher" />
        <Stat icon={ListChecks} label="Actions / réunion" value={k.actions.toFixed(1)} color="var(--holo-2)"
          delta={<Delta v={k.actDelta} />} hint="Passage à l'exécution" />

        {/* Trend */}
        <div className="glass rise p-6 sm:col-span-2 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Évolution de la performance</h2>
            <span className="text-xs text-muted-foreground">Indice global par réunion</span>
          </div>
          <TrendChart points={list.map((m) => ({ label: `${m.title} · ${fmtDate(m.meeting_date)}`, value: m.score_global }))} />
        </div>

        {/* Insights */}
        <div className="glass rise flex flex-col gap-4 p-6 sm:col-span-2 lg:col-span-1">
          <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> Insights</h2>
          {list.length ? (
            <>
              <div className="rounded-xl bg-glass p-3">
                <div className="text-xs text-muted-foreground">Point fort</div>
                <div className="font-semibold text-good">{k.best.label} · {Math.round(k.best.value)}</div>
              </div>
              <div className="rounded-xl bg-glass p-3">
                <div className="text-xs text-muted-foreground">Levier de progression</div>
                <div className="font-semibold text-warn">{k.worst.label} · {Math.round(k.worst.value)}</div>
              </div>
              <div className="rounded-xl bg-glass p-3">
                <div className="text-xs text-muted-foreground">Vélocité décisionnelle</div>
                <div className="font-semibold">{k.decPerHour.toFixed(1)} décisions / heure</div>
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground">Importez votre première réunion pour activer les insights.</p>}
        </div>

        {/* Sentiment */}
        <div className="glass rise p-6 sm:col-span-1">
          <h2 className="font-semibold">Climat</h2>
          <div className="mt-5 flex justify-around">
            {[
              { k: "positif", I: Smile, c: "text-good" },
              { k: "neutre", I: Meh, c: "text-warn" },
              { k: "tendu", I: Frown, c: "text-bad" },
            ].map(({ k: s, I, c }) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <I className={`size-7 ${c}`} />
                <span className="font-display text-xl font-semibold">{k.sentiment[s]}</span>
                <span className="text-xs capitalize text-muted-foreground">{s}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="glass rise p-6 sm:col-span-1">
          <h2 className="mb-4 font-semibold">Thématiques</h2>
          {k.cats.length ? (
            <Bars items={k.cats.map(([label, value], i) => ({ label, value, color: `var(--holo-${(i % 4) + 1})` }))} />
          ) : <p className="text-sm text-muted-foreground">Aucune donnée.</p>}
        </div>

        {/* Dimension evolution */}
        <div className="glass rise p-6 sm:col-span-2">
          <h2 className="mb-4 font-semibold">Évolution par dimension</h2>
          <div className="grid grid-cols-2 gap-3">
            {k.dims.map((d) => (
              <div key={d.key} className="rounded-xl bg-glass p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">{d.label} <Delta v={d.delta} /></div>
                <div className={`font-display text-2xl font-semibold ${toneText[tone(d.value)]}`}>{Math.round(d.value)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Memos list */}
        <div className="glass rise p-6 sm:col-span-2 lg:col-span-3">
          <h2 className="mb-3 font-semibold">Mémos récents</h2>
          {isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun mémo pour l'instant.</p>
          ) : (
            <ul className="divide-y divide-border">
              {[...list].reverse().slice(0, 8).map((m) => (
                <li key={m.id}>
                  <Link to="/memo/$id" params={{ id: m.id }} className="group flex items-center gap-4 py-3">
                    <span className={`font-display w-10 text-lg font-semibold ${toneText[tone(m.score_global)]}`}>{m.score_global}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.title}</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(m.meeting_date)} · {m.category} · {m.duration_min} min</div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Risks */}
        <div className="glass rise p-6 sm:col-span-2 lg:col-span-1">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-warn" /> Vigilance</h2>
          {risks.length ? (
            <ul className="space-y-3">
              {risks.map(({ r, m }, i) => (
                <li key={i} className="text-sm">
                  <span>{r}</span>
                  <div className="text-xs text-muted-foreground">{m.title}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Aucun risque signalé.</p>}
        </div>
      </div>
    </main>
  );
}
