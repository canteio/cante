"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
};

const CATEGORY_LABELS: Record<string, string> = {
  kbli: "KBLI",
  oss: "OSS",
  sni: "SNI",
  tax_customs: "Tax & customs",
  trade: "Trade",
  regional: "Regional",
  document: "Documents",
  memory: "Memory",
  other: "Other",
};

export function ChecklistPanel() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    const data = await fetch("/api/checklist").then((r) => r.json());
    setItems(data.items ?? []);
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    const data = await fetch("/api/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    setItems(data.items ?? []);
    setRefreshing(false);
  }

  async function setStatus(item: ChecklistItem, status: string) {
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, status } : row)));
    await fetch("/api/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status }),
    });
    await load();
  }

  useEffect(() => {
    void load();
    const onChanged = () => void refresh();
    window.addEventListener("cante:checklist-updated", onChanged);
    return () => window.removeEventListener("cante:checklist-updated", onChanged);
  }, []);

  const counts = useMemo(() => {
    const open = items.filter((item) => !["completed", "not_required"].includes(item.status)).length;
    const high = items.filter(
      (item) => item.priority === "high" && !["completed", "not_required"].includes(item.status),
    ).length;
    const verified = items.filter((item) => item.confidence === "verified").length;
    return { open, high, verified };
  }, [items]);

  return (
    <div className="main-scroll">
      <div className="checklist-main">
        <div className="page-head">
          <div>
            <h1>Checklist</h1>
            <p>Living compliance tasks generated from customer profile, memory, and source coverage.</p>
          </div>
          <button className="btn" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="checklist-summary">
          <SummaryCell label="Open" value={counts.open} tone="warn" />
          <SummaryCell label="High priority" value={counts.high} tone="bad" />
          <SummaryCell label="Verified" value={counts.verified} tone="ok" />
        </div>

        {loading ? (
          <div className="empty">Loading checklist...</div>
        ) : items.length === 0 ? (
          <div className="empty">No checklist rows yet. Add a customer and refresh.</div>
        ) : (
          <div className="checklist-grid">
            {items.map((item) => (
              <article
                key={item.id}
                className={`checklist-card priority-${item.priority}`}
                data-status={item.status}
              >
                <div className="checklist-card-top">
                  <div>
                    <span className="checklist-category">
                      {CATEGORY_LABELS[item.category] ?? item.category.replace("_", " ")}
                    </span>
                    <h2>{item.title}</h2>
                  </div>
                  <span className={`pill ${STATUS_CLASS[item.status] ?? "pill-muted"}`}>
                    {item.status.replace("_", " ")}
                  </span>
                </div>

                {item.whyApplies && <p className="checklist-why">{item.whyApplies}</p>}

                <div className="checklist-meta-row">
                  <span className="pill pill-muted">{item.priority} priority</span>
                  <span className="pill pill-muted">{item.sourceHealth.replace("_", " ")}</span>
                  <span className="pill pill-muted">{item.confidence}</span>
                </div>

                {item.linkedFacts.length > 0 && (
                  <div className="checklist-block">
                    <strong>Facts</strong>
                    {item.linkedFacts.slice(0, 4).map((fact) => (
                      <span key={fact}>{fact}</span>
                    ))}
                  </div>
                )}

                {item.openQuestions.length > 0 && (
                  <div className="checklist-block checklist-questions">
                    <strong>Open questions</strong>
                    {item.openQuestions.map((question) => (
                      <span key={question}>{question}</span>
                    ))}
                  </div>
                )}

                {item.evidenceRequired && (
                  <div className="checklist-evidence">
                    <CircleHelp size={14} />
                    <span>{item.evidenceRequired}</span>
                  </div>
                )}

                <div className="checklist-actions">
                  <button className="btn" onClick={() => setStatus(item, "completed")}>
                    <CheckCircle2 size={13} />
                    Complete
                  </button>
                  <button className="btn" onClick={() => setStatus(item, "needs_review")}>
                    <AlertTriangle size={13} />
                    Review
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
