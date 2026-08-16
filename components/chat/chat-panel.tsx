"use client";

import { ArrowRight, ChevronDown, Globe, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/chat/markdown";
import {
  SUPPORTED_JURISDICTIONS,
  normalizeJurisdiction,
  type JurisdictionName,
} from "@/lib/countries";

type SearchResult = { title: string; url: string; hostname: string };

/**
 * One entry in the message timeline, in the order it actually happened.
 *
 * Everything here is reported by the provider. There is deliberately no
 * "phase" field and no summary text the client made up: the previous version
 * showed invented labels ("Preparing", "Searching web") and a preflight model
 * call that wrote reasoning prose before the real answer had begun. Both were
 * theatre. What the CLI genuinely reports is: a thinking block is open and how
 * many tokens it has spent, which tool is running with which input, what that
 * tool returned, and the answer text token by token.
 */
type TimelineItem =
  | {
      kind: "thinking";
      id: string;
      tokens: number;
      startedAt: number;
      endedAt: number | null;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      detail: string;
      url?: string;
      hostname?: string;
      results?: SearchResult[];
      done: boolean;
    };

type Message =
  | { role: "user"; text: string }
  | {
      role: "agent";
      text: string;
      timeline: TimelineItem[];
      streaming: boolean;
      startedAt: number | null;
    };

/**
 * Streams the answer over SSE so the model's work is visible while it happens:
 * a live thinking block, tool calls with the favicons of the pages actually
 * returned, and the answer rendering token by token as Markdown.
 */
export function ChatPanel({
  customerId,
  initialConversationId,
  initialCountry,
}: {
  customerId: string | null;
  initialConversationId: string | null;
  initialCountry: JurisdictionName;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [country, setCountry] = useState<JurisdictionName>(initialCountry);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);

  async function openConversation(id: string) {
    setError(null);
    const res = await fetch(`/api/conversations?id=${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setCountry(normalizeJurisdiction(data.conversation?.jurisdiction));
    setConversationId(id);
    setMessages(
      (data.messages ?? []).map((m: any) =>
        m.role === "user"
          ? { role: "user", text: m.content }
          : {
              role: "agent",
              text: m.content,
              timeline: (m.activity ?? []).map(
                (a: Omit<Extract<TimelineItem, { kind: "tool" }>, "kind" | "done">, i: number) => ({
                  kind: "tool" as const,
                  id: a.id ?? `${m.id}-${i}`,
                  name: a.name,
                  detail: a.detail,
                  url: a.url,
                  hostname: a.hostname,
                  results: a.results,
                  done: true,
                }),
              ),
              streaming: false,
              startedAt: null,
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

  function chooseCountry(next: JurisdictionName) {
    if (busy || next === country) {
      setCountryMenuOpen(false);
      return;
    }
    setCountry(next);
    setCountryMenuOpen(false);
    newChat();
    router.push(`/chat?country=${encodeURIComponent(next)}`);
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

  // Drives the live second counters. Only ticks while something is streaming.
  useEffect(() => {
    if (!messages.some((m) => m.role === "agent" && m.streaming)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [messages]);

  useEffect(() => {
    setCountry(initialCountry);
    if (initialConversationId) {
      void openConversation(initialConversationId);
    } else {
      newChat();
    }
  }, [initialConversationId, initialCountry]);

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
      const copy = { ...last, timeline: [...last.timeline] };
      fn(copy);
      next[next.length - 1] = copy;
      return next;
    });
  }

  function closeOpenItems(m: Extract<Message, { role: "agent" }>) {
    m.timeline = m.timeline.map((item) =>
      item.kind === "thinking" && item.endedAt === null
        ? { ...item, endedAt: Date.now() }
        : item.kind === "tool" && !item.done
          ? { ...item, done: true }
          : item,
    );
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    patchLast((m) => {
      m.streaming = false;
      closeOpenItems(m);
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
      { role: "agent", text: "", timeline: [], streaming: true, startedAt: Date.now() },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, customerId, conversationId, country }),
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
              // The first token means every earlier step has finished. Only
              // settle the timeline once, not on every delta.
              if (!m.text) closeOpenItems(m);
              m.text += ev.text;
            });
          } else if (ev.type === "thinking_start") {
            patchLast((m) => {
              m.timeline.push({
                kind: "thinking",
                id: `think-${m.timeline.length}`,
                tokens: 0,
                startedAt: Date.now(),
                endedAt: null,
              });
            });
          } else if (ev.type === "thinking") {
            patchLast((m) => {
              const open = [...m.timeline]
                .reverse()
                .find((i) => i.kind === "thinking" && i.endedAt === null);
              if (open && open.kind === "thinking" && typeof ev.tokens === "number") {
                m.timeline = m.timeline.map((i) =>
                  i === open ? { ...i, tokens: ev.tokens } : i,
                );
              }
            });
          } else if (ev.type === "thinking_end") {
            patchLast((m) => {
              m.timeline = m.timeline.map((i) =>
                i.kind === "thinking" && i.endedAt === null
                  ? { ...i, endedAt: Date.now(), tokens: ev.tokens ?? i.tokens }
                  : i,
              );
            });
          } else if (ev.type === "tool_start") {
            patchLast((m) => {
              closeOpenItems(m);
              m.timeline.push({
                kind: "tool",
                id: ev.id,
                name: ev.name,
                detail: ev.detail,
                url: ev.url,
                hostname: ev.hostname,
                done: false,
              });
            });
          } else if (ev.type === "tool_end") {
            patchLast((m) => {
              m.timeline = m.timeline.map((i) =>
                i.kind === "tool" && i.id === ev.id
                  ? { ...i, done: true, results: ev.results ?? i.results }
                  : i,
              );
            });
          } else if (ev.type === "conversation") {
            // A brand-new chat adopts the id the server created, so the next
            // turn appends instead of starting another conversation.
            setConversationId(ev.id);
            window.history.replaceState(
              null,
              "",
              `/chat?country=${encodeURIComponent(country)}&conversationId=${ev.id}`,
            );
            window.dispatchEvent(
              new CustomEvent("cante:conversations-updated", { detail: { id: ev.id } }),
            );
          } else if (ev.type === "done") {
            patchLast((m) => {
              m.streaming = false;
              closeOpenItems(m);
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
        closeOpenItems(m);
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
                {(m.timeline.length > 0 || (m.streaming && !m.text)) && (
                  <div className="timeline">
                    {m.timeline.map((item, index) =>
                      item.kind === "thinking" ? (
                        <ThinkingBlock
                          key={item.id}
                          item={item}
                          now={now}
                          connected={index < m.timeline.length - 1}
                        />
                      ) : (
                        <ToolBlock
                          key={item.id}
                          item={item}
                          connected={index < m.timeline.length - 1}
                        />
                      ),
                    )}
                    {m.streaming && !m.text && m.timeline.every(isSettled) && (
                      <TimelineRow streaming>
                        <span className="tl-verb">Working</span>
                        <span className="tl-elapsed">{seconds(m.startedAt, now)}</span>
                      </TimelineRow>
                    )}
                  </div>
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
              {country === "United States"
                ? "Domestic, distribution, and export compliance grounded in your U.S. profile."
                : "Indonesian rules grounded in stored runs, KBLI, HS codes, and customer memory."}
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
              <div className="country-picker">
                <button
                  type="button"
                  className="country-picker-current"
                  aria-haspopup="menu"
                  aria-expanded={countryMenuOpen}
                  onClick={() => setCountryMenuOpen((open) => !open)}
                  disabled={busy}
                >
                  <span className="country-code">
                    {country === "United States" ? "US" : "ID"}
                  </span>
                  {country}
                  <ChevronDown size={12} />
                </button>
                {countryMenuOpen && (
                  <div className="country-picker-menu" role="menu">
                    {SUPPORTED_JURISDICTIONS.map((option) => (
                      <button
                        key={option.code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.name === country}
                        data-active={option.name === country}
                        onClick={() => chooseCountry(option.name)}
                      >
                        <span className="country-code">{option.code}</span>
                        <span>
                          <strong>{option.name}</strong>
                          <small>{option.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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

function isSettled(item: TimelineItem): boolean {
  return item.kind === "thinking" ? item.endedAt !== null : item.done;
}

function seconds(from: number | null, to: number): string {
  if (!from) return "0s";
  return `${Math.max(0, (to - from) / 1000).toFixed(1)}s`;
}

/** The dot-and-connector rail every timeline entry hangs off. */
function TimelineRow({
  streaming,
  connected,
  children,
}: {
  streaming?: boolean;
  connected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="tl-row">
      <span className="tl-rail">
        {streaming ? <span className="tl-spinner" /> : <span className="tl-dot" />}
        {connected && <span className="tl-connector" />}
      </span>
      <div className="tl-body">{children}</div>
    </div>
  );
}

/**
 * The model is thinking — which is all the CLI actually tells us.
 *
 * It reports that a thinking block is open and a running token estimate, but
 * the thinking text itself comes through empty, so there is nothing to
 * display and nothing legitimate to substitute for it. Duration and token
 * count are real; a paragraph of invented "reasoning" would not be.
 */
function ThinkingBlock({
  item,
  now,
  connected,
}: {
  item: Extract<TimelineItem, { kind: "thinking" }>;
  now: number;
  connected: boolean;
}) {
  const running = item.endedAt === null;
  const elapsed = seconds(item.startedAt, item.endedAt ?? now);

  return (
    <TimelineRow streaming={running} connected={connected}>
      <span className={`tl-verb${running ? " is-live" : ""}`}>
        {running ? "Thinking" : "Thought"}
      </span>
      <span className="tl-elapsed">
        {elapsed}
        {item.tokens > 0 && <span className="tl-tokens"> · {item.tokens} tokens</span>}
      </span>
    </TimelineRow>
  );
}

function ToolBlock({
  item,
  connected,
}: {
  item: Extract<TimelineItem, { kind: "tool" }>;
  connected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isSearch = item.name === "WebSearch";
  const results = item.results ?? [];
  const verb = isSearch
    ? item.done
      ? "Searched"
      : "Searching"
    : item.done
      ? "Read"
      : "Reading";

  // Favicons come from the pages the search actually returned. While the
  // search is still running there are none yet — so none are shown.
  const hosts = [...new Set(results.map((r) => r.hostname))].slice(0, 4);

  return (
    <TimelineRow streaming={!item.done} connected={connected}>
      <span className="tl-line">
        <span className={`tl-verb${item.done ? "" : " is-live"}`}>{verb}</span>
        {item.hostname && <Favicon host={item.hostname} />}
        {item.url ? (
          <a className="tl-target" href={item.url} target="_blank" rel="noreferrer noopener">
            {item.detail}
          </a>
        ) : (
          <span className="tl-target">
            {isSearch ? `“${item.detail}”` : item.detail}
            {!item.done && "…"}
          </span>
        )}
        {hosts.length > 0 && (
          <button
            type="button"
            className="tl-sources"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Hide sources" : "Show sources"}
          >
            <span className="favicon-stack">
              {hosts.map((host) => (
                <Favicon key={host} host={host} />
              ))}
            </span>
            <span className="tl-count">{results.length}</span>
            <ChevronDown size={10} className={open ? "" : "is-collapsed"} />
          </button>
        )}
      </span>

      {open && results.length > 0 && (
        <ul className="tl-results">
          {results.map((result) => (
            <li key={result.url}>
              <Favicon host={result.hostname} />
              <a href={result.url} target="_blank" rel="noreferrer noopener">
                {result.title}
              </a>
              <span className="tl-host">{result.hostname}</span>
            </li>
          ))}
        </ul>
      )}
    </TimelineRow>
  );
}

function Favicon({ host }: { host: string }) {
  return (
    <img
      className="favicon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      loading="lazy"
    />
  );
}
