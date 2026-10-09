import Link from "next/link";
import {
  Boxes,
  Building2,
  Calculator,
  ClipboardCheck,
  FileText,
  Inbox,
  ListChecks,
  MessageSquare,
  Sparkles,
  Truck,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { AccountMenu } from "@/components/dashboard/account-menu";
// MVP: import { ChatNav } from "@/components/dashboard/chat-nav";
import { getAuthMode, hasSupabaseEnv } from "@/lib/auth/config";
import { DEFAULT_JURISDICTION, type JurisdictionName } from "@/lib/countries";

/** The signed-in account's email, or null in demo mode / when unauthenticated. */
async function currentAccountEmail(): Promise<string | null> {
  if (getAuthMode() !== "supabase" || !hasSupabaseEnv()) return null;
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;
    const claims = data?.claims;
    if (typeof claims?.email === "string") return claims.email;
    const metadataEmail =
      typeof claims?.user_metadata === "object" &&
      claims.user_metadata &&
      "email" in claims.user_metadata &&
      typeof claims.user_metadata.email === "string"
        ? claims.user_metadata.email
        : null;
    return metadataEmail;
  } catch {
    // Sidebar renders without an account label rather than failing the page.
    return null;
  }
}

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
    | "tariff"
    | "import-monitor";
  activeConversationId?: string | null;
  jurisdiction?: JurisdictionName;
}) {
  const email = await currentAccountEmail();
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

      <div className="side-section" style={{ paddingTop: 0 }}>
        <div className="side-label">Import review</div>
        <nav className="nav" aria-label="Main navigation">
          <Link href="/tariff" data-active={active === "tariff"}><Calculator size={15} />Imports &amp; results</Link>
          <Link href="/catalogue?country=United%20States" data-active={active === "catalogue"}><Boxes size={15} />Products</Link>
        </nav>
      </div>
      {/* MVP: broad compliance navigation retained below, disabled.
       Primary AI Assistant
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

       Regulatory Compliance & Action
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
          <Link href="/tariff" data-active={active === "tariff"}>
            <Calculator size={15} strokeWidth={1.75} />
            Tariff Stack Calculator
          </Link>
        </nav>
      </div>

       Company & Operations
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

      */}
      {/* Bottom Footer: Account */}
      <div className="sidebar-foot fade-3" style={{ marginTop: "auto" }}>
        <AccountMenu email={email} memoryHref={`/memory${countryQuery}`} />
      </div>
    </aside>
  );
}
