import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Send, Loader2, Wrench, User as UserIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/ocktavus/agent/$conversationId")({
  component: AgentConversation,
});

function AgentConversation() {
  const { conversationId } = Route.useParams();
  const { data: initial, isLoading } = useQuery({
    queryKey: ["agent-messages", conversationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_messages")
        .select("id, role, parts, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      return (data ?? []).map((m): UIMessage => ({ id: m.id, role: m.role as any, parts: m.parts as any }));
    },
  });

  if (isLoading) return <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return <AgentWindow key={conversationId} conversationId={conversationId} initial={initial ?? []} />;
}

function AgentWindow({ conversationId, initial }: { conversationId: string; initial: UIMessage[] }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: async ({ messages, body }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      return {
        body: { ...body, messages, threadId: conversationId, surface: "agent" },
        headers,
      };
    },
  }), [conversationId]);

  const { messages, sendMessage, status } = useChat({ transport, messages: initial });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages.length, status]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg holo-glow" style={{ background: "linear-gradient(135deg, var(--holo), var(--holo-2))" }}>
          <Bot className="h-4 w-4 text-primary-foreground" />
        </div>
        <h2 className="font-display text-lg">Agent OCKTAVUS</h2>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <div className="bento mx-auto max-w-2xl p-6 text-center">
            <p className="text-sm text-muted-foreground">Demande à OCKTAVUS d'envoyer un mail, planifier un rendez-vous, organiser ton Drive, etc. Il exécute en autonomie totale.</p>
          </div>
        )}
        {messages.map((m) => <MessageView key={m.id} m={m} />)}
        {(status === "submitted" || status === "streaming") && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> OCKTAVUS travaille…</div>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border/60 p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) submit(e as any); }}
            placeholder="Demande à OCKTAVUS d'exécuter une tâche…"
            rows={1}
            className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-card/60 px-4 py-2.5 text-sm outline-none focus:holo-glow"
          />
          <button type="submit" disabled={!input.trim() || status === "streaming"} className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground holo-glow disabled:opacity-50">
            {status === "streaming" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageView({ m }: { m: UIMessage }) {
  const isUser = m.role === "user";
  return (
    <div className={`mx-auto flex max-w-3xl gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isUser ? "bg-white/10" : "holo-glow"}`}
        style={!isUser ? { background: "linear-gradient(135deg, var(--holo), var(--holo-2))" } : undefined}>
        {isUser ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4 text-primary-foreground" />}
      </div>
      <div className={`flex-1 space-y-2 ${isUser ? "text-right" : ""}`}>
        {(m.parts as any[])?.map((p, i) => {
          if (p.type === "text") return (
            <div key={i} className={`inline-block max-w-full rounded-2xl px-4 py-2.5 text-sm ${isUser ? "bg-primary text-primary-foreground" : "bento"}`}>
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{p.text}</ReactMarkdown>
              </div>
            </div>
          );
          if (p.type?.startsWith?.("tool-")) {
            const name = p.type.replace(/^tool-/, "");
            const state = (p as any).state;
            return (
              <div key={i} className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-white/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                <Wrench className="h-3 w-3 text-primary" />
                <span className="font-mono">{name}</span>
                {state && <span className="text-[10px] uppercase opacity-60">{state}</span>}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
