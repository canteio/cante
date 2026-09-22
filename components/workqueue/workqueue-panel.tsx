"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Inbox, CheckCircle2, Send, X, Clock, ExternalLink, AlertCircle, Copy, Check } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";
import type { GeneratedActionDrafts } from "@/lib/workflow/draft";

type Impact = {
  id: string;
  findingId: string;
  matchKind: string;
  confidence: string;
  effectiveOn: string | null;
  annualDutyAtRisk: number | null;
  estimatedAnnualExposure: number | null;
  estimatedMonthlyExposure: number | null;
  currency: string;
  delayRisk: string;
  basis: string[];
  tariffBasis: string | null;
  tariffCode: string | null;
  matchReason: string;
};

type QueueRow = {
  finding: {
    id: string;
    title: string;
    summaryEn: string | null;
    summaryId: string | null;
    regulationRef: string;
    enactedOn: string | null;
    url: string | null;
    relevance: string;
    reasoning: string | null;
  };
  state: string;
  action: {
    assignee: string | null;
    dueAt: string | null;
    forwardedTo: string | null;
    note: string | null;
    brokerDecision: string | null;
    updatedAt: string | null;
  } | null;
  impact: Impact[];
  overdue: boolean;
  drafts?: GeneratedActionDrafts;
};

const STATE_CLASS: Record<string, string> = {
  new: "pill-warn",
  acknowledged: "pill-muted",
  assigned: "pill-blue",
  forwarded_to_broker: "pill-blue",
  evidence_requested: "pill-warn",
  irrelevant: "pill-muted",
  closed: "pill-ok",
};

const CONFIDENCE_CLASS: Record<string, string> = {
  verified: "pill-ok",
  stated: "pill-blue",
  lead: "pill-warn",
  assumed: "pill-muted",
};

interface ActionModalState {
  findingId: string;
  state: string;
  title: string;
  primaryLabel: string;
  primaryPlaceholder: string;
  primaryValue: string;
  secondaryLabel?: string;
  secondaryPlaceholder?: string;
  secondaryValue?: string;
}

export function WorkQueuePanel({ country }: { country: JurisdictionName }) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [includeResolved, setIncludeResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  // UI/UX + a11y friction (workqueue-panel is the last of the three known
  // modal/popover patterns to get this fix — chat-panel's jurisdiction
  // picker and catalogue-panel's Add Product form already return focus):
  // this modal only *closed* on Escape/backdrop/Cancel, it never returned
  // keyboard focus to whichever "Acknowledge / Assign / Forward / Close /
  // Mark Irrelevant" button opened it, so keyboard and screen-reader users
  // got dropped back at the top of the document instead of where they were.
  // Track the button that opened the modal and refocus it on every close path.
  const triggerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setError(null);
    // Hide stale counts while reloading; a failed request is not an empty queue.
    setSummary({});
    try {
      const res = await fetch(
        `/api/workqueue?includeResolved=${includeResolved}&country=${encodeURIComponent(country)}`,
      );
      if (!res.ok) {
        const failure: unknown = await res.json().catch(() => null);
        const message = failure && typeof failure === "object" && "error" in failure
          && typeof failure.error === "string" && failure.error.trim()
          ? failure.error
          : `Could not load tasks (HTTP ${res.status}). Please retry.`;
        throw new Error(message);
      }
      const data = await res.json();
      setQueue(data.queue ?? []);
      setSummary(data.summary ?? {});
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Could not load tasks. Please retry.");
    } finally {
      setLoading(false);
    }
  }, [country, includeResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyDraft(key: string, text: string) {
    // UI/UX friction: navigator.clipboard.writeText() rejects silently in
    // browsers without clipboard permission (common in iframes/insecure
    // contexts) or without focus — the button just did nothing and the user
    // had no idea whether the draft was copied or the click was ignored.
    // Surface the failure via the existing error banner instead of letting
    // the promise rejection vanish into the console.
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setError("Could not copy to clipboard — your browser may be blocking clipboard access. Select and copy the text manually.");
    }
  }

  function closeActionModal() {
    setActionModal(null);
    // Return focus to the button that opened the modal (WAI-ARIA APG dialog
    // pattern) instead of leaving keyboard focus stranded on <body>.
    triggerRef.current?.focus();
  }

  function openActionModal(findingId: string, state: string) {
    // Capture the currently-focused element (the trigger button — a click
    // focuses its target before onClick fires) so we can restore focus later.
    triggerRef.current = document.activeElement as HTMLElement | null;
    if (state === "acknowledged") {
      void submitAction({ findingId, state });
      return;
    }
    if (state === "assigned") {
      setActionModal({
        findingId,
        state,
        title: "Assign Finding to Team Member",
        primaryLabel: "Assignee Name / Email *",
        primaryPlaceholder: "e.g. Example Reviewer (Compliance Lead)",
        primaryValue: "",
        secondaryLabel: "Target Due Date (Optional)",
        secondaryPlaceholder: "YYYY-MM-DD",
        secondaryValue: "",
      });
      return;
    }
    if (state === "forwarded_to_broker") {
      setActionModal({
        findingId,
        state,
        title: "Forward Finding to Customs Broker (PPJK / CHB)",
        primaryLabel: "Broker / PPJK Agency Name *",
        primaryPlaceholder: "e.g. PT Example Logistics Jakarta",
        primaryValue: "",
      });
      return;
    }
    if (state === "evidence_requested") {
      setActionModal({
        findingId,
        state,
        title: "Request Evidence from Supplier",
        primaryLabel: "Supplier / Counterparty Name *",
        primaryPlaceholder: "e.g. Acme Chemicals (Korea)",
        primaryValue: "",
      });
      return;
    }
    if (state === "irrelevant") {
      setActionModal({
        findingId,
        state,
        title: "Mark Finding as Irrelevant",
        primaryLabel: "Rationale / Justification (Recorded for Audit) *",
        primaryPlaceholder: "e.g. Facility does not use imported solvent grade covered by this regulation.",
        primaryValue: "",
      });
      return;
    }
    if (state === "closed") {
      setActionModal({
        findingId,
        state,
        title: "Close Finding & Record Resolution",
        primaryLabel: "Final Resolution / Broker Ruling *",
        primaryPlaceholder: "e.g. PPJK confirmed PI Bahan Baku quota is sufficient; clearance completed.",
        primaryValue: "",
      });
      return;
    }
  }

  async function submitAction(body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch("/api/workqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not update task.");
      else {
        closeActionModal();
        await load();
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function assess(findingId: string) {
    const res = await fetch("/api/workqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingId, action: "assess" }),
    });
    if (res.ok) await load();
  }

  // UI/UX + accessibility friction: the action modal below had no keyboard
  // escape hatch and no dialog semantics — a keyboard/screen-reader user had
  // to tab all the way to the visible "Cancel" button to back out (and a
  // screen reader announced no dialog role at all), while a mouse user
  // clicking the dimmed backdrop got nothing, unlike every other modal
  // pattern on the web. Standard WAI-ARIA APG dialog pattern: Escape closes,
  // role="dialog" + aria-modal="true" + aria-labelledby announce it.
  useEffect(() => {
    if (!actionModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeActionModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actionModal]);

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Action Work Queue &amp; Broker Dispatch</h1>
          <p className="page-sub">
            Regulatory amendments matched against your specific products and materials, financial duty exposure calculations,
            and 1-click communication drafts for your customs broker (PPJK), operations team, or suppliers.
          </p>
        </div>
        <CountryTabs value={country} />
      </div>

      {/* Task Summary Badges */}
      <div className="meta-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        {Object.entries(summary).map(([state, count]) => (
          <span key={state} className={`pill ${STATE_CLASS[state] ?? "pill-muted"}`}>
            {state.replace(/_/g, " ")}: {count}
          </span>
        ))}
        <button className="btn btn-small" onClick={() => setIncludeResolved((value) => !value)}>
          {includeResolved ? "Hide Resolved Tasks" : "Show All (Including Resolved)"}
        </button>
      </div>

      {/* UI/UX friction sweep (a11y): this error banner and the loading
          state below were plain divs with no ARIA role, so screen-reader
          users got zero notification when a task update failed or a
          reload was in progress — matches the role="alert"/role="status"
          pattern already established in app/import-monitor/panel.tsx. */}
      {error && <div className="pill pill-bad" role="alert" style={{ margin: "1rem 0" }}>{error}</div>}

      {/* Modal Action Sheet */}
      {actionModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) closeActionModal(); }}
        >
          <div className="card" role="dialog" aria-modal="true" aria-labelledby="action-modal-title" style={{ maxWidth: 520, width: "100%", background: "var(--app-surface)", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)" }}>
            <div className="card-head" style={{ justifyContent: "space-between" }}>
              <h2 id="action-modal-title" style={{ fontSize: "1.1rem" }}>{actionModal.title}</h2>
              <button className="icon-btn" aria-label="Close dialog" onClick={closeActionModal}><X size={14} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
              <div>
                <label className="side-label" style={{ padding: 0, marginBottom: 4, display: "block" }}>{actionModal.primaryLabel}</label>
                <input
                  className="input"
                  placeholder={actionModal.primaryPlaceholder}
                  value={actionModal.primaryValue}
                  onChange={(e) => setActionModal({ ...actionModal, primaryValue: e.target.value })}
                  autoFocus
                />
              </div>
              {actionModal.secondaryLabel && (
                <div>
                  <label className="side-label" style={{ padding: 0, marginBottom: 4, display: "block" }}>{actionModal.secondaryLabel}</label>
                  <input
                    className="input"
                    placeholder={actionModal.secondaryPlaceholder}
                    value={actionModal.secondaryValue || ""}
                    onChange={(e) => setActionModal({ ...actionModal, secondaryValue: e.target.value })}
                  />
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button className="btn" onClick={closeActionModal}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={!actionModal.primaryValue.trim()}
                  onClick={() => {
                    const body: Record<string, unknown> = {
                      findingId: actionModal.findingId,
                      state: actionModal.state,
                    };
                    if (actionModal.state === "assigned") {
                      body.assignee = actionModal.primaryValue.trim();
                      body.dueAt = actionModal.secondaryValue?.trim() || null;
                    }
                    if (actionModal.state === "forwarded_to_broker") {
                      body.forwardedTo = actionModal.primaryValue.trim();
                    }
                    if (actionModal.state === "evidence_requested") {
                      body.note = `Evidence requested from ${actionModal.primaryValue.trim()}`;
                    }
                    if (actionModal.state === "irrelevant") {
                      body.note = actionModal.primaryValue.trim();
                    }
                    if (actionModal.state === "closed") {
                      body.brokerDecision = actionModal.primaryValue.trim();
                    }
                    void submitAction(body);
                  }}
                >
                  Confirm &amp; Update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty" role="status">Loading tasks…</div>
      ) : loadError ? (
        <div role="alert" className="card">
          <p>{loadError}</p>
          <button className="btn" onClick={() => void load()}>Retry loading tasks</button>
        </div>
      ) : queue.length === 0 ? (
        <div className="empty">
          <Inbox size={24} strokeWidth={1.5} style={{ marginBottom: 8 }} />
          {/* An empty queue means "nothing currently flagged," not "certified compliant" —
              coverage depends on which regulations Cante is actively monitoring for this
              workspace. Overclaiming compliance here is a liability risk, not just a UX nit. */}
          <p>No open compliance tasks. Nothing is currently flagged for the regulations Cante is monitoring — this is not a compliance certification.</p>
        </div>
      ) : (
        <div className="checklist-grid">
          {queue.map((row) => (
            <article key={row.finding.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="checklist-card-top">
                <div>
                  <div className="mono" style={{ fontSize: "0.8rem", color: "var(--accent-primary, #0284c7)" }}>
                    {row.finding.regulationRef} {row.finding.enactedOn ? `• Enacted ${row.finding.enactedOn}` : ""}
                  </div>
                  <h3 style={{ margin: "2px 0 4px", fontSize: "1rem" }}>{row.finding.title}</h3>
                  {row.finding.summaryEn && (
                    <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>{row.finding.summaryEn}</p>
                  )}
                </div>
                <div className="meta-row">
                  <span className={`pill ${STATE_CLASS[row.state] ?? "pill-muted"}`}>
                    {row.state.replace(/_/g, " ")}
                  </span>
                  {row.overdue && <span className="pill pill-bad">Overdue</span>}
                </div>
              </div>

              {/* Assignment & State Notes */}
              {row.action && (row.action.assignee || row.action.forwardedTo || row.action.dueAt || row.action.brokerDecision) && (
                <div style={{ background: "var(--app-surface-active)", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}>
                  {row.action.assignee && (
                    <div style={{ fontSize: "0.8rem" }}><strong>Assigned to:</strong> {row.action.assignee} {row.action.dueAt ? `(Due: ${row.action.dueAt})` : ""}</div>
                  )}
                  {row.action.forwardedTo && (
                    <div style={{ fontSize: "0.8rem" }}><strong>Forwarded to Broker:</strong> {row.action.forwardedTo}</div>
                  )}
                  {row.action.brokerDecision && (
                    <div style={{ fontSize: "0.8rem", color: "var(--ok)", marginTop: 2 }}><strong>Resolution:</strong> {row.action.brokerDecision}</div>
                  )}
                </div>
              )}

              {/* Financial Exposure & Legal Basis */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                <div className="side-label" style={{ padding: 0, marginBottom: 4 }}>Financial Exposure Assessment</div>
                {row.impact.length === 0 ? (
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    Exposure not calculated yet. <button className="btn btn-small" onClick={() => void assess(row.finding.id)}>Calculate Now</button>
                  </div>
                ) : (
                  row.impact.map((imp) => (
                    <div key={imp.id} style={{ background: "var(--card-bg)", padding: "6px 8px", borderRadius: 4, marginBottom: 4 }}>
                      <div className="meta-row" style={{ justifyContent: "space-between" }}>
                        <span className="strong" style={{ fontSize: "0.85rem", color: imp.estimatedAnnualExposure ? "var(--danger)" : "var(--text)" }}>
                          {imp.estimatedAnnualExposure ? `${imp.currency} ${imp.estimatedAnnualExposure.toLocaleString()} / year` : (imp.annualDutyAtRisk ? `Duty at risk: ${imp.currency} ${imp.annualDutyAtRisk.toLocaleString()}/yr` : "Unquantified regulatory scope")}
                        </span>
                        <span className={`pill ${CONFIDENCE_CLASS[imp.confidence] ?? "pill-muted"}`}>{imp.confidence}</span>
                      </div>
                      <div className="code-basis" style={{ margin: "4px 0 0" }}>{imp.matchReason}</div>
                    </div>
                  ))
                )}
              </div>

              {/* 1-Click Action Drafts */}
              {row.drafts && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                  <div className="side-label" style={{ padding: 0, marginBottom: 4 }}>1-Click Communication Drafts</div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      className="btn btn-small"
                      onClick={() => copyDraft(`ppjk-${row.finding.id}`, row.drafts!.brokerDraft.body)}
                    >
                      {copiedKey === `ppjk-${row.finding.id}` ? <><Check size={12} /> Copied PPJK Draft!</> : "📱 Copy PPJK WhatsApp"}
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => copyDraft(`ops-${row.finding.id}`, row.drafts!.internalOpsDraft.body)}
                    >
                      {copiedKey === `ops-${row.finding.id}` ? <><Check size={12} /> Copied Ops Checklist!</> : "📋 Copy Ops Checklist"}
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => copyDraft(`sup-${row.finding.id}`, row.drafts!.supplierDraft.body)}
                    >
                      {copiedKey === `sup-${row.finding.id}` ? <><Check size={12} /> Copied Supplier Email!</> : "✉️ Copy Supplier Email"}
                    </button>
                  </div>
                </div>
              )}

              {/* Workflow Actions */}
              <div className="checklist-actions" style={{ marginTop: "auto", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                <button className="btn btn-small" onClick={() => openActionModal(row.finding.id, "acknowledged")}>
                  Acknowledge
                </button>
                <button className="btn btn-small" onClick={() => openActionModal(row.finding.id, "assigned")}>
                  Assign
                </button>
                <button className="btn btn-small" onClick={() => openActionModal(row.finding.id, "forwarded_to_broker")}>
                  Forward to Broker
                </button>
                <button className="btn btn-small" onClick={() => openActionModal(row.finding.id, "closed")}>
                  Close &amp; Resolve
                </button>
                <button className="btn btn-small btn-destructive" onClick={() => openActionModal(row.finding.id, "irrelevant")}>
                  Mark Irrelevant
                </button>
                {row.finding.url && (
                  <a className="btn btn-small" href={row.finding.url} target="_blank" rel="noreferrer noopener">
                    Source <ExternalLink size={11} style={{ display: "inline" }} />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
