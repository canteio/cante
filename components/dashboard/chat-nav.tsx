"use client";

import Link from "next/link";
import { MessageSquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { JurisdictionName } from "@/lib/countries";

type Conversation = { id: string; title: string; updatedAt: string };

export function ChatNav({ activeId, jurisdiction }: { activeId: string | null; jurisdiction: JurisdictionName }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState(activeId);
  const [loading, setLoading] = useState(true);

  async function load() {
    const data = await fetch(`/api/conversations?country=${encodeURIComponent(jurisdiction)}`).then((r) => r.json());
    setConversations(data.conversations ?? []);
    setLoading(false);
  }

  useEffect(() => {
    setCurrentId(activeId);
  }, [activeId]);

  useEffect(() => {
    void load();
    const onChanged = (event: Event) => {
      const nextId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (nextId) setCurrentId(nextId);
      void load();
    };
    window.addEventListener("cante:conversations-updated", onChanged);
    return () => window.removeEventListener("cante:conversations-updated", onChanged);
  }, [jurisdiction]);

  async function removeConversation(id: string, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
    if (id === currentId) {
      setCurrentId(null);
      window.history.pushState(null, "", `/chat?country=${encodeURIComponent(jurisdiction)}`);
      window.dispatchEvent(new CustomEvent("cante:chat-new"));
    }
  }

  return (
    <div className="nav-subtree">
      <Link href={`/chat?country=${encodeURIComponent(jurisdiction)}`} className="nav-new-chat" onClick={() => setCurrentId(null)}>
        <MessageSquarePlus size={13} />
        New chat
      </Link>

      {loading ? (
        <div className="nav-empty">Loading chats…</div>
      ) : conversations.length === 0 ? (
        <div className="nav-empty">No saved chats yet.</div>
      ) : (
        conversations.map((conversation) => (
          <Link
            key={conversation.id}
            href={`/chat?country=${encodeURIComponent(jurisdiction)}&conversationId=${conversation.id}`}
            className="nav-chat-item"
            data-active={conversation.id === currentId}
          >
            <span>{conversation.title}</span>
            <button
              type="button"
              aria-label="Delete conversation"
              onClick={(event) => removeConversation(conversation.id, event)}
            >
              <X size={11} />
            </button>
          </Link>
        ))
      )}
    </div>
  );
}
