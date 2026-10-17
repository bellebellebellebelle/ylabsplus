import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Send, Loader2, Sparkles, Wrench, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ocktavus/chat/$threadId")({
  component: ChatThread,
});

function ChatThread() {
  const { threadId } = Route.useParams();

  const { data: initialMessages, isLoading } = useQuery({
    queryKey: ["chat-messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, parts, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((m): UIMessage => ({
        id: m.id,
        role: m.role as UIMessage["role"],
        parts: m.parts as any,
      }));
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <ChatWindow key={threadId} threadId={threadId} initial={initialMessages ?? []} />;
}

function ChatWindow({ threadId, initial }: { threadId: string; initial: UIMessage[] }) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (url, init) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(init?.headers ?? {});
          if (token) headers.set("Authorization", `Bearer ${token}`);
          headers.set("Content-Type", "application/json");
          return fetch(url, { ...init, headers });
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, threadId },
        }),
      }),
    [threadId],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initial,
    transport,
    onError: (e) => toast.error(e.message ?? "Erreur de l'agent"),
  });

  useEffect(() => { inputRef.current?.focus(); }, [threadId, status]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="mx-auto max-w-md py-16 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 ring-1 ring-primary/30">
                <Bot className="h-7 w-7 text-primary" />
              </div>
              <h2 className="mt-4 font-display text-xl font-semibold">Comment puis-je t'aider ?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Demande-moi de résumer tes emails non lus, de chercher un message, ou de rédiger une réponse.
              </p>
              <div className="mt-6 grid gap-2 text-left text-sm">
                {[
                  "Résume mes 5 derniers emails non lus",
                  "Qui m'a écrit cette semaine ?",
                  "Rédige un brouillon pour remercier l'équipe",
                ].map((s) => (
                  <button key={s} onClick={() => setInput(s)} className="rounded-lg border border-border bg-card/40 px-4 py-2.5 text-left hover:border-primary/50 hover:bg-card/70">
                    <Sparkles className="mr-2 inline h-3.5 w-3.5 text-primary" />{s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-primary dot-pulse" />
              L'agent réfléchit…
            </div>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="border-t border-border bg-background/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(e); } }}
            rows={1}
            placeholder="Écris à ton agent Gmail…"
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <button type="submit" disabled={busy || !input.trim()} className="neon-glow grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isUser ? "bg-violet/15 ring-1 ring-violet/40" : "bg-primary/10 ring-1 ring-primary/30"}`}>
        {isUser ? <User className="h-4 w-4 text-violet" /> : <Bot className="h-4 w-4 text-primary" />}
      </div>
      <div className={`max-w-[80%] space-y-2 ${isUser ? "items-end" : ""}`}>
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className={`prose prose-invert prose-sm rounded-2xl px-4 py-3 ${isUser ? "bg-violet/15 text-foreground" : "ock-glass"}`}>
                <ReactMarkdown>{part.text}</ReactMarkdown>
              </div>
            );
          }
          if (part.type.startsWith("tool-")) {
            const toolName = part.type.replace("tool-", "");
            const state = (part as any).state;
            return (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
                <Wrench className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono">{toolName}</span>
                <span className="text-muted-foreground/70">· {state === "output-available" ? "✓" : state === "input-available" ? "exécution…" : state}</span>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
