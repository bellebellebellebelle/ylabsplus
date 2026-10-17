import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { wsGmailList, wsCalendarUpcoming, wsTasks, wsDriveList } from "@/lib/workspace.functions";
import { Mail, Calendar, CheckSquare, HardDrive, Bot, ArrowRight, Activity, Sparkles, Cloud } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/")({
  component: Cockpit,
});

function Cockpit() {
  const { data: gmailStatus } = useQuery({
    queryKey: ["gmail-status"],
    queryFn: async () => (await supabase.from("gmail_connection_status").select("*").maybeSingle()).data,
  });
  const hasGoogle = !!gmailStatus;

  const listMails = useServerFn(wsGmailList);
  const listEvents = useServerFn(wsCalendarUpcoming);
  const listTasks = useServerFn(wsTasks);
  const listFiles = useServerFn(wsDriveList);

  const mails = useQuery({
    queryKey: ["dash-mails"], enabled: hasGoogle,
    queryFn: () => listMails({ data: { query: "is:unread", max: 5 } }),
  });
  const events = useQuery({
    queryKey: ["dash-events"], enabled: hasGoogle,
    queryFn: () => listEvents({ data: { max: 5 } }),
  });
  const tasks = useQuery({
    queryKey: ["dash-tasks"], enabled: hasGoogle,
    queryFn: () => listTasks({ data: {} }),
  });
  const files = useQuery({
    queryKey: ["dash-files"], enabled: hasGoogle,
    queryFn: () => listFiles({ data: { max: 5 } }),
  });

  const { data: actions } = useQuery({
    queryKey: ["actions-log", "dash"],
    queryFn: async () => (await supabase.from("agent_actions_log").select("*").order("created_at", { ascending: false }).limit(5)).data,
    refetchInterval: 5000,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border/60 px-8 py-6">
        <div>
          <h1 className="font-display text-3xl font-semibold"><span className="ock-holo-text">Cockpit</span></h1>
          <p className="text-sm text-muted-foreground">Pilote tout ton Google Workspace en autonomie.</p>
        </div>
        <Link to="/ocktavus/agent" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-primary-foreground holo-glow"
          style={{ background: "linear-gradient(135deg, var(--holo), var(--holo-2))" }}>
          <Sparkles className="h-4 w-4" /> Parler à OCKTAVUS
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {!hasGoogle ? (
          <div className="bento mx-auto max-w-2xl p-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl holo-glow" style={{ background: "linear-gradient(135deg, var(--holo), var(--holo-2))" }}>
              <Cloud className="h-6 w-6 text-primary-foreground" />
            </div>
            <h2 className="font-display text-2xl">Connecte ton Google Workspace</h2>
            <p className="mt-2 text-sm text-muted-foreground">OCKTAVUS a besoin d'accéder à Gmail, Agenda, Drive, Docs, Sheets, Tâches et Contacts pour agir en ton nom.</p>
            <Link to="/settings" search={{ tab: "google" }} className="mt-5 inline-flex items-center gap-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground holo-glow">
              Connecter Google <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="mx-auto grid max-w-6xl auto-rows-min grid-cols-1 gap-4 md:grid-cols-6">
            {/* Mails */}
            <BentoCard className="md:col-span-3" icon={Mail} title="Emails non lus" to="/ocktavus/gmail" count={mails.data?.emails?.length}>
              <ul className="mt-3 space-y-2">
                {(mails.data?.emails ?? []).slice(0, 4).map((m: any) => (
                  <li key={m.id} className="truncate rounded-lg bg-white/5 px-3 py-2 text-sm">
                    <p className="truncate font-medium">{m.subject || "(sans objet)"}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.from}</p>
                  </li>
                ))}
                {mails.isLoading && <div className="shimmer h-10 rounded-lg" />}
                {!mails.isLoading && (mails.data?.emails ?? []).length === 0 && <p className="text-sm text-muted-foreground">Inbox à zéro 🎉</p>}
              </ul>
            </BentoCard>

            {/* Events */}
            <BentoCard className="md:col-span-3" icon={Calendar} title="Prochains rendez-vous" to="/ocktavus/calendar" count={events.data?.items?.length}>
              <ul className="mt-3 space-y-2">
                {(events.data?.items ?? []).slice(0, 4).map((e: any) => (
                  <li key={e.id} className="rounded-lg bg-white/5 px-3 py-2 text-sm">
                    <p className="truncate font-medium">{e.summary || "(sans titre)"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.start?.dateTime ?? e.start?.date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </li>
                ))}
                {events.isLoading && <div className="shimmer h-10 rounded-lg" />}
                {!events.isLoading && (events.data?.items ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucun événement à venir.</p>}
              </ul>
            </BentoCard>

            {/* Tasks */}
            <BentoCard className="md:col-span-2" icon={CheckSquare} title="Tâches du jour" to="/ocktavus/tasks" count={tasks.data?.items?.length}>
              <ul className="mt-3 space-y-1.5">
                {(tasks.data?.items ?? []).slice(0, 5).map((t: any) => (
                  <li key={t.id} className="truncate text-sm">• {t.title}</li>
                ))}
                {!tasks.isLoading && (tasks.data?.items ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucune tâche.</p>}
              </ul>
            </BentoCard>

            {/* Files */}
            <BentoCard className="md:col-span-2" icon={HardDrive} title="Fichiers récents" to="/ocktavus/drive" count={files.data?.files?.length}>
              <ul className="mt-3 space-y-1.5">
                {(files.data?.files ?? []).slice(0, 5).map((f: any) => (
                  <li key={f.id} className="truncate text-sm"><a href={f.webViewLink} target="_blank" rel="noreferrer" className="hover:underline">{f.name}</a></li>
                ))}
              </ul>
            </BentoCard>

            {/* Agent activity */}
            <BentoCard className="md:col-span-2" icon={Activity} title="Activité de l'agent" to="/ocktavus/journal" count={actions?.length}>
              <ul className="mt-3 space-y-1.5">
                {(actions ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${a.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
                    <span className="truncate font-mono text-foreground/85">{a.tool_name}</span>
                    <span className="ml-auto">{new Date(a.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </li>
                ))}
                {!actions?.length && <p className="text-sm text-muted-foreground">Pas encore d'action.</p>}
              </ul>
            </BentoCard>

            <BentoCard className="md:col-span-6" icon={Bot} title="Agent OCKTAVUS" to="/ocktavus/agent">
              <p className="mt-2 text-sm text-muted-foreground">
                Discute en langage naturel, par texte ou avec le bouton vocal (en bas à droite), depuis l'app ou Google Chat. L'agent enchaîne les outils Workspace pour exécuter tes demandes en autonomie.
              </p>
            </BentoCard>
          </div>
        )}
      </div>
    </div>
  );
}

function BentoCard({ icon: Icon, title, count, to, children, className = "" }: any) {
  return (
    <div className={`bento p-5 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground/90">{title}</span>
          {typeof count === "number" && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">{count}</span>}
        </div>
        {to && <Link to={to} className="text-xs text-primary hover:underline">Ouvrir →</Link>}
      </div>
      {children}
    </div>
  );
}
