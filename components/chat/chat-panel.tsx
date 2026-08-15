"use client";

import { ArrowRight, Check, Globe, Search, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/chat/markdown";

type Activity = { id: string; name: string; detail: string; done: boolean };

type Message =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; activity: Activity[]; thinking: boolean; streaming: boolean };

/**
 * Streams the answer over SSE so the model's work is visible while it happens:
 * tool calls appear as live pills, thinking shows as a shimmer, and the answer
 * renders as Markdown as it arrives.
 */
export function ChatPanel({
  customerId,
  initialConversationId,
}: {
  customerId: string | null;
  initialConversationId: string | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  async function openConversation(id: string) {
    setError(null);
    const res = await fetch(`/api/conversations?id=${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setConversationId(id);
    setMessages(
      (data.messages ?? []).map((m: any) =>
        m.role === "user"
          ? { role: "user", text: m.content }
          : {
              role: "agent",
              text: m.content,
              activity: (m.activity ?? []).map(
                (a: { name: string; detail: string }, i: number) => ({
                  id: `${m.id}-${i}`,
                  name: a.name,
                  detail: a.detail,
                  done: true,
                }),
              ),
              thinking: false,
              streaming: false,
            },
      ),
    );
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setInput("");
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (initialConversationId) {
      void openConversation(initialConversationId);
    } else {
      newChat();
    }
  }, [initialConversationId]);

  useEffect(() => {
    const onNew = () => newChat();
    window.addEventListener("cante:chat-new", onNew);
    return () => window.removeEventListener("cante:chat-new", onNew);
  }, []);

  /** Mutate the in-flight agent message (always the last one). */
  function patchLast(fn: (m: Extract<Message, { role: "agent" }>) => void) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role !== "agent") return prev;
      const copy = { ...last, activity: [...last.activity] };
      fn(copy);
      next[next.length - 1] = copy;
      return next;
    });
  }

  async function send() {
    const question = input.trim();
    if (!question || busy) return;

    setInput("");
    setBusy(true);
    setError(null);
    setMessages((m) => [
      ...m,
      { role: "user", text: question },
      { role: "agent", text: "", activity: [], thinking: true, streaming: true },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, customerId, conversationId }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const payload = frame.replace(/^data: /, "").trim();
          if (!payload) continue;

          let ev: Record<string, any>;
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }

          if (ev.type === "text") {
            patchLast((m) => {
              m.text += ev.text;
              m.thinking = false;
            });
          } else if (ev.type === "thinking") {
            patchLast((m) => {
              if (!m.text) m.thinking = true;
            });
          } else if (ev.type === "tool_start") {
            patchLast((m) => {
              m.thinking = false;
              m.activity.push({ id: ev.id, name: ev.name, detail: ev.detail, done: false });
            });
          } else if (ev.type === "tool_end") {
            patchLast((m) => {
              m.activity = m.activity.map((a) => (a.id === ev.id ? { ...a, done: true } : a));
            });
          } else if (ev.type === "conversation") {
            // A brand-new chat adopts the id the server created, so the next
            // turn appends instead of starting another conversation.
            setConversationId(ev.id);
            window.history.replaceState(null, "", `/chat?conversationId=${ev.id}`);
            window.dispatchEvent(
              new CustomEvent("cante:conversations-updated", { detail: { id: ev.id } }),
            );
          } else if (ev.type === "done") {
            // Semantic end of the answer. The connection stays open a little
            // longer while memory extraction runs, so don't wait for the reader.
            patchLast((m) => {
              m.streaming = false;
              m.thinking = false;
            });
          } else if (ev.type === "memory_updated") {
            window.dispatchEvent(new Event("cante:memory-updated"));
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      patchLast((m) => {
        m.streaming = false;
        m.thinking = false;
      });
      setBusy(false);
    }
  }

  const isEmpty = messages.length === 0 && !busy;

  return (
    <div className={`chat-page${isEmpty ? " is-empty" : ""}`}>
      <div className="chat-scroll">
        <div className="chat-inner">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg-user">
                {m.text}
              </div>
            ) : (
              <div key={i} className="msg-agent">
                {m.activity.length > 0 && (
                  <div className="activity">
                    {m.activity.map((a) => (
                      <span key={a.id} className={`act-pill${a.done ? " is-done" : ""}`}>
                        {a.done ? (
                          <Check size={12} />
                        ) : a.name === "WebFetch" ? (
                          <Globe size={12} className="spin-slow" />
                        ) : (
                          <Search size={12} className="pulse" />
                        )}
                        <span className="act-label">
                          {a.name === "WebFetch" ? "Read" : "Searched"} {a.detail}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {m.thinking && !m.text && <div className="shimmer">Thinking…</div>}

                {m.text && (
                  <>
                    <Markdown>{m.text}</Markdown>
                    {m.streaming && <span className="caret" />}
                  </>
                )}
              </div>
            ),
          )}

          {error && <div className="callout callout-bad">{error}</div>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="composer-dock">
        <div className="composer-shell">
          <div className="greeting">
            <h2>What would you like to know?</h2>
            <p>
              Grounded in stored run data, and able to check official sources on the
              web when the answer isn&apos;t already here.
            </p>
          </div>

          <div className="composer">
            <div className="composer-field">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                placeholder="Ask about the checks, or anything that needs looking up…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
            </div>
            <div className="composer-bar">
              <span className="composer-hint">
                <Globe size={11} /> Can search the web
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={busy ? "Waiting for response" : "Send message"}
                onClick={send}
                disabled={busy || !input.trim()}
              >
                {busy ? (
                  <Square size={14} fill="currentColor" strokeWidth={0} />
                ) : (
                  <ArrowRight size={16} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
