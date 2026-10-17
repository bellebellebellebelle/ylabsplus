import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsCalendarUpcoming } from "@/lib/workspace.functions";
import { Calendar, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/calendar")({ component: CalendarPage });

function CalendarPage() {
  const list = useServerFn(wsCalendarUpcoming);
  const events = useQuery({ queryKey: ["calendar"], queryFn: () => list({ data: { max: 50 } }) });

  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-6 flex items-center gap-3">
        <Calendar className="h-5 w-5 text-primary" />
        <h1 className="font-display text-2xl">Agenda</h1>
      </header>
      {events.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      <div className="mx-auto max-w-3xl space-y-2">
        {(events.data?.items ?? []).map((e: any) => (
          <div key={e.id} className="bento p-4">
            <p className="font-medium">{e.summary || "(sans titre)"}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(e.start?.dateTime ?? e.start?.date).toLocaleString("fr-FR")} — {new Date(e.end?.dateTime ?? e.end?.date).toLocaleString("fr-FR")}
            </p>
            {e.location && <p className="mt-1 text-xs text-muted-foreground">📍 {e.location}</p>}
            {e.description && <p className="mt-2 text-sm">{e.description}</p>}
          </div>
        ))}
        {!events.isLoading && !(events.data?.items ?? []).length && <p className="text-sm text-muted-foreground">Aucun événement.</p>}
      </div>
    </div>
  );
}
