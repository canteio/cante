"use client";

import { Brain, Check, MessageSquarePlus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

export type Conversation = { id: string; title: string; updatedAt: string };
export type Memory = {
  id: string;
  kind: string;
  content: string;
  source: string | null;
  origin: string;
  confirmed: boolean;
};

const KINDS = ["product", "hs_code", "market", "contact", "operational", "preference", "other"];

/**
 * Two panels: saved conversations, and what the system remembers about the
 * customer.
 *
 * The memory list is deliberately editable. Entries proposed by the model land
 * unconfirmed and are shown as such, because they feed the daily check — an
 * inferred fact that silently hardened into a verified one would undermine the
 * honesty the alerts depend on.
 */
export function ChatSidebar({
  activeId,
  onOpen,
  onNew,
  refreshKey,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  refreshKey: number;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState("other");

  async function loadAll() {
    const [c, m] = await Promise.all([
      fetch("/api/conversations").then((r) => r.json()),
      fetch("/api/memories").then((r) => r.json()),
    ]);
    setConversations(c.conversations ?? []);
    setMemories(m.memories ?? []);
  }

  useEffect(() => {
    void loadAll();
  }, [refreshKey]);

  async function addMemory() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setAdding(false);
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, kind: draftKind }),
    });
    setDraftKind("other");
    void loadAll();
  }

  async function toggleConfirmed(m: Memory) {
    setMemories((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, confirmed: !x.confirmed } : x)),
    );
    await fetch("/api/memories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, confirmed: !m.confirmed }),
    });
    void loadAll();
  }

  async function removeMemory(id: string) {
    setMemories((prev) => prev.filter((x) => x.id !== id));
    await fetch(`/api/memories?id=${id}`, { method: "DELETE" });
  }

  async function removeConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
    if (id === activeId) onNew();
  }

  return (
    <aside className="chat-rail">
      <button className="rail-new" onClick={onNew}>
        <MessageSquarePlus size={14} />
        New chat
      </button>

      <div className="rail-section">
        <div className="side-label">Chats</div>
        {conversations.length === 0 ? (
          <div className="rail-empty">Nothing yet.</div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={`rail-item${c.id === activeId ? " is-active" : ""}`}
              onClick={() => onOpen(c.id)}
            >
              <span className="rail-item-title">{c.title}</span>
              <button
                className="rail-x"
                aria-label="Delete conversation"
                onClick={(e) => removeConversation(c.id, e)}
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="rail-section rail-memory">
        <div className="rail-head">
          <div className="side-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Brain size={12} /> Memory
          </div>
          <button className="rail-add" onClick={() => setAdding((v) => !v)} aria-label="Add memory">
            <Plus size={13} />
          </button>
        </div>

        {adding && (
          <div className="mem-draft">
            <select value={draftKind} onChange={(e) => setDraftKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
            <textarea
              rows={2}
              autoFocus
              value={draft}
              placeholder="e.g. HS code 3921.90, confirmed from the PEB"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void addMemory();
                }
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <button className="btn" style={{ height: 26 }} onClick={addMemory}>
              Save
            </button>
          </div>
        )}

        {memories.length === 0 && !adding ? (
          <div className="rail-empty">
            Nothing remembered yet. Facts learned in chat show up here for you to confirm.
          </div>
        ) : (
          memories.map((m) => (
            <div key={m.id} className={`mem${m.confirmed ? " is-confirmed" : ""}`}>
              <div className="mem-top">
                <span className="mem-kind">{m.kind.replace("_", " ")}</span>
                <div className="mem-actions">
                  <button
                    onClick={() => toggleConfirmed(m)}
                    aria-label={m.confirmed ? "Mark unconfirmed" : "Confirm"}
                    title={m.confirmed ? "Confirmed — click to unconfirm" : "Mark as confirmed"}
                  >
                    <Check size={11} />
                  </button>
                  <button onClick={() => removeMemory(m.id)} aria-label="Forget">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <div className="mem-content">{m.content}</div>
              {!m.confirmed && <div className="mem-flag">unconfirmed</div>}
              {m.source && <div className="mem-source">{m.source}</div>}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
