"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { friendlyError } from "@/lib/friendly-error";
import { useLocale } from "@/lib/i18n/locale-provider";

type Citation = { content_type: string; content_id: string; title: string };
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};
type ConversationSummary = { id: string; title: string | null; updated_at: string };

const CITATION_HREF: Record<string, (id: string) => string> = {
  note: (id) => `/notes/${id}`,
  task: (id) => `/tasks/${id}`,
};

export function WorkspaceChat({
  apiUrl,
  initialConversations,
}: {
  apiUrl: string;
  initialConversations: ConversationSummary[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const { locale } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function openConversation(id: string) {
    setError(null);
    setConversationId(id);
    const { data } = await supabase
      .from("messages")
      .select("role, content, citations")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages(
      (data ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        citations: (m.citations as Citation[]) ?? [],
      })),
    );
  }

  function startNewConversation() {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }

  async function sendMessage() {
    const query = input.trim();
    if (!query || streaming) return;

    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setStreaming(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setError("Your session expired. Refresh the page and sign in again.");
      setStreaming(false);
      return;
    }

    let assistantIndex = -1;
    setMessages((prev) => {
      assistantIndex = prev.length;
      return [...prev, { role: "assistant", content: "" }];
    });

    try {
      const response = await fetch(`${apiUrl}/agents/memory/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ query, conversation_id: conversationId, language: locale }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice("data: ".length));

          if (event.type === "conversation") {
            if (!conversationId) {
              setConversationId(event.id);
              setConversations((prev) => [
                { id: event.id, title: query.slice(0, 80), updated_at: new Date().toISOString() },
                ...prev,
              ]);
            }
          } else if (event.type === "token") {
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIndex] = {
                ...next[assistantIndex],
                content: next[assistantIndex].content + event.text,
              };
              return next;
            });
          } else if (event.type === "citations") {
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIndex] = {
                ...next[assistantIndex],
                citations: event.citations,
              };
              return next;
            });
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      console.error("workspace chat stream failed:", err);
      setError(friendlyError(err));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row gap-4">
      {/* Mobile Chat Switcher & New Chat Button */}
      <div className="flex md:hidden items-center gap-2 pb-1">
        <Button variant="outline" size="sm" onClick={startNewConversation} className="shrink-0">
          <Icon name="add" size={16} />
          New
        </Button>
        {conversations.length > 0 && (
          <select
            value={conversationId ?? ""}
            onChange={(e) => {
              if (e.target.value) openConversation(e.target.value);
              else startNewConversation();
            }}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">New Conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || "Untitled conversation"}
              </option>
            ))}
          </select>
        )}
      </div>

      <aside className="hidden w-56 shrink-0 flex-col gap-2 md:flex">
        <Button variant="outline" size="sm" onClick={startNewConversation}>
          <Icon name="add" size={16} />
          New chat
        </Button>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                "block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                conversationId === c.id && "bg-muted text-foreground",
              )}
            >
              {c.title || "Untitled conversation"}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 sm:px-4 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Icon name="auto_awesome" size={24} />
                <p className="text-sm">
                  Ask about a past decision, a note, or what&apos;s on your plate.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[88%] sm:max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border/60 bg-muted/40",
                  )}
                >
                  {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
                  {!!m.citations?.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/40 pt-2">
                      {m.citations.map((c, ci) => {
                        const href = CITATION_HREF[c.content_type]?.(c.content_id);
                        const pill = (
                          <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                            {c.title}
                          </span>
                        );
                        return href ? (
                          <Link key={ci} href={href}>
                            {pill}
                          </Link>
                        ) : (
                          <span key={ci}>{pill}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <p className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-end gap-2 border-t border-border/60 p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask your second brain..."
              rows={1}
              className="min-h-9 flex-1 resize-none"
              disabled={streaming}
            />
            <Button size="icon" onClick={sendMessage} disabled={streaming || !input.trim()}>
              <Icon name="send" size={16} />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
