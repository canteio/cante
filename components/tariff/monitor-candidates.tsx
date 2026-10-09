"use client";

import { Fragment, useEffect, useState } from "react";
import type {
  CompanyImpactRow,
  MonitoredCompanyImpact,
} from "@/lib/tariff/monitor-company-impact";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 6 });
const showMoney = (value: number | null) => value === null ? "NEEDS REVIEW" : money.format(value);
const showRate = (value: number | null) => value === null ? "NEEDS REVIEW" : percent.format(value);

function Citation({ value }: { value: string }) {
  return /^https?:\/\//.test(value)
    ? <a href={value} target="_blank" rel="noreferrer">{value}</a>
    : <span>{value}</span>;
}

function RowEvidence({ row, effectiveDate }: { row: CompanyImpactRow; effectiveDate: string | null }) {
  return (
    <details>
      <summary>Calculation details — {row.sku}</summary>
      <p>Entry: {row.entryId ?? "annual portfolio"}{row.lineNumber ? ` · Line ${row.lineNumber}` : ""} · Import value used: {showMoney(row.basisValueUsd ?? null)}</p>
      <p>Trade-action effective date: {effectiveDate ?? "NEEDS REVIEW"}</p>
      {row.reviewReason && <p className="pill pill-warn" style={{ whiteSpace: "normal" }}>{row.reviewReason}</p>}
      {row.beforeEvidence && <details><summary>Before-rule calculation evidence</summary><p>{row.beforeEvidence.stackingExplanation.join(" ")}</p><ul>{row.beforeEvidence.components.map((component, index) => <li key={index}>{component.label}: {showRate(component.ratePercent)} · {showMoney(component.amount)}<ul>{component.citation.map(citation => <li key={citation}><Citation value={citation} /></li>)}</ul></li>)}</ul></details>}
      {row.evidence ? (
        <>
          <p>{row.evidence.stackingExplanation.join(" ")}</p>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th scope="col">Duty component</th><th scope="col">Rate</th><th scope="col">Amount</th><th scope="col">Basis</th><th scope="col">Authoritative citations</th></tr></thead>
              <tbody>{row.evidence.components.map((component, index) => (
                <tr key={`${component.type}-${component.label}-${index}`}>
                  <th scope="row">{component.label}</th>
                  <td>{component.ratePercent === null
                    ? component.contentRatePercent === undefined ? "not ad valorem" : percent.format(component.contentRatePercent)
                    : percent.format(component.ratePercent)}</td>
                  <td>{component.amount === null ? "not calculable" : money.format(component.amount)}</td>
                  <td>{component.explanation}</td>
                  <td><ul>{component.citation.map(citation => <li key={citation}><Citation value={citation} /></li>)}</ul></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {row.evidence.unresolvedMeasures.length > 0 && <p>Unresolved: {row.evidence.unresolvedMeasures.join("; ")}</p>}
        </>
      ) : <p className="muted">No deterministic duty calculation is linked to this product in the selected impact run.</p>}
    </details>
  );
}

export function MonitorCandidates({ runId }: { runId: string | null }) {
  const [impacts, setImpacts] = useState<MonitoredCompanyImpact[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    setImpacts(null);
    setError(false);
    void fetch(`/api/tariff/monitor-candidates?runId=${encodeURIComponent(runId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Company impact lookup failed");
        const data: { impacts: MonitoredCompanyImpact[] } = await response.json();
        if (!controller.signal.aborted) setImpacts(data.impacts);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [runId]);

  if (!runId) return <section className="card" aria-label="Company impact"><h2 className="card-title">Company impact</h2><p className="muted">Select or create an impact run to calculate monitored changes against catalogue-linked import rows.</p></section>;
  if (error) return <section className="card" aria-label="Company impact"><h2 className="card-title">Company impact</h2><p role="status">Company impact is unavailable. Review the workqueue.</p></section>;
  if (!impacts) return <section className="card" aria-label="Company impact"><h2 className="card-title">Company impact</h2><p role="status">Recomputing monitored trade actions before and after their effective dates…</p></section>;
  if (!impacts.length) return <section className="card" aria-label="Company impact"><h2 className="card-title">Company impact</h2><p className="muted">No monitored trade action matches a catalogue product linked to this impact run.</p></section>;

  return <section aria-labelledby="company-impact-heading">
    <div className="page-head">
      <div>
        <h1 id="company-impact-heading">Company impact</h1>
        <p className="page-sub">Monitored trade actions joined to catalogue-linked import rows and recomputed server-side across the verified rule effective date.</p>
      </div>
    </div>
    {impacts.map(impact => <article className="card" key={impact.findingId}>
      <div className="card-head">
        <div>
          <div className="eyebrow">{impact.action.sourceKind === "reviewed_reference" ? "REVIEWED HISTORICAL CHANGE" : "WHAT CHANGED"}</div>
          <h2 className="card-title">{impact.action.name}</h2>
          {impact.action.sourceKind === "reviewed_reference" && <p className="muted">A published historical reference replayed against your uploaded volumes. This is not a newly detected change.</p>}
          <p>Effective date: <strong>{impact.action.effectiveDate ?? "NEEDS REVIEW"}</strong></p>
          <p>Authoritative citation{impact.action.citations.length === 1 ? "" : "s"}: {impact.action.citations.length
            ? impact.action.citations.map((citation, index) => <Fragment key={citation}>{index > 0 ? "; " : ""}<Citation value={citation} /></Fragment>)
            : <strong> NEEDS REVIEW</strong>}</p>
        </div>
        <span className={`pill ${impact.status === "computed" ? "pill-ok" : "pill-warn"}`}>{impact.status === "computed" ? "COMPUTED" : "NEEDS REVIEW"}</span>
      </div>
      <div className="meta-row" style={{ flexWrap: "wrap" }}>
        <span className="pill pill-blue"><strong>ARE WE AFFECTED</strong>&nbsp; {impact.affectedProductCount} matched SKU/product(s)</span>
        <span className={impact.estimatedDutyDeltaUsd === null ? "pill pill-warn" : "pill pill-ok"}><strong>HOW MUCH</strong>&nbsp; {showMoney(impact.estimatedDutyDeltaUsd)}</span>
      </div>
      {impact.basis && <div className="card" style={{ marginTop: 16 }}>
        <strong>{impact.basis.kind === "historical_basket" ? "Estimate using your import history" : "Annual portfolio estimate"}</strong>
        <p>{impact.basis.kind === "historical_basket" ? `${impact.basis.entryCount} entry lines · ${impact.basis.periodStart ?? "unknown"} to ${impact.basis.periodEnd ?? "unknown"} · ` : ""}{showMoney(impact.basis.valueUsd)} customs value</p>
        <p className="muted">{impact.basis.explanation}</p>
      </div>}
      <p><strong>WHERE</strong> Products: {impact.products.length ? impact.products.join(", ") : "not identified"}; Suppliers: {impact.suppliers.length ? impact.suppliers.join(", ") : "not present in selected run"}; Business units: not present in company data.</p>
      {impact.reviewReason && <p className="pill pill-warn" style={{ whiteSpace: "normal" }}>{impact.reviewReason} A monitor match alone never establishes an old rate or dollar delta.</p>}
      <div role="region" aria-label={`Affected rows for ${impact.action.name}`} tabIndex={0} style={{ overflowX: "auto" }}>
        <table className="table">
          <caption className="muted" style={{ textAlign: "left", marginBottom: 8 }}>Impact equals after-rule duty minus before-rule duty on the same import values and quantities. Unresolved rules withhold the total.</caption>
          <thead><tr>{["SKU", "HTS", "Origin", "Previous Rate", "New Rate", "$ Impact", "Status"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{impact.rows.map((row, index) => <Fragment key={`${row.productId}-${row.sku}-${index}`}>
            <tr>
              <th scope="row">{row.sku}</th>
              <td className="mono">{row.hts ?? "not available"}</td>
              <td>{row.origin ?? "not available"}</td>
              <td>{showRate(row.previousRate)}</td>
              <td>{showRate(row.newRate)}</td>
              <td>{showMoney(row.impactUsd)}</td>
              <td><span className={`pill ${row.status === "computed" ? "pill-ok" : "pill-warn"}`}>{row.status === "computed" ? "COMPUTED" : "NEEDS REVIEW"}</span></td>
            </tr>
            <tr><td colSpan={7}><RowEvidence row={row} effectiveDate={impact.action.effectiveDate} /></td></tr>
          </Fragment>)}</tbody>
        </table>
      </div>
    </article>)}
  </section>;
}

interface ScheduleMonitorData {
  health: { revision: string; status: string; checked_at: string; last_success_at: string | null; completed_chapters: number; detail: string } | null;
  coverage: string;
  changes: Array<{ id: string; hts_code: string; from_revision: string; to_revision: string; detected_at: string; comparison: { baseDutyDeltaUsd: number | null; explanation: string; rows: Array<{ sku: string | null; entryId?: string | null; lineNumber?: string | null; beforeRate: string | null; afterRate: string | null; deltaUsd: number | null }> } }>;
}

export function ScheduleMonitor({ runId }: { runId: string | null }) {
  const [data, setData] = useState<ScheduleMonitorData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setData(null); setFailed(false);
    void fetch(`/api/tariff/monitor-status${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`, { signal: abort.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(value => { if (!abort.signal.aborted) setData(value); })
      .catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [runId]);
  const health = data?.health;
  const fresh = health?.status === "complete" && Date.now() - Date.parse(health.checked_at) < 24 * 60 * 60 * 1000;
  return <section className="card" aria-label="Official tariff source monitoring">
    <div className="card-head"><h2 className="card-title">Official tariff source monitoring</h2><span className={`pill ${fresh ? "pill-ok" : "pill-warn"}`}>{fresh ? "Schedule synchronized" : failed ? "Status unavailable" : health ? "Coverage needs attention" : "Checking coverage"}</span></div>
    {failed ? <p>Could not verify monitoring coverage. This is not an all-clear result.</p> : !data ? <p role="status">Loading source status…</p> : <>
      <p>{health ? `${health.revision} · ${health.completed_chapters}/99 chapters published · Last checked ${new Date(health.checked_at).toLocaleString()}` : "No completed synchronization status has been recorded."}</p>
      <p className="muted">Last complete synchronization: {health?.last_success_at ? new Date(health.last_success_at).toLocaleString() : "not established"}. {data.coverage}</p>
      {health && !fresh && <p className="pill pill-warn" style={{ whiteSpace: "normal" }}>{health.detail} {health.status === "complete" ? "The last check is more than 24 hours old." : ""}</p>}
      {!runId ? <p>Select an import run to see published changes that match its catalogue-linked HTS codes.</p> : data.changes.length === 0 ? <p>No recorded published-rate changes match this run. Change tracking starts when a prior schedule exists; this does not certify that no other trade regulation changed.</p> : data.changes.map(change => <details key={change.id} open>
        <summary>HTS {change.hts_code}: {change.from_revision} → {change.to_revision}</summary>
        <p>Detected {new Date(change.detected_at).toLocaleString()} · Legal effective date requires review. <a href="https://www.usitc.gov/harmonized_tariff_information/hts/archive/list" target="_blank" rel="noreferrer">Official schedule archive</a></p>
        <p><strong>Base-duty scenario: {showMoney(change.comparison.baseDutyDeltaUsd)}</strong></p>
        <p className="muted">{change.comparison.explanation}</p>
        <ul>{change.comparison.rows.map((row, index) => <li key={index}>{row.sku} {row.entryId ? `· Entry ${row.entryId}, line ${row.lineNumber}` : ""}: {row.beforeRate ?? "unresolved"} → {row.afterRate ?? "unresolved"} · {showMoney(row.deltaUsd)}</li>)}</ul>
      </details>)}
    </>}
  </section>;
}
