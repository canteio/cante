"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type Memory = {
  id: string;
  kind: string;
  content: string;
  source: string | null;
  origin: string;
  confirmed: boolean;
  createdAt: string;
};

const KINDS = [
  "product",
  "hs_code",
  "kbli",
  "market",
  "location",
  "license",
  "sni",
  "tax",
  "contact",
  "operational",
  "preference",
  "other",
];

export function MemoryPanel() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState("other");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await fetch("/api/memories").then((r) => r.json());
    setMemories(data.memories ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener("cante:memory-updated", onChanged);
    return () => window.removeEventListener("cante:memory-updated", onChanged);
  }, []);

  async function addMemory() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, kind: draftKind }),
    });
    setDraftKind("other");
    window.dispatchEvent(new Event("cante:checklist-updated"));
    await load();
  }

  async function toggleConfirmed(memory: Memory) {
    setMemories((prev) =>
      prev.map((m) => (m.id === memory.id ? { ...m, confirmed: !m.confirmed } : m)),
    );
    await fetch("/api/memories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: memory.id, confirmed: !memory.confirmed }),
    });
    window.dispatchEvent(new Event("cante:checklist-updated"));
    await load();
  }

  async function removeMemory(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/memories?id=${id}`, { method: "DELETE" });
    window.dispatchEvent(new Event("cante:checklist-updated"));
  }

  const confirmed = memories.filter((m) => m.confirmed).length;
  const unconfirmed = memories.length - confirmed;

  return (
    <div className="main-scroll">
      <div className="memory-main">
        <div className="page-head">
          <div>
            <h1>Memory</h1>
            <p>Customer facts that feed both chat and future compliance checks.</p>
          </div>
          <div className="memory-counts">
            <span className="pill pill-ok">{confirmed} confirmed</span>
            <span className="pill pill-warn">{unconfirmed} unconfirmed</span>
          </div>
        </div>

        <div className="memory-compose">
          <select value={draftKind} onChange={(event) => setDraftKind(event.target.value)}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace("_", " ")}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            value={draft}
            placeholder="Add a confirmed customer fact, e.g. HS code 3921.90 from PEB document"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void addMemory();
              }
            }}
          />
          <button className="btn" onClick={addMemory} disabled={!draft.trim()}>
            <Plus size={14} />
            Add
          </button>
        </div>

        {loading ? (
          <div className="empty">Loading memory…</div>
        ) : memories.length === 0 ? (
          <div className="empty">
            Nothing remembered yet. Facts learned in chat will appear here for confirmation.
          </div>
        ) : (
          <div className="memory-grid">
            {memories.map((memory) => (
              <article
                key={memory.id}
                className={`memory-card${memory.confirmed ? " is-confirmed" : ""}`}
              >
                <div className="memory-card-top">
                  <span className="mem-kind">{memory.kind.replace("_", " ")}</span>
                  <span className={`pill ${memory.confirmed ? "pill-ok" : "pill-warn"}`}>
                    {memory.confirmed ? "confirmed" : "unconfirmed"}
                  </span>
                </div>
                <p>{memory.content}</p>
                <div className="memory-meta">
                  {memory.source ?? memory.origin}
                  <span>{new Date(memory.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="memory-actions">
                  <button className="btn" onClick={() => toggleConfirmed(memory)}>
                    <Check size={13} />
                    {memory.confirmed ? "Unconfirm" : "Confirm"}
                  </button>
                  <button className="btn btn-danger" onClick={() => removeMemory(memory.id)}>
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
