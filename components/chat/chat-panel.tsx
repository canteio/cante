"use client";

import { calculateDemo, DEMO_QUESTION, DEMO_STORAGE_KEY, demoMoney, type DemoInput } from "@/components/tariff/demo-scenario";
import { ArrowRight, ChevronDown, Globe, Paperclip, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/chat/markdown";
import { CanteBeagle } from "@/components/chat/cante-beagle";
import {
  SUPPORTED_JURISDICTIONS,
  normalizeJurisdiction,
  type JurisdictionName,
} from "@/lib/countries";

type SearchResult = { title: string; url: string; hostname: string };

/** An uploaded file after `/api/files/extract` turned it into text. */
type Attachment = {
  filename: string;
  format: string;
  text: string;
  warnings?: string[];
};

/**
 * One entry in the message timeline, in the order it actually happened.
 *
 * Everything here is reported by the provider. There is deliberately no
 * "phase" field or client-invented reasoning. Working states, tools and sources
 * come from actual events. Reasoning summaries are a separate provider event,
 * never private reasoning text or a second call to invent an explanation.
 */
type TimelineItem =
  | { kind: "summary"; id: string; text: string; done: boolean }
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
  | { role: "user"; text: string; attachments?: { filename: string; format: string }[] }
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
  initialDemo = false,
}: {
  customerId: string | null;
  initialConversationId: string | null;
  initialCountry: JurisdictionName;
  initialDemo?: boolean;
}) {
  const router = useRouter();
  const [demoInput, setDemoInput] = useState<DemoInput | null>(null);
  const demoResult = useMemo(() => {
    if (!demoInput) return null;
    try { return calculateDemo(demoInput); } catch { return null; }
  }, [demoInput]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [country, setCountry] = useState<JurisdictionName>("United States");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);

  // UI/UX friction fix: the jurisdiction picker menu (role="menu") had no
  // Escape handler, unlike the Add Product form (catalogue-panel.tsx) and
  // modal dialogs (workqueue-panel.tsx). A user who opens this popover and
  // changes their mind had no keyboard way to dismiss it — only clicking
  // one of the menu items or elsewhere on the page closed it. Mirrors the
  // same window-keydown Escape pattern already established for this repo.
  //
  // Follow-up fix (continuing the focus-trap/keyboard-nav audit noted in the
  // build log): closing via Escape used to drop keyboard focus entirely —
  // the browser left it on the now-hidden trigger button with no visible
  // anchor state, so a keyboard user lost their place. The WAI-ARIA APG
  // menu-button pattern requires focus to return explicitly to the trigger
  // on close, so we re-focus it here. Click-selection (chooseCountry)
  // already leaves focus on the clicked menu item, which is fine on its
  // own — only the Escape path had no natural focus target.
  const countryTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!countryMenuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCountryMenuOpen(false);
        countryTriggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [countryMenuOpen]);

  async function openConversation(id: string) {
    setError(null);
    // Same silent-failure class already fixed in workqueue/checklist/
    // suppliers/catalogue/profile/memory this cycle: a failed load used to
    // just `return`, leaving the panel blank or stuck on stale messages with
    // no indication anything went wrong. Now it surfaces a real error so the
    // user can tell "broken load" from "empty conversation".
    let res: Response;
    try {
      res = await fetch(`/api/conversations?id=${id}`);
    } catch {
      setError("Could not load this conversation — check your connection and try again.");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Could not load this conversation (${res.status}).`);
      return;
    }
    const data = await res.json();
    if (normalizeJurisdiction(data.conversation?.jurisdiction) !== "United States") {
      setError("Indonesia chat is temporarily unavailable. Start a new United States chat.");
      return;
    }
    setCountry("United States");
    setConversationId(id);
    setMessages(
      (data.messages ?? []).map((m: any) =>
        m.role === "user"
          ? { role: "user", text: m.content }
          : {
              role: "agent",
              text: m.content,
              timeline: (m.activity ?? []).filter((a: { name: string }) => a.name !== "ReasoningSummary").map(
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
    abortRef.current?.abort();
    setBusy(false);
    setConversationId(null);
    setMessages([]);
    setError(null);
    setInput("");
    setAttachments([]);
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

  // Files dropped on the composer, already turned into text server-side. They
  // are attached to the next message. Sending files invokes the existing
  // workspace filing path; selecting a file alone does not save it.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  // dragenter/dragleave fire for every child element, so a plain boolean
  // flickers as the pointer crosses the textarea. Counting entries is what
  // keeps the highlight stable.
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function attachFiles(files: File[]) {
    if (initialDemo) { setError("Edit the fictional scenario at /tariff/demo to change its files."); return; }
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    for (const file of files) {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/files/extract", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          // A refusal is the useful answer here — say which file and why.
          setError(`${file.name}: ${data.error ?? "could not be read."}`);
          continue;
        }
        setAttachments((current) => [
          ...current.filter((a) => a.filename !== data.filename),
          data as Attachment,
        ]);
      } catch {
        setError(`${file.name} could not be uploaded.`);
      }
    }
    setReading(false);
  }

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
    if (initialDemo) {
      newChat();
      try {
        const stored = sessionStorage.getItem(DEMO_STORAGE_KEY);
        if (!stored) throw new Error("Calculate a fictional scenario first, then choose Ask Cante.");
        const scenario = JSON.parse(stored) as DemoInput;
        calculateDemo(scenario);
        setDemoInput(scenario);
        setInput(DEMO_QUESTION);
      } catch (error) { setDemoInput(null); setError((error as Error).message); }
      return;
    }
    setDemoInput(null);
    if (initialConversationId) {
      void openConversation(initialConversationId);
    } else {
      newChat();
    }
  }, [initialConversationId, initialCountry, initialDemo]);

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
    m.timeline = m.timeline.filter((item) => item.kind !== "summary").map((item) =>
      item.kind === "thinking" && item.endedAt === null
        ? { ...item, endedAt: Date.now() }
        : item.kind !== "thinking" && !item.done
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
    if (initialDemo && !demoInput) { setError("Calculate a fictional scenario first at /tariff/demo."); return; }
    if (initialDemo && attachments.length) { setError("Demo chat uses the scenario report only. Leave demo mode to upload workspace files."); return; }
    // A dropped file with no typed question is a valid ask on its own.
    if ((!question && attachments.length === 0) || busy || reading) return;

    const abortController = new AbortController();
    abortRef.current = abortController;
    const sending = attachments;

    setInput("");
    setAttachments([]);
    setBusy(true);
    setError(null);
    setMessages((m) => [
      ...m,
      {
        role: "user",
        text: question,
        attachments: sending.map((a) => ({ filename: a.filename, format: a.format })),
      },
      { role: "agent", text: "", timeline: [], streaming: true, startedAt: Date.now() },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          ...(initialDemo && demoInput ? { demoScenario: demoInput, demoMessages: messages.map(m => ({ role: m.role, text: m.text })) } : {}),
          attachments: sending,
          customerId,
          conversationId,
          country,
        }),
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
          } else if (ev.type === "reasoning_summary") {
            patchLast((m) => {
              // Keep only the current live summary; never leave a replay control.
              m.timeline = m.timeline.filter((i) => i.kind !== "summary" || (!ev.done && i.id === ev.id));
              if (ev.done) return;
              const existing = m.timeline.find((i) => i.kind === "summary" && i.id === ev.id);
              if (existing && existing.kind === "summary") {
                m.timeline = m.timeline.map((i) => i === existing
                  ? { ...existing, text: (existing.text + ev.text).slice(0, 16_000) } : i);
              } else {
                m.timeline.push({ kind: "summary", id: ev.id, text: ev.text.slice(0, 16_000), done: false });
              }
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
                  ? { ...i, done: true, results: ev.results ?? i.results, detail: ev.detail ?? i.detail, name: ev.name ?? i.name, url: ev.url ?? i.url, hostname: ev.hostname ?? i.hostname }
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
  function suggest(text: string) { setInput(text); textareaRef.current?.focus(); }

  return (
    <div className={`chat-page cante-chat${isEmpty ? " is-empty" : ""}`}>
      {initialDemo && <div className="chat-demo-banner"><span><strong>Fictional scenario</strong>{demoResult ? ` · ${demoResult.affectedCount}/${demoResult.productCount} products · ${demoMoney(demoResult.totalExtraCents)} extra/year. Not saved to your workspace.` : " · Calculate a demo first."}</span><a href="/tariff/demo">Edit scenario</a><a href="/chat">Leave demo</a></div>}
      {!isEmpty && <div className="cante-chat-mobile-actions"><button className="btn" disabled={busy} onClick={() => { newChat(); router.push(`/chat?country=${encodeURIComponent(country)}`); }}>New chat</button></div>}
      <div className="chat-scroll">
        <div className="chat-inner">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg-user">
                {m.attachments?.length ? (
                  <div className="msg-attachments">
                    {m.attachments.map((a) => (
                      <span key={a.filename} className="attachment-chip is-sent">
                        <Paperclip size={11} />
                        <span className="attachment-name">{a.filename}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.text}
              </div>
            ) : (
              <div key={i} className="msg-agent">
                <div className="cante-message-name">Cante</div>
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
                      ) : item.kind === "summary" ? null : (
                        <ToolBlock
                          key={item.id}
                          item={item}
                          connected={index < m.timeline.length - 1}
                        />
                      ),
                    )}
                    <ReasoningSummary item={m.timeline.find((item): item is Extract<TimelineItem, { kind: "summary" }> => item.kind === "summary") ?? null} />
                    <div className={`tl-working-slot${m.streaming && !m.text && m.timeline.every(isSettled) ? " is-open" : ""}`}
                      aria-hidden={!(m.streaming && !m.text && m.timeline.every(isSettled))}>
                      <div className="tl-summary-clip">
                        <TimelineRow streaming>
                          <span className="tl-verb">Working</span>
                          <span className="tl-elapsed">{seconds(m.startedAt, now)}</span>
                        </TimelineRow>
                      </div>
                    </div>
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

          {error && <div className="callout callout-bad" role="alert">{error}</div>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="composer-dock">
        <div className="composer-shell">
          {isEmpty && <section className="cante-welcome" aria-labelledby="cante-welcome-heading">
            <CanteBeagle />
            <h1 id="cante-welcome-heading">Hi, I’m Cante.</h1>
          </section>}
          {isEmpty && error && <div className="callout callout-bad" role="alert">{error}</div>}


          <div
            className="composer"
            data-dragging={dragging || undefined}
            onDragEnter={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              void attachFiles(Array.from(e.dataTransfer.files));
            }}
          >
            {dragging && (
              <div className="composer-drop">
                <Paperclip size={14} /> Drop to attach — PDF, Excel, Word, CSV or text
              </div>
            )}
            {attachments.length > 0 && (
              <div className="composer-attachments">
                {attachments.map((attachment) => (
                  <span key={attachment.filename} className="attachment-chip">
                    <Paperclip size={11} />
                    <span className="attachment-name">{attachment.filename}</span>
                    <small>{attachment.format}</small>
                    {attachment.warnings?.length ? (
                      <small className="attachment-warn" title={attachment.warnings.join(" ")}>
                        · partial
                      </small>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.filename}`}
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((a) => a.filename !== attachment.filename),
                        )
                      }
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-field">
              <textarea
                aria-label="Message Cante"
                ref={textareaRef}
                rows={1}
                value={input}
                placeholder={
                  initialDemo ? "Ask about this fictional tariff scenario…" : attachments.length
                    ? "Ask about the attached file, or just send…"
                    : "Ask Cante anything, or drop a file here…"
                }
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  // Pasting a file (screenshot, copied document) should behave
                  // like dropping one.
                  const files = Array.from(e.clipboardData.files);
                  if (files.length) {
                    e.preventDefault();
                    void attachFiles(files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
            </div>
            <div className="composer-bar">
              <span className="country-picker-current country-fixed" aria-label="Chat jurisdiction: United States"><span className="country-code">US</span>United States</span>
              {/* Country switching is temporarily disabled; preserve the selector for later.
              <div className="country-picker">
                <button
                  ref={countryTriggerRef}
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
              */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                accept=".pdf,.xlsx,.xlsm,.docx,.csv,.txt,.md"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void attachFiles(files);
                }}
              />
              <button
                type="button"
                className="icon-btn composer-attach"
                aria-label="Attach a file"
                title="Attach a file"
                disabled={busy || reading || initialDemo}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={14} />
              </button>
              <span className="composer-hint">
                {reading ? (
                  <>Reading file…</>
                ) : (
                  <>
                    <Globe size={11} /> {initialDemo ? "Uses this fictional report" : "Can search the web"}
                  </>
                )}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={busy ? "Stop response" : "Send message"}
                onClick={busy ? stop : send}
                disabled={!busy && !input.trim() && attachments.length === 0}
              >
                {busy ? (
                  <Square size={14} fill="currentColor" strokeWidth={0} />
                ) : (
                  <ArrowRight size={16} />
                )}
              </button>
            </div>
          </div>
          {isEmpty && initialDemo && <div className="cante-starters">
            <button onClick={() => suggest("Why are these products affected by this simulated regulation?")}><ArrowRight size={16} /><strong>Why these products?</strong><span>See the origin and HTS match</span></button>
            <button onClick={() => suggest("Which five SKUs are hit hardest?")}><ArrowRight size={16} /><strong>Biggest impacts</strong><span>Review the top five SKUs</span></button>
            <button onClick={() => suggest("What did we import in September?")}><ArrowRight size={16} /><strong>Import history</strong><span>Explore the fictional ledger</span></button>
          </div>}
          {isEmpty && !initialDemo && (
            <div className="cante-starters">
              <button disabled={reading} onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /><strong>Start with a file</strong><span>CSV, spreadsheet or document</span></button>
              <button onClick={() => suggest("Show me my saved products. What information is missing, and what should I do first?")}><ArrowRight size={16} /><strong>Help with my products</strong><span>See what’s in your workspace</span></button>
              <button onClick={() => suggest("Help me find official government guidance for my products. Ask me what you need to know first.")}><Globe size={16} /><strong>Find official guidance</strong><span>Go straight to the source</span></button>
            </div>
          )}
          <p className="cante-chat-note">{initialDemo ? "Fictional scenario. Amounts calculated by code; this conversation is not saved." : attachments.length ? "Files you send are saved to this workspace. Remove any sensitive columns first." : "Cante can make mistakes. Check sources before making trade decisions."}</p>
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
        {running ? "Working" : "Finished"}
      </span>
      <span className="tl-elapsed">
        {elapsed}
        {item.tokens > 0 && <span className="tl-tokens"> · {item.tokens} tokens</span>}
      </span>
    </TimelineRow>
  );
}

/** A stable, single-line slot: finish closing before showing the next summary. */
function ReasoningSummary({ item }: {
  item: Extract<TimelineItem, { kind: "summary" }> | null;
}) {
  const [shown, setShown] = useState(item);
  const [open, setOpen] = useState(false);
  const latest = useRef(item);
  latest.current = item;

  // Keep the last streamed text available while its line closes.
  useEffect(() => {
    if (item && shown?.id === item.id) setShown(item);
  }, [item]);

  useEffect(() => {
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (item && (!shown || shown.id === item.id)) {
      setShown(item);
      frame = requestAnimationFrame(() => setOpen(true));
    } else {
      setOpen(false);
      timer = setTimeout(() => {
        setShown(latest.current);
        if (latest.current) frame = requestAnimationFrame(() => setOpen(true));
      }, 220);
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [item?.id]);

  const raw = (shown?.id === item?.id ? item?.text : shown?.text) ?? "";
  // Provider summaries often start with a bold/Markdown heading. Wait for the
  // actual prose rather than flashing a partial heading or inventing a label.
  const withoutHeading = raw.startsWith("**") && raw.indexOf("**", 2) < 0 ? ""
    : raw.replace(/^\s*\*\*[^*]+\*\*\s*/, "").replace(/^\s*#{1,6}[^\n]*(?:\n|$)/, "");
  const text = withoutHeading.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  return (
    <div className={`tl-summary-slot${open && text ? " is-open" : ""}`} aria-hidden={!open || !text}>
      <div className="tl-summary-clip">
        <div className="tl-summary-line">{text}</div>
      </div>
    </div>
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
