import Link from "next/link";
import type { LiveCheckResult } from "@/app/api/tariff/live-check/check";
const money = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n) : "Not established";

/** Same report for first upload and returning checks. Review leads never acquire
 * a dollar delta by being close to an HTS code in a publication. */
export function ProductImpactReport({ result, checkId }: { result: LiveCheckResult; checkId?: string | null }) {
  const comparison = result.comparison;
  const candidateSkus = result.historicalComparison.status === "compared" ? result.historicalComparison.candidateSkus : [];
  const candidateCount = result.historicalComparison.candidateProducts?.length ?? candidateSkus.length;
  const fictional = result.rows.some(row => row.product.fictional);
  const unit = result.basis === "annual" ? "per year at uploaded volumes" : "on the uploaded historical values";
  const changes = comparison?.rows?.filter(row => row.status === "changed") ?? [];
  return <section className="product-impact-report" aria-labelledby="product-impact-title">
    <div className="tariff-section-heading"><div><span className="tariff-eyebrow">Your file → product costs</span><h2 id="product-impact-title">What changed for your products?</h2><p>{fictional && <strong>Fictional test inputs. </strong>}{result.basis === "annual" ? "Annual values held constant; future law is not predicted." : "Historical goods repriced today; this is not a refund calculation or annual forecast."}</p></div>{checkId && <Link href={`/tariff/history?check=${encodeURIComponent(checkId)}`}>Saved evidence →</Link>}</div>
    <p className="muted">Calculations cover supported rules. Exclusions and other legal scope may still need review.</p>
    <div className="impact-report-metrics"><div><strong>{money(result.totalDuty)}</strong><span>Calculated combined duties · {unit}</span></div><div><strong>{money(comparison?.fullDutyDifference)}</strong><span>Cost difference from verified prior check</span></div><div><strong>{result.unresolvedProducts}</strong><span>Products without a complete calculation</span></div></div>
    {result.baselineCheckId && <p><Link href={`/tariff/history?check=${encodeURIComponent(result.baselineCheckId)}`}>Before: verified previous check and evidence →</Link></p>}
    <p>{comparison?.reason ?? "No verified previous check is available. A first check establishes current costs; it cannot establish a cost change."}</p>
    {changes.length > 0 && <p><strong>{changes.length} product group{changes.length === 1 ? " has" : "s have"} a calculated duty difference.</strong> Review the retained before/after evidence and coverage before treating it as a confirmed legal obligation.</p>}
    {candidateCount > 0 && <p><strong>{candidateCount} product group{candidateCount === 1 ? " matches" : "s match"} changed tariff text.</strong> Those matches require applicability review and are separate from calculated cost differences.</p>}
    <details className="tariff-explanation"><summary>Published tariff text changes ({result.historicalComparison.legalChanges.length})</summary>
      <p>{result.historicalComparison.status === "compared" ? "These differences come from the retained, version-identified official documents. Wording changes are review leads; applicability and effective dates still need review." : "The previous/current legal-text comparison is unavailable. No no-change conclusion is claimed."}</p>
      {result.historicalComparison.legalChanges.map((change,i) => <div className="historical-change" key={i}><h3>Chapter 99 · U.S. note {change.note}</h3><div className="historical-wording"><div><small>PREVIOUS PUBLISHED TEXT</small><p>{change.before}</p></div><div><small>CURRENT PUBLISHED TEXT</small><p>{change.after}</p></div></div>{change.kind === "extensive_text_change" && <p>Excerpts show only part of this change. Review both retained documents.</p>}</div>)}
      {[result.historicalComparison.previous,result.historicalComparison.current].map(release => {
        if(!release)return null;
        const source=result.sources.find(s=>s.status==="fetched"&&s.url.includes(`release=${encodeURIComponent(release.name)}`)&&s.url.includes("filename=Chapter%2099_III"));
        return source ? <p key={release.name}><a href={source.url} target="_blank" rel="noreferrer">{release.description} · official legal-note PDF ↗</a></p> : null;
      })}
      {result.historicalComparison.issues.map((issue,i)=><p className="tariff-attention" key={i}>{issue}</p>)}
      {result.historicalComparison.coverage?.historicalSchedule===false&&<p>Historical base-duty and Chapter 99 heading comparisons are unavailable. Empty lists do not mean those duties or headings were unchanged.</p>}
    </details>
    <div className="impact-report-scroll"><table><caption>Combined duties, calculated differences, and next steps by SKU, HTS and origin</caption><thead><tr><th>Product / HTS / origin</th><th>Combined duties now</th><th>Cost difference</th><th>Next step and evidence</th></tr></thead><tbody>{result.rows.map(row => {
      const change = comparison?.rows?.find(r => r.sku === row.product.sku && r.hts === row.product.hts && r.origin === row.product.origin);
      const missing = row.error ?? row.stack?.unresolvedMeasures[0] ?? (!row.stack ? "The duty calculation is unavailable." : null);
      const invalid = !result.consistentRevision || row.verification?.status === "failed";
      const candidate = result.historicalComparison.candidateProducts?.some(p => p.sku === row.product.sku && p.hts === row.product.hts && p.origin === row.product.origin) ?? candidateSkus.includes(row.product.sku);
      const next = invalid ? "Rerun the check: a consistent published rate was not verified." : missing ? missing : candidate ? "Review the changed legal text and confirm whether its conditions apply." : "Review your classification, qualification records and the calculation’s coverage.";
      return <tr key={JSON.stringify([row.product.sku, row.product.hts, row.product.origin])}><th scope="row">{row.product.sku}<small>{row.product.hts} · {row.product.origin}{row.product.fictional ? " · test data" : ""}</small></th><td data-label="Combined duties now">{money(invalid || missing ? null : row.stack?.totalAmount)}</td><td data-label="Cost difference">{money(change?.difference)}<small>{change?.status === "same_calculated_duty" ? "Same calculated duty; coverage remains limited" : change?.status === "changed" ? unit : change?.status === "unresolved" ? "Incomplete calculation" : "No comparable baseline"}</small></td><td data-label="Next step and evidence"><p>{next}</p><details><summary>Duty components and official evidence</summary>{row.stack?.components.map((c, i) => <div key={i}><strong>{c.label}: {money(c.amount)}</strong><p>{c.explanation}</p><ul>{c.citation.map((citation, j) => <li key={j}>{/^https:\/\//.test(citation) ? <a href={citation} target="_blank" rel="noreferrer">Official source ↗</a> : citation}</li>)}</ul></div>)}{!row.stack && <p>No complete calculation available.</p>}<a href={`https://hts.usitc.gov/search?query=${encodeURIComponent(row.product.hts)}`} target="_blank" rel="noreferrer">Published HTS ↗</a>{!!row.stack?.notEvaluated.length && <><p>Coverage limits</p><ul>{row.stack.notEvaluated.map((note,i) => <li key={i}>{note}</li>)}</ul></>}</details></td></tr>;
    })}</tbody></table></div>
    {(result.sources.some(s => s.status === "failed") || result.historicalComparison.status !== "compared") && <p className="tariff-attention">Some official evidence or the previous-rule comparison is unavailable. This report cannot establish that nothing changed.</p>}
    <details><summary>What was checked and what remains outside coverage</summary><ul>{result.coverageNotes.map((note,i) => <li key={i}>{note}</li>)}</ul><ul>{result.sources.map((source,i) => <li key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> · {source.status}{source.error ? ` · ${source.error}` : ""}</li>)}</ul></details>
  </section>;
}
