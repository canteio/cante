import Link from "next/link";
import { Brain, ListChecks, MessageSquare } from "lucide-react";
import { ChatNav } from "@/components/dashboard/chat-nav";
import { listCustomers } from "@/lib/db/queries";
import { getProvider } from "@/lib/llm";

/**
 * Sidebar in Mike's shape: brand mark, nav rows, a customer block, and status
 * pinned to the bottom. Staggered fade-in copied from its .sidebar-fade-in.
 *
 * The provider status stays here even though Mike has no equivalent — whether
 * the model is reachable is the one fact that decides if a check can run.
 */
export async function Sidebar({
  active,
  activeConversationId = null,
}: {
  active: "checks" | "chat" | "memory";
  activeConversationId?: string | null;
}) {
  const customers = await listCustomers();
  const provider = getProvider();
  const health = await provider.available();

  return (
    <aside className="sidebar">
      <div className="brand fade-1">
        <div className="brand-mark serif">C</div>
        <div className="brand-name">Cante</div>
      </div>

      <nav className="nav fade-1">
        <Link href="/" data-active={active === "checks"}>
          <ListChecks size={15} strokeWidth={1.75} />
          Checks
        </Link>
        <Link href="/chat" data-active={active === "chat"}>
          <MessageSquare size={15} strokeWidth={1.75} />
          Chat
        </Link>
        {active === "chat" && <ChatNav activeId={activeConversationId} />}
      </nav>

      <div className="side-section fade-2">
        <div className="side-label">Customers</div>
        {customers.length === 0 ? (
          <div style={{ padding: "0 10px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            None yet — run <code className="mono">npm run db:seed</code>
          </div>
        ) : (
          customers.map((c) => (
            <div key={c.id} className="customer-row">
              <div className="avatar">{c.name.slice(0, 1)}</div>
              <div style={{ minWidth: 0 }}>
                <strong>{c.name}</strong>
                <small>
                  {c.city ? `${c.city}, ` : ""}
                  {c.country}
                </small>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-foot fade-3">
        <Link href="/memory" className="memory-nav" data-active={active === "memory"}>
          <Brain size={14} strokeWidth={1.75} />
          Memory
        </Link>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className={`pill ${health.ok ? "pill-ok" : "pill-bad"}`}>{provider.name}</span>
        </div>
        <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
          {health.detail}
        </div>
      </div>
    </aside>
  );
}
