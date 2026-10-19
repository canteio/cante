"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Download, ArrowRight, AlertTriangle, FileSpreadsheet, ChevronDown } from "lucide-react";
import type { StackedDutyResult } from "@/lib/tariff/stack";
import type { StackRequestRow } from "@/lib/tariff/bulk";
import { normalizeCountryCode } from "@/lib/tariff/bulk";
import { easternIsoDate } from "@/lib/tariff/date";
import type { SelectedProduct } from "@/components/tariff/product-setup";
import { adviceFor } from "@/components/tariff/product-setup";

type Input = Omit<StackRequestRow, "rowNumber">;
type Row = { rowNumber: number; input: Input; result: StackedDutyResult | null; error: string | null };
type RowError = { rowNumber: number; reason: string };
const percentage = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 4 }).format(n);
const dollars = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const emptyInput = (): Input => ({ htsCode: "", countryOfOrigin: "", importDate: easternIsoDate(), value: null, quantity: null, unit: null, claimedProgramme: null, steelContentValue: null, aluminumContentValue: null, usmcaQualification: null });

function needsReview(result: StackedDutyResult) {
  return result.unresolvedMeasures.length > 0 || result.adCvdAdvisories.length > 0 || result.uflpaAdvisories.length > 0 || result.totalRatePercent === null;
}
function status(result: StackedDutyResult) {
  if (result.unresolvedMeasures.length) return "Needs review";
  if (result.adCvdAdvisories.length) return "AD/CVD review";
  if (result.uflpaAdvisories.length) return "Supply-chain review";
  return result.totalRatePercent === null ? "Quantity / value based" : "Calculated";
}
function params(input: Input) {
  const q = new URLSearchParams({ code: input.htsCode.trim(), country: normalizeCountryCode(input.countryOfOrigin) });
  for (const key of ["importDate", "value", "quantity", "unit", "steelContentValue", "aluminumContentValue"] as const) {
    if (input[key] !== null && input[key] !== "") q.set(key, String(input[key]));
  }
  if (input.claimedProgramme) q.set("programme", input.claimedProgramme);
  if (input.usmcaQualification) {
    q.set("usmcaVerified", String(input.usmcaQualification.verified));
    if (input.usmcaQualification.decision) q.set("usmcaDecision", input.usmcaQualification.decision);
    if (input.usmcaQualification.details) q.set("usmcaDetails", input.usmcaQualification.details);
  }
  return q;
}
function csvCell(value: unknown) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Sources({ citations }: { citations: string[] }) {
  return <>{citations.map((citation, i) => /^https:\/\//.test(citation)
    ? <a key={i} href={citation} target="_blank" rel="noreferrer">Official source {i + 1}</a>
    : <span key={i}>{citation}</span>)}</>;
}

function Facts({ input, onChange, additional = false }: { input: Input; onChange: (value: Input) => void; additional?: boolean }) {
  const usmca = input.usmcaQualification ?? { verified: false, decision: null, details: null };
  const country = normalizeCountryCode(input.countryOfOrigin);
  const numberField = (key: "value" | "quantity" | "steelContentValue" | "aluminumContentValue", label: string) => <label>{label}<input className="input" type="number" min="0" step="any" value={input[key] ?? ""} onChange={e => onChange({ ...input, [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>;
  return <div className="tariff-facts">
    {!additional && <>
      <label>HTS code<input className="input" required placeholder="10-digit code" value={input.htsCode} onChange={e => onChange({ ...input, htsCode: e.target.value })} /></label>
      <label>Country of origin<input className="input" required placeholder="Country name or code" value={input.countryOfOrigin} onChange={e => onChange({ ...input, countryOfOrigin: e.target.value })} /></label>
      <label>Import date<input className="input" type="date" required value={input.importDate ?? ""} onChange={e => onChange({ ...input, importDate: e.target.value })} /></label>
      {numberField("value", "Shipment customs value · USD (optional)")}
    </>}
    {additional && <>
      {numberField("quantity", "Quantity")}
      <label>Quantity unit<input className="input" maxLength={32} placeholder="e.g. kg" value={input.unit ?? ""} onChange={e => onChange({ ...input, unit: e.target.value || null })} /></label>
      {numberField("steelContentValue", "Steel content value (USD)")}
      {numberField("aluminumContentValue", "Aluminum content value (USD)")}
      {(country === "MX" || country === "CA") && <fieldset className="tariff-qualification">
        <legend>USMCA qualification</legend>
        <p className="muted">Use your team's reviewed decision. Origin alone does not establish qualification.</p>
        <label>Decision<select className="input" value={usmca.decision ?? ""} onChange={e => onChange({ ...input, usmcaQualification: { ...usmca, decision: e.target.value === "qualifies" ? "qualifies" : e.target.value === "does_not_qualify" ? "does_not_qualify" : null } })}><option value="">Not supplied</option><option value="qualifies">Qualifies</option><option value="does_not_qualify">Does not qualify</option></select></label>
        <label>Supporting evidence<input className="input" maxLength={2000} placeholder="Certificate or decision reference" value={usmca.details ?? ""} onChange={e => onChange({ ...input, usmcaQualification: { ...usmca, details: e.target.value || null } })} /></label>
        <label className="tariff-checkbox"><input type="checkbox" checked={usmca.verified} onChange={e => onChange({ ...input, usmcaQualification: { ...usmca, verified: e.target.checked } })} /> My team verified this decision</label>
      </fieldset>}
    </>}
  </div>;
}

function ResultRow({ row, onUpdate, editShipment = false }: { row: Row; onUpdate: (row: Row) => void; editShipment?: boolean }) {
  const [input, setInput] = useState(row.input);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(editShipment);
  const detailRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => setInput(row.input), [row.input]);
  const result = row.result;
  async function recalculate(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/tariff/stack?${params(input)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not calculate this row.");
      onUpdate({ ...row, input: { ...input, htsCode: data.result.htsCode, countryOfOrigin: data.result.countryOfOrigin }, result: data.result, error: null });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not calculate this row."); }
    finally { setBusy(false); }
  }
  return <div className="tariff-result-item"><details ref={detailRef} className="tariff-result-row" open={editShipment || undefined}>
    <summary>
      <span className="tariff-row-identity"><strong>{row.input.htsCode}</strong><span className="muted">{row.input.countryOfOrigin} · {row.input.importDate} · Row {row.rowNumber}</span><span className="tariff-row-hint">View breakdown <ChevronDown size={12} /></span></span>
      <span className="tariff-row-rate">{result?.unresolvedMeasures.length ? "Total withheld" : result ? percentage(result.totalRatePercent) : "Unavailable"}{result?.totalAmount !== null && result?.totalAmount !== undefined && <small>{dollars(result.totalAmount)}</small>}</span>
      <span className={`pill ${row.error ? "pill-bad" : result && needsReview(result) ? "pill-warn" : "pill-muted"}`}>{row.error ? "Lookup failed" : result ? status(result) : "Unavailable"}</span>
    </summary>
    <div className="tariff-row-detail">
      {row.error && <p role="alert">{row.error}</p>}
      {result && <>
        {result.unresolvedMeasures.length > 0 && <div className="tariff-attention"><strong><AlertTriangle size={15} /> What needs attention</strong><ul>{result.unresolvedMeasures.map((message, i) => <li key={i}>{message}</li>)}</ul></div>}
        {(row.input.countryOfOrigin === "MX" || row.input.countryOfOrigin === "CA") && result.usmcaQualification.status !== "verified" && <p className="tariff-attention">USMCA decision missing. The displayed base component uses the general rate. Add a reviewed decision below to check preference.</p>}
        <h3>How we got here</h3>
        <div className="tariff-component-list">{result.components.map((part, i) => <div key={i} className="tariff-component"><div><strong>{part.label}</strong><p>{part.explanation}</p><div className="tariff-citations"><Sources citations={part.citation} /></div></div><strong>{part.contentRatePercent !== undefined ? `${percentage(part.contentRatePercent)} of ${part.contentCategory} value` : percentage(part.ratePercent)}</strong></div>)}</div>
        <details className="tariff-explanation"><summary>Stacking and exclusions</summary><ul>{result.stackingExplanation.map((line, i) => <li key={i}>{line}</li>)}</ul></details>
        {result.adCvdAdvisories.length > 0 && <div className="tariff-attention"><strong>AD/CVD is not included</strong>{result.adCvdAdvisories.map((lead, i) => <p key={i}>{lead.title} — {lead.scopeNote}</p>)}</div>}
        {result.uflpaAdvisories.length > 0 && <div className="tariff-attention"><strong>Supply-chain review</strong>{result.uflpaAdvisories.map((lead, i) => <p key={i}>{lead.sector}: {lead.note}</p>)}</div>}
        <details className="tariff-explanation"><summary>Coverage limits</summary><ul>{result.notEvaluated.map((line, i) => <li key={i}>{line}</li>)}</ul></details>
      </>}
      <div className="tariff-explanation"><button className="tariff-text-button" onClick={() => setEditing(v => !v)}>{editing ? "Close shipment editor" : "Edit shipment facts"}</button>{editing && <form onSubmit={recalculate}><Facts input={input} onChange={setInput} /><Facts input={input} onChange={setInput} additional />{error && <p role="alert">{error}</p>}<button className="btn btn-primary" disabled={busy}>{busy ? "Recalculating…" : "Recalculate row"}</button></form>}</div>
    </div>
  </details>{result && adviceFor(result) && <div className="tariff-row-next"><p>{adviceFor(result)!.message}</p>{adviceFor(result)!.shipment && <button className="tariff-text-button" onClick={() => { if (detailRef.current) detailRef.current.open = true; setEditing(true); }}>Add shipment facts</button>}</div>}{row.error && <p className="tariff-row-next">Lookup failed. Retry with the shipment facts above; this row has no confirmed rate.</p>}</div>;
}

export function TariffStackPanel({ embedded = false, selectedProduct = null }: { embedded?: boolean; selectedProduct?: SelectedProduct | null }) {
  const [input, setInput] = useState<Input>(emptyInput);
  const [rows, setRows] = useState<Row[]>([]);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null);
  const previousSelection = useRef<SelectedProduct | null>(null);
  useEffect(() => {
    if (!selectedProduct) {
      if (previousSelection.current) { controller.current?.abort(); setInput(emptyInput()); setRows([]); setRowErrors([]); setError(null); }
      previousSelection.current = null;
      return;
    }
    previousSelection.current = selectedProduct;
    controller.current?.abort();
    const next = { ...emptyInput(), htsCode: selectedProduct.htsCode, countryOfOrigin: selectedProduct.countryOfOrigin, importDate: selectedProduct.importDate };
    setInput(next); setFilename(selectedProduct.name);
    setRows(selectedProduct.dutyResult ? [{ rowNumber: 1, input: next, result: selectedProduct.dutyResult, error: null }] : []); setRowErrors([]); setError(null);
  }, [selectedProduct]);
  useEffect(() => () => controller.current?.abort(), []);
  async function calculate(file?: File) {
    if (busy) return;
    if (file && file.size > 2 * 1024 * 1024) { setError("File exceeds 2 MiB. Split it into smaller CSV files."); return; }
    if (!input.importDate) { setError("Choose the import date first."); return; }
    setBusy(true); setError(null); setRowErrors([]); setRows([]); setFilename(file?.name ?? "Single product");
    controller.current = new AbortController();
    try {
      const response = file ? await fetch(`/api/tariff/stack/bulk?importDate=${input.importDate}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: file, signal: controller.current.signal })
        : await fetch(`/api/tariff/stack?${params(input)}`, { cache: "no-store", signal: controller.current.signal });
      const data = await response.json();
      setRowErrors(data.rowErrors ?? []);
      if (!response.ok) throw new Error(data.error ?? "Could not calculate tariffs.");
      setRows(file ? data.rows : [{ rowNumber: 1, input: { ...input, countryOfOrigin: normalizeCountryCode(input.countryOfOrigin), htsCode: data.result.htsCode }, result: data.result, error: null }]);
      setFilter("all");
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Could not reach the tariff service."); }
    finally { setBusy(false); }
  }
  function exportResults() {
    const header = ["row", "hts_code", "country_of_origin", "import_date", "status", "supported_rate_percent", "supported_duty_usd", "usmca_decision", "usmca_verified", "usmca_details", "customs_value_usd", "quantity", "unit", "steel_content_value", "aluminum_content_value", "programme", "components", "stacking", "citations", "needs_review", "coverage_limits"];
    const data = rows.map(row => [row.rowNumber, row.input.htsCode, row.input.countryOfOrigin, row.input.importDate, row.error ?? (row.result ? status(row.result) : "Unavailable"), row.result?.totalRatePercent === null || !row.result ? null : row.result.totalRatePercent * 100, row.result?.totalAmount, row.input.usmcaQualification?.decision, row.input.usmcaQualification?.verified, row.input.usmcaQualification?.details, row.input.value, row.input.quantity, row.input.unit, row.input.steelContentValue, row.input.aluminumContentValue, row.input.claimedProgramme, row.result ? JSON.stringify(row.result.components) : null, row.result?.stackingExplanation.join("; "), row.result?.components.flatMap(c => c.citation).join("; "), row.result?.unresolvedMeasures.concat(row.result.adCvdAdvisories.map(a => `AD/CVD not computed: ${a.title}`)).join("; "), row.result?.notEvaluated.join("; ")]);
    for (const row of rowErrors) { const cells: (string | number | null | undefined | boolean)[] = Array(header.length).fill(null); cells[0] = row.rowNumber; cells[4] = `Input error: ${row.reason}`; data.push(cells); }
    download("tariff-results.csv", [header, ...data].map(row => row.map(csvCell).join(",")).join("\r\n"));
  }
  const reviewCount = rows.filter(row => row.error || !row.result || needsReview(row.result)).length + rowErrors.length;
  const shown = filter === "review" ? rows.filter(row => row.error || !row.result || needsReview(row.result)) : rows;
  return <div className={embedded ? "tariff-calculator" : "main-scroll tariff-calculator"}>
    <section className="tariff-upload" aria-labelledby="tariff-upload-heading">
      <div className="tariff-section-heading"><div><span className="tariff-eyebrow">Duty check</span><h2 id="tariff-upload-heading">See duties</h2><p className="muted">{selectedProduct ? `${selectedProduct.name} · Confirm shipment facts below.` : "Choose a saved product above, or enter a code here."}</p></div></div>
      {selectedProduct?.codeConfirmed === false && <p className="tariff-attention">HTS unconfirmed. Ask your broker to confirm this code before relying on the rate.</p>}
      <form onSubmit={e => { e.preventDefault(); void calculate(); }}>
        <Facts input={input} onChange={setInput} />
        <details className="tariff-explanation"><summary>Quantity, metal content &amp; trade preferences</summary><Facts input={input} onChange={setInput} additional /></details>
        <div className="tariff-upload-actions"><button type="submit" className="btn btn-primary" disabled={busy || !input.htsCode.trim() || !input.countryOfOrigin.trim()}>{busy ? "Calculating…" : "Calculate duties"}<ArrowRight size={15} /></button><button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={15} />Check duties CSV</button><button type="button" className="tariff-text-button" onClick={() => download("tariff-template.csv", "hts_code,country_of_origin,import_date,value,quantity,unit,steel_content_value,aluminum_content_value,usmca_verified,usmca_decision,usmca_details\r\n")}><FileSpreadsheet size={14} />CSV template</button></div>
        <p className="tariff-scope-note">Value is optional for percentage duties. CSV: up to 500 rows; each row needs HTS and origin.</p>
      </form>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void calculate(file); e.target.value = ""; }} />
      {busy && <p role="status">Checking published rates and reviewed stacking rules… <button className="tariff-text-button" onClick={() => controller.current?.abort()}>Cancel</button></p>}
      {error && <p className="tariff-attention" role="alert">{error}</p>}
    </section>
    {(rows.length > 0 || rowErrors.length > 0) && <section ref={resultRef} className="tariff-results" aria-labelledby="tariff-results-heading" aria-live="polite">
      <div className="tariff-section-heading"><div><h2 id="tariff-results-heading">Your tariff breakdown</h2><p className="muted">{rows.length ? `${filename} · ${rows.length} evaluated · ${reviewCount} ${reviewCount === 1 ? "needs" : "need"} attention` : "Calculate above to see your duties."}</p></div>{rows.length > 0 && <button className="btn" onClick={exportResults}><Download size={14} />Export CSV</button>}</div>
      {rows.length > 0 && <><p className="tariff-scope-note">Rates cover the supported duty components. AD/CVD, fees and other coverage limits remain separate; a calculated rate is not a complete landed cost.</p><div className="tariff-filters"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All ({rows.length})</button><button aria-pressed={filter === "review"} onClick={() => setFilter("review")}>Needs attention ({reviewCount})</button></div></>}
      {shown.map(row => <ResultRow key={`${filename}-${row.rowNumber}`} row={row} editShipment={!!selectedProduct?.editShipment && rows.length === 1} onUpdate={updated => setRows(current => current.map(item => item.rowNumber === updated.rowNumber ? updated : item))} />)}
      {rowErrors.length > 0 && <div className="tariff-attention" role="alert"><strong>Rows not calculated</strong><ul>{rowErrors.map((row, i) => <li key={i}>Row {row.rowNumber}: {row.reason}</li>)}</ul><p>Correct these rows in your file and upload again.</p>{rows.length === 0 && <button className="btn" onClick={exportResults}>Export errors</button>}</div>}
    </section>}
  </div>;
}
