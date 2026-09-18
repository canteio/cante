"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, Filter, Check, Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

type ChecklistItem = {
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  whyApplies: string | null;
  linkedFacts: string[];
  evidenceRequired: string | null;
  sourceHealth: string;
  confidence: string;
  openQuestions: string[];
  updatedAt: string;
};

const STATUS_CLASS: Record<string, string> = {
  completed: "pill-ok",
  not_required: "pill-muted",
  required: "pill-blue",
  needs_review: "pill-warn",
  blocked: "pill-bad",
  expiring: "pill-warn",
  unknown: "pill-muted",
  verified: "pill-ok",
  needs_evidence: "pill-warn",
  monitored: "pill-blue",
  not_applicable: "pill-muted",
  source_failed: "pill-bad",
  requires_expert_review: "pill-warn",
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "All Obligations",
  tax_customs: "Tax & Customs",
  kbli: "KBLI & Licensing",
  oss: "OSS RBA",
  trade: "Trade & Quotas",
  sni: "SNI Standards",
  environment: "Environmental (DLH/KLHK)",
  safety: "Workplace Safety (K3)",
  national: "National Regulations",
  regional: "Regional / Local Perda",
  export: "Export Controls",
};

export function ChecklistPanel({ country }: { country: JurisdictionName }) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  // UI/UX friction fix: load/refresh/setStatus previously had no error
  // handling at all — a failed fetch (network drop, 500, auth expiry) left
  // the panel silently stuck on "Loading checklist…" or reverted a status
  // change with zero explanation. Surface failures via a dismissible banner
  // (same pattern as components/workqueue/workqueue-panel.tsx) instead of
  // failing silently.
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/checklist?country=${encodeURIComponent(country)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load checklist.");
      setItems(data.items ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Could not load checklist.");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not recalculate checklist.");
      setItems(data.items ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Could not recalculate checklist.");
    } finally {
      setRefreshing(false);
    }
  }

  async function setStatus(item: ChecklistItem, status: string) {
    const previous = items;
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, status } : row)));
    try {
      const res = await fetch("/api/checklist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save status change.");
      }
      await load();
    } catch (e: any) {
      // Roll back the optimistic update so the UI doesn't lie about state
      // that was never actually persisted to the server.
      setItems(previous);
      setError(e.message ?? "Could not save status change.");
    }
  }

  useEffect(() => {
    void load();
    const onChanged = () => void refresh();
    window.addEventListener("cante:checklist-updated", onChanged);
    return () => window.removeEventListener("cante:checklist-updated", onChanged);
  }, [country]);

  const categories = useMemo(() => {
    const cats = new Set<string>(["all"]);
    for (const item of items) {
      if (item.category) cats.add(item.category);
    }
    return Array.from(cats);
  }, [items]);

  useEffect(() => {
    // Country changes and recalculation can remove the selected category.
    // Reset only missing filters so existing obligations never appear empty.
    if (!categories.includes(activeCategory)) setActiveCategory("all");
  }, [categories, activeCategory]);

  const filteredItems = useMemo(() => {
    if (activeCategory === "all") return items;
    return items.filter((i) => i.category === activeCategory);
  }, [items, activeCategory]);

  const counts = useMemo(() => {
    const closed = ["completed", "not_required", "verified", "not_applicable"];
    const open = items.filter((item) => !closed.includes(item.status)).length;
    const high = items.filter(
      (item) => item.priority === "high" && !closed.includes(item.status),
    ).length;
    const completed = items.filter((item) => closed.includes(item.status)).length;
    return { open, high, completed };
  }, [items]);

  return (
    <div className="main-scroll">
      <div className="checklist-main">
        <div className="page-head">
          <div>
            <h1>Compliance Checklist & Permits</h1>
            <p className="page-sub">
              Mandatory legal obligations, operating permits, and certifications required to clear customs,
              prevent factory fines, and maintain full statutory compliance.
            </p>
          </div>
          <div className="page-actions">
            <button className="btn" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              {refreshing ? "Recalculating…" : "Recalculate"}
            </button>
            <CountryTabs value={country} />
          </div>
        </div>

        {/* UI/UX friction sweep (a11y): error banner and loading state had
            no ARIA role, so a screen-reader user got no notification when
            a status save/recalculate failed or a load was in progress —
            same role="alert"/role="status" pattern applied across
            import-monitor, workqueue, and catalogue panels this sweep. */}
        {error && (
          <div className="pill pill-bad" role="alert" style={{ margin: "0.75rem 0" }}>
            {error}
          </div>
        )}

        {/* Summary Row */}
        <div className="checklist-summary">
          <SummaryCell label="Action Required" value={counts.open} tone="warn" />
          <SummaryCell label="High Priority Gaps" value={counts.high} tone="bad" />
          <SummaryCell label="Fulfilled & Verified" value={counts.completed} tone="ok" />
        </div>

        {/* Category Filters */}
        <div className="meta-row" style={{ marginTop: "1rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`pill ${activeCategory === cat ? "pill-blue" : "pill-muted"}`}
              style={{ cursor: "pointer", border: "none", padding: "6px 12px" }}
              aria-pressed={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            >
              {CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ")} (
              {cat === "all" ? items.length : items.filter((i) => i.category === cat).length}
              )
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty" role="status">Loading checklist…</div>
        ) : filteredItems.length === 0 ? (
          <div className="empty">No checklist rows for this filter.</div>
        ) : (
          <div className="checklist-grid">
            {filteredItems.map((item) => (
              <article
                key={item.id}
                className={`checklist-card priority-${item.priority}`}
                data-status={item.status}
              >
                <div className="checklist-card-top">
                  <div>
                    <span className="checklist-category">
                      {CATEGORY_LABELS[item.category] ?? item.category.replace(/_/g, " ")}
                    </span>
                    <h2 style={{ fontSize: "1rem", marginTop: 2 }}>{item.title}</h2>
                  </div>
                  <span className={`pill ${STATUS_CLASS[item.status] ?? "pill-muted"}`}>
                    {item.status.replace(/_/g, " ")}
                  </span>
                </div>

                {item.whyApplies && (
                  <div style={{ background: "var(--card-bg)", padding: "8px 10px", borderRadius: 4, margin: "8px 0", borderLeft: "3px solid var(--accent)" }}>
                    <div className="side-label" style={{ padding: 0, marginBottom: 2 }}>Legal Rationale</div>
                    <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>{item.whyApplies}</p>
                  </div>
                )}

                {item.evidenceRequired && (
                  <div className="checklist-evidence" style={{ margin: "8px 0" }}>
                    <CircleHelp size={14} />
                    <span><strong>Required Evidence:</strong> {item.evidenceRequired}</span>
                  </div>
                )}

                {item.linkedFacts.length > 0 && (
                  <div className="checklist-block" style={{ margin: "8px 0", maxWidth: "100%" }}>
                    <div className="side-label" style={{ padding: 0, marginBottom: 4 }}>Triggered by Profile Data</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {item.linkedFacts.map((fact, idx) => (
                        <div
                          key={idx}
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)",
                            background: "var(--app-surface-active)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            padding: "5px 8px",
                            wordBreak: "break-word",
                            whiteSpace: "normal",
                            lineHeight: 1.35,
                          }}
                        >
                          {fact}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="checklist-actions" style={{ marginTop: "1rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                  <button
                    className="btn btn-small"
                    style={{ color: "var(--ok)" }}
                    onClick={() => setStatus(item, "completed")}
                  >
                    <CheckCircle2 size={13} />
                    Mark Fulfilled
                  </button>
                  <button
                    className="btn btn-small"
                    style={{ color: "var(--warn)" }}
                    onClick={() => setStatus(item, "needs_review")}
                  >
                    <Clock size={13} />
                    Needs Review
                  </button>
                  <button
                    className="btn btn-small"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => setStatus(item, "not_applicable")}
                  >
                    N/A
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

function SummaryCell({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`checklist-summary-cell tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
