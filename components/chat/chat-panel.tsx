"use client";

import { ArrowRight, Check, ChevronRight, Globe, Search, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/chat/markdown";

type Activity = {
  id: string;
  name: string;
  detail: string;
  done: boolean;
  url?: string;
  hostname?: string;
  hostnames?: string[];
};

type Thought = {
  id: string;
  text: string;
  elapsed: number;
};

type Message =
  | { role: "user"; text: string }
  | {
      role: "agent";
      text: string;
      activity: Activity[];
      thoughts: Thought[];
      thinking: boolean;
      streaming: boolean;
      startedAt: number | null;
      phase: string;
    };

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
              thoughts: [],
              activity: (m.activity ?? []).map(
                (
                  a: {
                    name: string;
                    detail: string;
                    url?: string;
                    hostname?: string;
                    hostnames?: string[];
                  },
                  i: number,
                ) => ({
                  id: `${m.id}-${i}`,
                  name: a.name,
                  detail: a.detail,
                  url: a.url,
                  hostname: a.hostname,
                  hostnames: a.hostnames,
                  done: true,
                }),
              ),
              thinking: false,
              streaming: false,
              startedAt: null,
              phase: "Complete",
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
  const abortRef = useRef<AbortController | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
    if (!messages.some((m) => m.role === "agent" && m.streaming)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
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
      const copy = { ...last, activity: [...last.activity], thoughts: [...last.thoughts] };
      fn(copy);
      next[next.length - 1] = copy;
      return next;
    });
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    patchLast((m) => {
      m.streaming = false;
      m.thinking = false;
      m.phase = "Stopped";
    });
    setBusy(false);
  }

  async function send() {
    const question = input.trim();
    if (!question || busy) return;

    const abortController = new AbortController();
    abortRef.current = abortController;

    setInput("");
    setBusy(true);
    setError(null);
    setMessages((m) => [
      ...m,
      { role: "user", text: question },
      {
        role: "agent",
        text: "",
        activity: [],
        thoughts: [],
        thinking: true,
        streaming: true,
        startedAt: Date.now(),
        phase: "Preparing",
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, customerId, conversationId }),
        signal: abortController.signal,
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
              m.phase = "Writing answer";
            });
          } else if (ev.type === "thinking") {
            patchLast((m) => {
              if (!m.text) m.thinking = true;
              if (typeof ev.text === "string" && ev.text.trim()) {
                const text = ev.text.trim();
                if (m.thoughts[m.thoughts.length - 1]?.text !== text) {
                  m.thoughts.push({
                    id: `${Date.now()}-${m.thoughts.length}`,
                    text,
                    elapsed: elapsedSeconds(m.startedAt, Date.now()),
                  });
                }
              }
              m.phase = m.activity.some((a) => !a.done) ? "Reading sources" : "Reasoning";
            });
          } else if (ev.type === "tool_start") {
            patchLast((m) => {
              m.thinking = false;
              m.phase = ev.name === "WebFetch" ? "Reading source" : "Searching web";
              m.activity.push({
                id: ev.id,
                name: ev.name,
                detail: ev.detail,
                url: ev.url,
                hostname: ev.hostname,
                hostnames: ev.hostnames,
                done: false,
              });
            });
          } else if (ev.type === "tool_end") {
            patchLast((m) => {
              m.activity = m.activity.map((a) => (a.id === ev.id ? { ...a, done: true } : a));
              m.phase = m.activity.some((a) => !a.done) ? "Reading sources" : "Reasoning";
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
            patchLast((m) => {
              m.streaming = false;
              m.thinking = false;
              m.phase = "Complete";
            });
            setBusy(false);
          } else if (ev.type === "memory_updated") {
            window.dispatchEvent(new Event("cante:memory-updated"));
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      patchLast((m) => {
        m.streaming = false;
        m.thinking = false;
        if (m.phase !== "Complete") m.phase = "Stopped";
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
                {(m.streaming || m.activity.length > 0 || m.thoughts.length > 0) && (
                  <div className="activity-wrap">
                    {m.streaming && (
                      <RunStatus
                        phase={m.phase}
                        elapsed={elapsedSeconds(m.startedAt, now)}
                        activity={m.activity}
                      />
                    )}
                    {m.thoughts.length > 0 && <ThinkingLog thoughts={m.thoughts} />}
                    {m.activity.length > 0 && (
                      <div className="activity">
                        {m.activity.map((a) => (
                          <span
                            key={a.id}
                            className={`act-pill${a.done ? " is-done" : ""}`}
                            data-tool={a.name}
                          >
                            <ToolIcon activity={a} />
                            <span className="act-copy">
                              <span className="act-verb">
                                {a.done
                                  ? a.name === "WebFetch"
                                    ? "Read"
                                    : "Searched"
                                  : a.name === "WebFetch"
                                    ? "Reading"
                                    : "Searching"}
                              </span>
                              <span className="act-label">{a.detail}</span>
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {m.thinking && !m.text && m.thoughts.length === 0 && (
                  <ThinkingIndicator
                    elapsed={elapsedSeconds(m.startedAt, now)}
                    phase={m.phase}
                    latestThought={m.thoughts[m.thoughts.length - 1]?.text}
                  />
                )}

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
                aria-label={busy ? "Stop response" : "Send message"}
                onClick={busy ? stop : send}
                disabled={!busy && !input.trim()}
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

function elapsedSeconds(startedAt: number | null, now: number) {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function RunStatus({
  phase,
  elapsed,
  activity,
}: {
  phase: string;
  elapsed: number;
  activity: Activity[];
}) {
  const active = activity.find((item) => !item.done);
  return (
    <div className="run-status">
      <span className="run-status-dot" />
      <span>{active ? `${phase}: ${active.detail}` : phase}</span>
      <time>{elapsed}s</time>
    </div>
  );
}

function ThinkingLog({ thoughts }: { thoughts: Thought[] }) {
  return (
    <div className="thinking-log">
      <div className="thinking-log-head">
        <ChevronRight size={12} />
        <span>Reasoning</span>
      </div>
      <div className="thinking-log-lines">
        {thoughts.slice(-5).map((thought) => (
          <div key={thought.id} className="thinking-line">
            <time>{thought.elapsed}s</time>
            <span>{thought.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolIcon({ activity }: { activity: Activity }) {
  if (activity.name === "WebSearch") {
    const hosts = activity.hostnames?.length
      ? activity.hostnames
      : ["jdih.kemendag.go.id", "peraturan.bpk.go.id", "jdih.kemenkeu.go.id"];
    return (
      <span className="search-favicon-stack">
        {hosts.slice(0, 3).map((host) => (
          <img
            key={host}
            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
            alt=""
          />
        ))}
      </span>
    );
  }

  if (activity.name === "WebFetch" && activity.hostname) {
    return (
      <span className="favicon-orbit">
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(
            activity.hostname,
          )}&sz=32`}
          alt=""
        />
      </span>
    );
  }

  if (activity.done) return <Check size={12} />;
  if (activity.name === "WebFetch") return <Globe size={12} className="spin-slow" />;
  return <Search size={12} className="scan-icon" />;
}

function ThinkingIndicator({
  elapsed,
  phase,
  latestThought,
}: {
  elapsed: number;
  phase: string;
  latestThought?: string;
}) {
  return (
    <div className="thinking-card">
      <div className="thinking-orb">
        <Sparkles size={13} />
      </div>
      <div className="thinking-copy">
        <span>{phase}</span>
        <small>{latestThought ?? "Checking stored runs, memory, and official web sources"} · {elapsed}s</small>
      </div>
      <div className="thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
