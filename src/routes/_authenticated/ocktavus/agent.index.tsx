import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Plus, MessageSquare, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/agent/")({
  component: AgentIndex,
});

function AgentIndex() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: conversations } = useQuery({
    queryKey: ["agent-conversations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("agent-convs")
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["agent-conversations"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  async function createConversation() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data, error } = await supabase
      .from("agent_conversations")
      .insert({ user_id: u.user.id, title: "Nouvelle conversation" })
      .select("id")
      .single();
    if (error || !data) {
      console.error("create conversation failed", error);
      return;
    }
    await navigate({ to: "/ocktavus/agent/$conversationId", params: { conversationId: data.id } });
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Supprimer cette conversation ?")) return;
    await supabase.from("agent_messages").delete().eq("conversation_id", id);
    await supabase.from("agent_conversations").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["agent-conversations"] });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl holo-glow" style={{ background: "linear-gradient(135deg, var(--holo), var(--holo-2))" }}>
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl"><span className="ock-holo-text">OCKTAVUS</span></h1>
            <p className="text-sm text-muted-foreground">Agent autonome Google Workspace</p>
          </div>
        </div>
        <button onClick={createConversation} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground holo-glow">
          <Plus className="h-4 w-4" /> Nouvelle conversation
        </button>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2 lg:grid-cols-3">
        {(conversations ?? []).map((c) => (
          <Link
            key={c.id}
            to="/ocktavus/agent/$conversationId"
            params={{ conversationId: c.id }}
            className="group bento relative block p-5 transition hover:holo-glow"
          >
            <button
              onClick={(e) => deleteConversation(c.id, e)}
              className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg bg-black/30 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
              aria-label="Supprimer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MessageSquare className="h-4 w-4" /> {new Date(c.updated_at).toLocaleString("fr-FR")}
            </div>
            <p className="mt-2 line-clamp-2 font-medium pr-8">{c.title}</p>
          </Link>
        ))}
        {(conversations ?? []).length === 0 && (
          <div className="bento col-span-full p-10 text-center">
            <p className="text-sm text-muted-foreground">Aucune conversation. Démarre-en une nouvelle pour commencer.</p>
          </div>
        )}
      </div>
    </div>
  );
}
