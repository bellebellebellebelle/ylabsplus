import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Gavel, ListChecks, AlertTriangle, ArrowRightCircle, Users, Trash2, FileText, Copy } from "lucide-react";
import { AppHeader } from "@/components/memotrack/AppHeader";
import { Ring } from "@/components/memotrack/charts";
import { supabase } from "@/integrations/supabase/client";
import { useMeetings, fmtDate, type Action, type Topic } from "@/lib/meetings";

export const Route = createFileRoute("/_authenticated/_memotrack/memo/$id")({
  head: () => ({
    meta: [
      { title: "Mémo de réunion — MemoTrack" },
      { name: "description", content: "Mémo structuré : résumé, décisions, actions et scores." },
      { property: "og:title", content: "Mémo de réunion — MemoTrack" },
      { property: "og:description", content: "Mémo structuré de réunion." },
    ],
  }),
  component: MemoPage,
});

function Section({ icon: Icon, title, color, children }: { icon: typeof Gavel; title: string; color: string; children: React.ReactNode }) {
  return (
    <section className="glass rise p-6">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><Icon className="size-4" style={{ color }} /> {title}</h2>
      {children}
    </section>
  );
}

function MemoPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { data, isLoading } = useMeetings();
  const [showT, setShowT] = useState(false);
  const m = data?.find((x) => x.id === id);

  if (isLoading) return <main className="mx-auto max-w-5xl px-4"><AppHeader /><p className="text-muted-foreground">Chargement…</p></main>;
  if (!m) return <main className="mx-auto max-w-5xl px-4"><AppHeader /><p className="text-muted-foreground">Mémo introuvable.</p></main>;

  const decisions = m.decisions as string[];
  const actions = m.actions as Action[];
  const topics = m.topics as Topic[];
  const risks = m.risks as string[];
  const next = m.next_steps as string[];
  const people = m.participants as string[];

  const copy = () => {
    const txt = [
      `# ${m.title}`, fmtDate(m.meeting_date), "", m.summary, "",
      "## Décisions", ...decisions.map((d) => `- ${d}`), "",
      "## Actions", ...actions.map((a) => `- ${a.task} (${a.owner || "—"}, ${a.deadline || "—"})`), "",
      "## Prochaines étapes", ...next.map((n) => `- ${n}`),
    ].join("\n");
    navigator.clipboard.writeText(txt);
  };
  const remove = async () => {
    if (!confirm("Supprimer ce mémo ?")) return;
    await supabase.from("meetings").delete().eq("id", m.id);
    nav({ to: "/memotrack" });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      <AppHeader />
      <Link to="/memotrack" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Studio Board</Link>

      <div className="glass holo-border rise grid gap-6 p-6 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-glass px-3 py-1">{m.category}</span>
            <span className="rounded-full bg-glass px-3 py-1">{fmtDate(m.meeting_date)}</span>
            <span className="rounded-full bg-glass px-3 py-1">{m.duration_min} min</span>
            <span className={`rounded-full bg-glass px-3 py-1 capitalize ${m.sentiment === "positif" ? "text-good" : m.sentiment === "tendu" ? "text-bad" : "text-warn"}`}>{m.sentiment}</span>
          </div>
          <h1 className="mt-4 text-3xl font-semibold">{m.title}</h1>
          <p className="mt-3 leading-relaxed text-muted-foreground">{m.summary}</p>
          {people.length > 0 && (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm"><Users className="size-4 text-primary" />{people.join(" · ")}</p>
          )}
          <div className="mt-5 flex gap-2">
            <button onClick={copy} className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs"><Copy className="size-3.5" /> Copier</button>
            <button onClick={remove} className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs text-bad"><Trash2 className="size-3.5" /> Supprimer</button>
          </div>
        </div>
        <div className="flex flex-col items-center gap-4">
          <Ring value={m.score_global} size={130} label="Indice global" />
          <div className="grid grid-cols-4 gap-2 md:grid-cols-2">
            <Ring value={m.score_efficiency} size={58} label="Efficacité" />
            <Ring value={m.score_clarity} size={58} label="Clarté" />
            <Ring value={m.score_engagement} size={58} label="Engagement" />
            <Ring value={m.score_decision} size={58} label="Décision" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Section icon={Gavel} title="Décisions" color="var(--good)">
          {decisions.length ? <ul className="space-y-2 text-sm">{decisions.map((d, i) => <li key={i} className="flex gap-2"><span className="text-good">✓</span>{d}</li>)}</ul>
            : <p className="text-sm text-muted-foreground">Aucune décision formelle.</p>}
        </Section>
        <Section icon={ListChecks} title="Plan d'actions" color="var(--holo-2)">
          {actions.length ? (
            <ul className="space-y-3 text-sm">{actions.map((a, i) => (
              <li key={i} className="rounded-xl bg-glass p-3">
                <div>{a.task}</div>
                <div className="mt-1 text-xs text-muted-foreground">{a.owner || "Non assigné"} · {a.deadline || "Sans échéance"}</div>
              </li>))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Aucune action assignée.</p>}
        </Section>
      </div>

      {topics.length > 0 && (
        <div className="mt-4">
          <Section icon={FileText} title="Sujets abordés" color="var(--holo-1)">
            <div className="grid gap-4 md:grid-cols-2">
              {topics.map((t, i) => (
                <div key={i}>
                  <h3 className="font-medium">{t.title}</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{(t.points ?? []).map((p, j) => <li key={j}>{p}</li>)}</ul>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Section icon={AlertTriangle} title="Risques & points de vigilance" color="var(--warn)">
          {risks.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            : <p className="text-sm text-muted-foreground">Aucun risque identifié.</p>}
        </Section>
        <Section icon={ArrowRightCircle} title="Prochaines étapes" color="var(--holo-3)">
          {next.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{next.map((r, i) => <li key={i}>{r}</li>)}</ul>
            : <p className="text-sm text-muted-foreground">—</p>}
        </Section>
      </div>

      <div className="glass mt-4 p-6">
        <button onClick={() => setShowT(!showT)} className="text-sm font-medium text-primary">{showT ? "Masquer" : "Afficher"} la transcription</button>
        {showT && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{m.transcript}</p>}
      </div>
    </main>
  );
}
