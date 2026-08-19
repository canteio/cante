import Link from "next/link";
import {
  Boxes,
  Brain,
  Building2,
  ClipboardCheck,
  FileText,
  Inbox,
  ListChecks,
  MessageSquare,
  Sparkles,
  Truck,
} from "lucide-react";
import { cookies } from "next/headers";
import { ChatNav } from "@/components/dashboard/chat-nav";
import { ProviderSwitcher } from "@/components/dashboard/provider-switcher";
import { listCustomers } from "@/lib/db/queries";
import { normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";
import { DEFAULT_JURISDICTION, type JurisdictionName } from "@/lib/countries";

/**
 * Enterprise Navigation Sidebar:
 * 1. AI Copilot (Primary Chat & Assistant)
 * 2. Regulatory Compliance (Checklist, Work Queue, Daily Checks)
 * 3. Company & Operations (Profile, Catalogue, Documents, Suppliers)
 * 4. Intelligence (Memory & Facts, Provider Switcher)
 */
export async function Sidebar({
  active,
  activeConversationId = null,
  jurisdiction = DEFAULT_JURISDICTION,
}: {
  active:
    | "checks"
    | "checklist"
    | "chat"
    | "memory"
    | "profile"
    | "catalogue"
    | "documents"
    | "workqueue"
    | "suppliers";
  activeConversationId?: string | null;
  jurisdiction?: JurisdictionName;
}) {
  const customers = await listCustomers();
  const selectedProvider = normalizeProviderChoice((await cookies()).get(PROVIDER_COOKIE)?.value);
  const countryQuery = `?country=${encodeURIComponent(jurisdiction)}`;

  return (
    <aside className="sidebar">
      <div className="brand fade-1">
        <div className="brand-mark serif">C</div>
        <div className="brand-name">Cante</div>
      </div>

      {/* Primary AI Assistant */}
      <div className="side-section fade-1" style={{ paddingTop: 0 }}>
        <div className="side-label">AI Assistant</div>
        <nav className="nav">
          <Link href={`/chat${countryQuery}`} data-active={active === "chat"}>
            <Sparkles size={15} strokeWidth={1.75} />
            AI Copilot
          </Link>
          {active === "chat" && (
            <ChatNav activeId={activeConversationId} jurisdiction={jurisdiction} />
          )}
        </nav>
      </div>

      {/* Regulatory Compliance & Action */}
      <div className="side-section fade-2">
        <div className="side-label">Compliance & Action</div>
        <nav className="nav">
          <Link href={`/checklist${countryQuery}`} data-active={active === "checklist"}>
            <ClipboardCheck size={15} strokeWidth={1.75} />
            Checklist & Permits
          </Link>
          <Link href={`/workqueue${countryQuery}`} data-active={active === "workqueue"}>
            <Inbox size={15} strokeWidth={1.75} />
            Action Work Queue
          </Link>
          <Link href={`/checks${countryQuery}`} data-active={active === "checks"}>
            <ListChecks size={15} strokeWidth={1.75} />
            Daily Checks & Feeds
          </Link>
        </nav>
      </div>

      {/* Company & Operations */}
      <div className="side-section fade-2">
        <div className="side-label">Company & Operations</div>
        <nav className="nav">
          <Link href={`/profile${countryQuery}`} data-active={active === "profile"}>
            <Building2 size={15} strokeWidth={1.75} />
            Company Profile
          </Link>
          <Link href={`/catalogue${countryQuery}`} data-active={active === "catalogue"}>
            <Boxes size={15} strokeWidth={1.75} />
            Product Catalogue
          </Link>
          <Link href={`/documents${countryQuery}`} data-active={active === "documents"}>
            <FileText size={15} strokeWidth={1.75} />
            Shipment Documents
          </Link>
          <Link href={`/suppliers${countryQuery}`} data-active={active === "suppliers"}>
            <Truck size={15} strokeWidth={1.75} />
            Suppliers & Evidence
          </Link>
        </nav>
      </div>

      {/* Active Customer Context */}
      <div className="side-section fade-2">
        <div className="side-label">Active Customer</div>
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

      {/* Bottom Footer: Memory & LLM Provider */}
      <div className="sidebar-foot fade-3">
        <Link
          href={`/memory${countryQuery}`}
          className="memory-nav"
          data-active={active === "memory"}
        >
          <Brain size={14} strokeWidth={1.75} />
          Memory & Facts
        </Link>
        <ProviderSwitcher initialProvider={selectedProvider} />
      </div>
    </aside>
  );
}
