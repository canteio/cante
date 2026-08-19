"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

/**
 * Work queue (item 4) with impact (item 5).
 *
 * Two display rules carry the project's discipline into the UI:
 *   - an exposure figure is never shown without its basis;
 *   - "not calculable" is rendered as its own state, never as a zero.
 */

type Impact = {
  id: string;
  matchKind: string;
  matchReason: string;
  effectiveOn: string | null;
  nextAffectedShipmentAt: string | null;
  estimatedAnnualExposure: number | null;
  estimatedMonthlyExposure: number | null;
  annualDutyAtRisk: number | null;
  tariffCode: string | null;
  tariffBasis: string | null;
  currency: string;
  delayRisk: string;
  basis: string[];
  confidence: string;
};

type QueueRow = {
  finding: { id: string; title: string; url: string | null; relevance: string; summaryEn: string | null };
  state: string;
  overdue: boolean;
  action: { assignee: string | null; forwardedTo: string | null; dueAt: string | null; brokerDecision: string | null; note: string | null } | null;
  impact: Impact[];
  drafts?: {
    brokerDraft: { recipient: string; channel: string; subject?: string; body: string };
    internalOpsDraft: { title: string; checklist: string[]; body: string };
    supplierDraft: { recipient: string; subject: string; body: string };
  };
};

const STATE_CLASS: Record<string, string> = {
  new: "pill-warn",
  acknowledged: "pill-blue",
  assigned: "pill-blue",
  forwarded_to_broker: "pill-blue",
  evidence_requested: "pill-warn",
  irrelevant: "pill-muted",
  closed: "pill-ok",
};

const CONFIDENCE_CLASS: Record<string, string> = {
  verified: "pill-ok",
  estimated: "pill-blue",
  indicative: "pill-warn",
};

export function WorkQueuePanel({ country }: { country: JurisdictionName }) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyDraft = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/workqueue?includeResolved=${includeResolved}&country=${encodeURIComponent(country)}`);
    const data = await res.json();
    setQueue(data.queue ?? []);
    setSummary(data.summary ?? {});
    setLoading(false);
  }, [includeResolved, country]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(findingId: string, state: string) {
    setError(null);
    const body: Record<string, unknown> = { findingId, state };

    if (state === "assigned") {
      const assignee = window.prompt("Assign to whom?");
      if (!assignee) return;
      body.assignee = assignee;
      body.dueAt = window.prompt("Due date (YYYY-MM-DD), optional") || null;
    }
    if (state === "forwarded_to_broker") {
      const forwardedTo = window.prompt("Forward to which broker?");
      if (!forwardedTo) return;
      body.forwardedTo = forwardedTo;
    }
    if (state === "irrelevant") {
      const note = window.prompt("Why is this irrelevant? (required — it is recorded)");
      if (!note) return;
      body.note = note;
    }
    if (state === "closed") {
      body.brokerDecision = window.prompt("Record the decision, if any") || null;
    }

    const res = await fetch("/api/workqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Could not update.");
    else await load();
  }

  async function assess(findingId: string) {
    const res = await fetch("/api/workqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingId, action: "assess" }),
    });
    if (res.ok) await load();
  }

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Work queue</h1>
          <p className="page-sub">
            Findings the monitor raised, what has been done about them, and what they are estimated
            to cost. Every figure is shown with the assumptions behind it.
          </p>
        </div>
        <CountryTabs value={country} />
      </div>

      <div className="meta-row">
        {Object.entries(summary).map(([state, count]) => (
          <span key={state} className={`pill ${STATE_CLASS[state] ?? "pill-muted"}`}>
            {state.replace(/_/g, " ")}: {count}
          </span>
        ))}
        <button className="btn btn-small" onClick={() => setIncludeResolved((value) => !value)}>
          {includeResolved ? "Hide resolved" : "Show resolved"}
        </button>
      </div>

      {error && <div className="pill pill-bad">{error}</div>}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="empty">
          <Inbox size={20} strokeWidth={1.5} />
          <p>Nothing open. A quiet queue is the product working, not failing.</p>
        </div>
      ) : (
        <div className="checklist-grid">
          {queue.map((row) => (
            <article key={row.finding.id} className="card">
              <div className="checklist-card-top">
                <div>
                  <div className="strong">{row.finding.title}</div>
                  {row.finding.summaryEn && (
                    <div className="checklist-summary">{row.finding.summaryEn}</div>
                  )}
                </div>
                <div className="meta-row">
                  <span className={`pill ${STATE_CLASS[row.state] ?? "pill-muted"}`}>
                    {row.state.replace(/_/g, " ")}
                  </span>
                  {row.overdue && <span className="pill pill-bad">overdue</span>}
                </div>
              </div>

              {row.action && (
                <div className="checklist-meta-row">
                  {row.action.assignee && (
                    <span className="pill pill-muted">assigned: {row.action.assignee}</span>
                  )}
                  {row.action.forwardedTo && (
                    <span className="pill pill-muted">broker: {row.action.forwardedTo}</span>
                  )}
                  {row.action.dueAt && (
                    <span className="pill pill-muted">due {row.action.dueAt}</span>
                  )}
                </div>
              )}
              {row.action?.brokerDecision && (
                <div className="checklist-block">
                  <div className="side-label">Broker decision</div>
                  <div>{row.action.brokerDecision}</div>
                </div>
              )}
              {row.action?.note && <div className="checklist-why">{row.action.note}</div>}

              <div className="checklist-block">
                <div className="side-label">Impact</div>
                {row.impact.length === 0 ? (
                  <div className="muted">
                    Not assessed yet.{" "}
                    <button className="btn btn-small" onClick={() => void assess(row.finding.id)}>
                      Assess
                    </button>
                  </div>
                ) : (
                  row.impact.map((impact) => (
                    <div key={impact.id} className="impact-row">
                      <div className="meta-row">
                        <span className="pill pill-muted">
                          {impact.matchKind.replace(/_/g, " ")}
                        </span>
                        <span className={`pill ${CONFIDENCE_CLASS[impact.confidence] ?? "pill-muted"}`}>
                          {impact.confidence}
                        </span>
                        {impact.effectiveOn && (
                          <span className="pill pill-blue">effective {impact.effectiveOn}</span>
                        )}
                        {impact.delayRisk !== "none" && (
                          <span className="pill pill-warn">delay risk: {impact.delayRisk}</span>
                        )}
                      </div>
                      {impact.annualDutyAtRisk !== null && (
                        <div className="strong">
                          Duty at risk: {impact.currency}{" "}
                          {impact.annualDutyAtRisk.toLocaleString()}/year
                          {impact.tariffBasis ? ` · ${impact.tariffBasis}` : ""}
                          {impact.tariffCode ? ` (${impact.tariffCode})` : ""}
                        </div>
                      )}
                      <div className="strong">
                        {impact.estimatedAnnualExposure === null ? (
                          impact.annualDutyAtRisk === null
                            ? "Exposure not calculable from what is on file."
                            : "Rate change not quantified — the figure above is the duty currently flowing through this lane, not the delta."
                        ) : (
                          <>
                            {impact.currency} {impact.estimatedAnnualExposure.toLocaleString()}/year
                            {impact.estimatedMonthlyExposure !== null && (
                              <>
                                {" · "}
                                {impact.currency}{" "}
                                {impact.estimatedMonthlyExposure.toLocaleString()}/month
                              </>
                            )}
                          </>
                        )}
                      </div>
                      <div className="code-basis">{impact.matchReason}</div>
                      {impact.basis.map((line, index) => (
                        <div key={index} className="code-basis muted">
                          {line}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              {row.drafts && (
                <div className="checklist-block">
                  <div className="side-label">Action Drafts</div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                    <button
                      className="btn btn-small"
                      onClick={() => copyDraft(`ppjk-${row.finding.id}`, row.drafts!.brokerDraft.body)}
                    >
                      {copiedKey === `ppjk-${row.finding.id}` ? "✓ Copied PPJK Draft!" : "📱 Copy PPJK WhatsApp"}
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => copyDraft(`ops-${row.finding.id}`, row.drafts!.internalOpsDraft.body)}
                    >
                      {copiedKey === `ops-${row.finding.id}` ? "✓ Copied Ops Checklist!" : "📋 Copy Ops Checklist"}
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => copyDraft(`sup-${row.finding.id}`, row.drafts!.supplierDraft.body)}
                    >
                      {copiedKey === `sup-${row.finding.id}` ? "✓ Copied Supplier Inquiry!" : "✉️ Copy Supplier Inquiry"}
                    </button>
                  </div>
                </div>
              )}

              <div className="checklist-actions">
                <button className="btn btn-small" onClick={() => void act(row.finding.id, "acknowledged")}>
                  Acknowledge
                </button>
                <button className="btn btn-small" onClick={() => void act(row.finding.id, "assigned")}>
                  Assign
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => void act(row.finding.id, "forwarded_to_broker")}
                >
                  Forward to broker
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => void act(row.finding.id, "evidence_requested")}
                >
                  Request evidence
                </button>
                <button className="btn btn-small" onClick={() => void act(row.finding.id, "irrelevant")}>
                  Mark irrelevant
                </button>
                <button className="btn btn-small" onClick={() => void act(row.finding.id, "closed")}>
                  Close
                </button>
                {row.finding.url && (
                  <a className="btn btn-small" href={row.finding.url} target="_blank" rel="noreferrer noopener">
                    Source
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
