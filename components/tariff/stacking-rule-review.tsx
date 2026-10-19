"use client";

import { useEffect, useState } from "react";
import type { StackingProposal } from "@/lib/tariff/stacking-authoring-contract";

type Draft = { id: string; proposed_rule: StackingProposal; verifier_verdict: string; verifier_reasoning: string; status: string; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null };
type Rule = { id: string; target_measure: string; conditions: Record<string, unknown>; action: string; rule_text: string; citation: string };
type Job = { id: string; citation: string; status: string; detail: string | null; created_at: string; started_at: string; detected_flags?: Array<{ target_measure: string; reason: string }> };

function ReviewDraft({ draft, rules, onReviewed }: { draft: Draft; rules: Rule[]; onReviewed: () => Promise<void> }) {
  const p = draft.proposed_rule;
  const [conditions, setConditions] = useState(JSON.stringify(p.conditions, null, 2));
  const [precedenceId, setPrecedenceId] = useState(p.precedence_over ?? "");
  const [precedenceReason, setPrecedenceReason] = useState(p.precedence_reason ?? "");
  const [note, setNote] = useState("");
  const [sourceRead, setSourceRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const related = rules.filter(rule => rule.target_measure === p.target_measure);
  async function decide(decision: "confirm" | "reject") {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/tariff/stacking-rules", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id, decision, ...(decision === "confirm" ? { conditions: JSON.parse(conditions), precedenceId: precedenceId || null, precedenceReason: precedenceReason || null, sourceRead } : {}), note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Review failed");
      await onReviewed();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save review"); }
    finally { setBusy(false); }
  }
  return <article className="stacking-draft">
    <div className="stacking-draft-heading"><strong>{p.target_measure}</strong><span className={`stacking-verdict ${draft.verifier_verdict === "confirmed" ? "" : "stacking-verdict-warning"}`}>{draft.verifier_verdict === "confirmed" ? "AI checks agree" : draft.verifier_verdict === "disputed" ? "AI checks disagree" : "Evidence incomplete"}</span></div>
    <p>{p.rule_text}</p>
    <p className="stacking-rule-facts">{p.action === "cap_at" ? `Cap component at ${((p.cap_rate_percent ?? 0) * 100).toFixed(2)}%` : p.action === "exclude" ? "Exclude component" : "Include component"} · Effective {p.effective_date ?? "not established"}{p.expires_date ? ` · Expires ${p.expires_date}` : ""}</p>
    <a href={p.citation} target="_blank" rel="noreferrer">Read official source ↗</a>
    <blockquote>{p.evidence_quote}</blockquote>
    <details><summary>Verifier’s reasoning</summary><p>{draft.verifier_reasoning}</p></details>
    <details><summary>Conditions &amp; existing rules</summary>
      <label>Shipment conditions (you may narrow the scope)<textarea value={conditions} onChange={e => setConditions(e.target.value)} rows={5} spellCheck={false} /></label>
      {related.map(rule => <div className="stacking-existing-rule" key={rule.id}><strong>{rule.action}: {rule.rule_text}</strong><pre>{JSON.stringify(rule.conditions, null, 2)}</pre>{rule.citation.startsWith("https://") ? <a href={rule.citation} target="_blank" rel="noreferrer">Official source ↗</a> : <span>{rule.citation}</span>}</div>)}
      {related.length > 0 && <><label>Which existing rule does this supersede in the overlap?<select value={precedenceId} onChange={e => setPrecedenceId(e.target.value)}><option value="">None — conditions do not overlap</option>{related.map(rule => <option key={rule.id} value={rule.id}>{rule.rule_text}</option>)}</select></label>{precedenceId && <label>Legal basis for precedence<textarea value={precedenceReason} onChange={e => setPrecedenceReason(e.target.value)} rows={2} /></label>}</>}
    </details>
    <label className="stacking-source-check"><input type="checkbox" checked={sourceRead} onChange={e => setSourceRead(e.target.checked)} /> I read the official source and verified the action, scope, and dates.</label>
    <label>Source review / legal basis<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Record why this rule is supported, including how you resolved any disagreement." /></label>
    {error && <p role="alert" className="stacking-review-error">{error}</p>}
    <div className="stacking-review-actions"><button type="button" className="btn btn-primary" disabled={busy || !sourceRead || note.trim().length < 10} onClick={() => void decide("confirm")}>{busy ? "Saving…" : "Confirm rule"}</button><button type="button" className="btn" disabled={busy} onClick={() => void decide("reject")}>Reject</button></div>
  </article>;
}

function RetryAuthoring({ job, onRetried }: { job: Job; onRetried: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/tariff/stacking-rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id, decision: "retry" }) });
      if (!response.ok) throw new Error("Authoring retry did not complete. Review the updated record.");
    } catch (e) { setError(e instanceof Error ? e.message : "Retry failed"); }
    finally { await onRetried(); setBusy(false); }
  }
  if (job.status !== "queued" && job.status !== "failed" && !(job.status === "running" && Date.parse(job.started_at) < Date.now() - 300000)) return null;
  return <span><button type="button" className="btn" disabled={busy} onClick={() => void retry()}>{busy ? "Authoring…" : job.status === "queued" ? "Draft rules" : "Retry authoring"}</button>{error && <span role="alert"> {error}</span>}</span>;
}

export function StackingRuleReview({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<{ drafts: Draft[]; rules: Rule[]; jobs: Job[]; totalPending: number; hasMore: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(true);
  const [offset, setOffset] = useState(0);
  async function refresh() {
    try {
      const response = await fetch(`/api/tariff/stacking-rules?offset=${offset}`, { cache: "no-store" });
      if (response.status === 403 || response.status === 401) { setAuthorized(false); return; }
      if (!response.ok) throw new Error("Could not load rule reviews. Try again.");
      setData(await response.json()); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load rule reviews"); }
  }
  useEffect(() => { void refresh(); }, [refreshKey, offset]);
  if (!authorized) return null;
  const pending = data?.drafts.filter(d => d.status === "pending") ?? [];
  return <details className="stacking-review"><summary>Tariff rule reviews{data ? ` · ${data.totalPending} pending` : ""}</summary>
    <p className="stacking-rule-facts">Review how duties combine. Confirmed rules apply to future calculations; saved audits stay unchanged.</p>
    {error && <p role="alert">{error} <button type="button" className="btn" onClick={() => void refresh()}>Retry</button></p>}
    {!data && !error && <p role="status">Loading reviews…</p>}
    {data && data.totalPending === 0 && <p>No pending rule drafts.</p>}
    {pending.map(draft => <ReviewDraft key={draft.id} draft={draft} rules={data?.rules ?? []} onReviewed={refresh} />)}
    {data && (offset > 0 || data.hasMore) && <div className="stacking-review-actions"><button type="button" className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button><button type="button" className="btn" disabled={!data.hasMore} onClick={() => setOffset(offset + 20)}>Next reviews</button></div>}
    {data && data.jobs.length > 0 && <details><summary>Authoring records</summary>{data.jobs.map(job => <p key={job.id}><a href={job.citation} target="_blank" rel="noreferrer">Official source</a> · {job.status} · {new Date(job.created_at).toLocaleString()}<br />{job.detail}{job.detected_flags?.map(flag => <span key={flag.target_measure}><br />Flagged: {flag.target_measure} — {flag.reason}</span>)}<br /><RetryAuthoring job={job} onRetried={refresh} /></p>)}</details>}
    {data && data.drafts.some(d => d.status !== "pending") && <details><summary>Reviewed drafts</summary>{data.drafts.filter(d => d.status !== "pending").map(d => <p key={d.id}>{d.proposed_rule.target_measure} · {d.status}<br />{d.review_note}<br /><small>{d.reviewed_at ? new Date(d.reviewed_at).toLocaleString() : ""} · Reviewer {d.reviewed_by}</small></p>)}</details>}
  </details>;
}
