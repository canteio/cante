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
import { BrandMark } from "@/components/brand-mark";
import { ChatNav } from "@/components/dashboard/chat-nav";
import { ProviderSwitcher } from "@/components/dashboard/provider-switcher";
import { listCustomers } from "@/lib/db/queries";
import { normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";
import { DEFAULT_JURISDICTION, type JurisdictionName } from "@/lib/countries";

/**
 * Enterprise Navigation Sidebar (Linear / Stripe / Salesforce inspired)
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
    | "suppliers"
    | "import-monitor";
  activeConversationId?: string | null;
  jurisdiction?: JurisdictionName;
}) {
  const customers = await listCustomers();
  const selectedProvider = normalizeProviderChoice((await cookies()).get(PROVIDER_COOKIE)?.value);
  const countryQuery = `?country=${encodeURIComponent(jurisdiction)}`;

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="brand fade-1" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark className="brand-mark" />
          <div className="brand-name">Cante</div>
        </div>
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
          <Link href="/import-monitor" data-active={active === "import-monitor"}>
            <Truck size={15} strokeWidth={1.75} />
            Import Monitoring
          </Link>
          <Link href={`/suppliers${countryQuery}`} data-active={active === "suppliers"}>
            <Truck size={15} strokeWidth={1.75} />
            Suppliers & Evidence
          </Link>
        </nav>
      </div>

      {/* Active Customer Workspace */}
      <div className="side-section fade-2" style={{ marginTop: "auto" }}>
        <div className="side-label">Active Workspace</div>
        {customers.length === 0 ? (
          <div style={{ padding: "0 10px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            None yet — run <code className="mono">npm run db:seed</code>
          </div>
        ) : (
          customers.map((c) => (
            <div key={c.id} className="customer-row" style={{ background: "var(--app-surface-active)", borderRadius: 6, border: "1px solid var(--border)" }}>
              <div className="avatar" style={{ background: "var(--accent-primary, #0284c7)", color: "#fff", fontWeight: 600 }}>
                {c.name.slice(0, 1)}
              </div>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </strong>
                <small style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--ok)" }} />
                  {c.city ? `${c.city}, ` : ""}{c.country}
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
