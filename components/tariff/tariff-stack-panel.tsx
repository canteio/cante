"use client";

import { useCallback, useRef, useState } from "react";
import { Calculator, Upload, FileSpreadsheet, AlertTriangle } from "lucide-react";

/**
 * Tariff Stack Calculator — built directly from the customer-discovery
 * interview with Kate Chang (The Toro Company, 2026-10-01). Her exact ask:
 * "Maybe it's just a SaaS that we can go out and use... upload some HTS
 * codes and countries of origin and it spits out the tariff rate and how
 * you got there." This panel is that tool: a single-row quick quote plus a
 * bulk CSV upload, both backed by lib/tariff/stack.ts, which is explicit
 * about which stacking layers it does and does not compute yet.
 */

interface StackedDutyComponent {
  type: "base" | "section301" | "section232";
  label: string;
  ratePercent: number | null;
  contentRatePercent?: number;
  contentValue?: number;
  contentCategory?: "steel" | "aluminum";
  amount: number | null;
  citation: string[];
  explanation: string;
}

interface AdCvdAdvisory {
  caseNumbers: string[];
  title: string;
  country: string;
  allOthersRatePercent: number;
  asOfDeterminationCitation: string;
  scopeNote: string;
}

interface StackedDutyResult {
  htsCode: string;
  countryOfOrigin: string;
  totalRatePercent: number | null;
  totalAmount: number | null;
  currency: "USD";
  components: StackedDutyComponent[];
  stackingExplanation: string[];
  notEvaluated: string[];
  unresolvedMeasures: string[];
  usmcaQualification:
    | { status: "not_applicable" | "not_provided"; specialRateRequested: false; explanation: string }
    | { status: "incomplete"; specialRateRequested: false; decision: string | null; details: string | null; explanation: string }
    | { status: "verified"; specialRateRequested: boolean; decision: string; details: string; explanation: string };
  adCvdAdvisories: AdCvdAdvisory[];
}

interface BulkRowResult {
  rowNumber: number;
  input: { htsCode: string; countryOfOrigin: string };
  result: StackedDutyResult | null;
  error: string | null;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function componentRate(component: StackedDutyComponent): string {
  if (component.contentRatePercent !== undefined && component.contentCategory) {
    return `${pct(component.contentRatePercent)} of ${component.contentCategory} content`;
  }
  return pct(component.ratePercent);
}

function usd(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function totalRateLabel(result: StackedDutyResult): string {
  if (result.unresolvedMeasures.length > 0) return "Total withheld";
  if (result.totalRatePercent !== null) return `Total: ${pct(result.totalRatePercent)}`;
  const hasContentComponent = result.components.some((c) => c.contentRatePercent !== undefined);
  return hasContentComponent
    ? "Total rate: content-value based"
    : "Total rate: not a single ad valorem percentage (specific or unparsed duty component)";
}

function ResultCard({ result }: { result: StackedDutyResult }) {
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <div className="card-head">
        <div>
          <span className="card-title">
            {result.htsCode} <span className="muted">from</span> {result.countryOfOrigin}
          </span>
        </div>
        <div className="row">
          <span className="pill pill-blue">{totalRateLabel(result)}</span>
          {result.totalAmount !== null && <span className="pill pill-muted">{usd(result.totalAmount)}</span>}
        </div>
      </div>

      {result.unresolvedMeasures.length > 0 && (
        <div className="pill pill-warn" role="alert" style={{ marginBottom: "0.75rem" }}>
          <AlertTriangle size={12} /> Total withheld — unresolved measure(s): {result.unresolvedMeasures.join(", ")}
        </div>
      )}

      <table className="table" style={{ marginBottom: "0.75rem" }}>
        <thead>
          <tr>
            <th>Component</th>
            <th>Rate</th>
            <th>Amount</th>
            <th>Citation</th>
          </tr>
        </thead>
        <tbody>
          {result.components.map((c, i) => (
            <tr key={i}>
              <td>{c.label}</td>
              <td>{componentRate(c)}</td>
              <td>{usd(c.amount)}</td>
              <td className="muted" style={{ fontSize: "0.75rem" }}>{c.citation.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginBottom: "0.5rem" }}>
        <strong style={{ fontSize: "0.8125rem" }}>How this was calculated</strong>
        <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
          {result.stackingExplanation.map((line, i) => (
            <li key={i} style={{ marginBottom: "0.25rem" }}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="pill pill-muted" style={{ display: "block", whiteSpace: "normal", lineHeight: 1.5, marginBottom: "0.5rem" }}>
        USMCA decision: {result.usmcaQualification.explanation}
      </div>

      <div className="pill pill-muted" style={{ display: "block", whiteSpace: "normal", lineHeight: 1.5 }}>
        Not evaluated yet: {result.notEvaluated.join(" · ")}
      </div>

      {result.adCvdAdvisories.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <strong style={{ fontSize: "0.8125rem" }}>AD/CVD leads to verify (not computed)</strong>
          {result.adCvdAdvisories.map((advisory, i) => (
            <div key={i} className="pill pill-warn" role="alert" style={{ display: "block", whiteSpace: "normal", lineHeight: 1.5, marginTop: "0.35rem" }}>
              <AlertTriangle size={12} /> {advisory.title} ({advisory.caseNumbers.join(" / ")}) — all-others rate ~{advisory.allOthersRatePercent.toFixed(2)}% as of {advisory.asOfDeterminationCitation}. {advisory.scopeNote} Verify exact scope and exporter-specific rate at access.trade.gov.
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TariffStackPanel({ embedded = false }: { embedded?: boolean }) {
  const [htsCode, setHtsCode] = useState("");
  const [country, setCountry] = useState("");
  const [value, setValue] = useState("");
  const [steelContentValue, setSteelContentValue] = useState("");
  const [aluminumContentValue, setAluminumContentValue] = useState("");
  const [importDate, setImportDate] = useState("");
  const [usmcaVerified, setUsmcaVerified] = useState(false);
  const [usmcaDecision, setUsmcaDecision] = useState<"" | "qualifies" | "does_not_qualify">("");
  const [usmcaDetails, setUsmcaDetails] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteResult, setQuoteResult] = useState<StackedDutyResult | null>(null);

  const [bulkRows, setBulkRows] = useState<BulkRowResult[] | null>(null);
  const [bulkRowErrors, setBulkRowErrors] = useState<Array<{ rowNumber: number; reason: string }>>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runQuote = useCallback(async () => {
    if (!htsCode.trim() || !country.trim()) return;
    setQuoting(true);
    setQuoteError(null);
    setQuoteResult(null);
    try {
      const params = new URLSearchParams({ code: htsCode.trim(), country: country.trim().toUpperCase() });
      if (value.trim()) params.set("value", value.trim());
      if (steelContentValue.trim()) params.set("steelContentValue", steelContentValue.trim());
      if (aluminumContentValue.trim()) params.set("aluminumContentValue", aluminumContentValue.trim());
      if (importDate.trim()) params.set("importDate", importDate.trim());
      if (usmcaVerified || usmcaDecision || usmcaDetails.trim()) {
        params.set("usmcaVerified", String(usmcaVerified));
        if (usmcaDecision) params.set("usmcaDecision", usmcaDecision);
        if (usmcaDetails.trim()) params.set("usmcaDetails", usmcaDetails.trim());
      }
      const res = await fetch(`/api/tariff/stack?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error ?? "Lookup failed.");
        return;
      }
      setQuoteResult(data.result);
    } catch {
      setQuoteError("Could not reach the tariff service. Check your connection and try again.");
    } finally {
      setQuoting(false);
    }
  }, [htsCode, country, value, steelContentValue, aluminumContentValue, importDate, usmcaVerified, usmcaDecision, usmcaDetails]);

  const runBulkUpload = useCallback(async (file: File) => {
    setBulkBusy(true);
    setBulkError(null);
    setBulkRows(null);
    setBulkRowErrors([]);
    try {
      const text = await file.text();
      const res = await fetch("/api/tariff/stack/bulk", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkError(data.error ?? "Bulk lookup failed.");
        setBulkRowErrors(data.rowErrors ?? []);
        return;
      }
      setBulkRows(data.rows ?? []);
      setBulkRowErrors(data.rowErrors ?? []);
    } catch {
      setBulkError("Could not upload the file. Check your connection and try again.");
    } finally {
      setBulkBusy(false);
    }
  }, []);

  return (
    <div className={embedded ? undefined : "main-scroll"}>
      {!embedded && <div className="page-head">
        <div>
          <h1>Tariff Stack Calculator</h1>
          <p className="page-sub">
            Upload HTS codes and countries of origin — get the exact stacked rate, broken down
            component by component, with an audit trail for every figure.
          </p>
        </div>
      </div>}

      <div className="card">
        <div className="card-head">
          <Calculator size={16} />
          <h2 className="card-title">Quick quote</h2>
        </div>
        <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <div>
            <label htmlFor="stack-hts" className="side-label" style={{ padding: 0 }}>HTS code *</label>
            <input
              id="stack-hts"
              className="input mono"
              placeholder="e.g. 8544.42.90.00"
              value={htsCode}
              onChange={(e) => setHtsCode(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stack-country" className="side-label" style={{ padding: 0 }}>Country of origin *</label>
            <input
              id="stack-country"
              className="input mono"
              placeholder="e.g. CN"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              maxLength={2}
            />
          </div>
          <div>
            <label htmlFor="stack-value" className="side-label" style={{ padding: 0 }}>Shipment value (USD)</label>
            <input
              id="stack-value"
              className="input mono"
              placeholder="optional"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stack-steel-content" className="side-label" style={{ padding: 0 }}>Dutiable steel content value (USD)</label>
            <input
              id="stack-steel-content"
              type="number"
              min="0"
              className="input mono"
              placeholder="optional"
              value={steelContentValue}
              onChange={(e) => setSteelContentValue(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stack-aluminum-content" className="side-label" style={{ padding: 0 }}>Aluminum content value (USD)</label>
            <input
              id="stack-aluminum-content"
              type="number"
              min="0"
              className="input mono"
              placeholder="optional"
              value={aluminumContentValue}
              onChange={(e) => setAluminumContentValue(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stack-import-date" className="side-label" style={{ padding: 0 }}>Import date</label>
            <input
              id="stack-import-date"
              type="date"
              className="input mono"
              value={importDate}
              onChange={(e) => setImportDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stack-usmca-decision" className="side-label" style={{ padding: 0 }}>USMCA decision</label>
            <select
              id="stack-usmca-decision"
              className="input"
              value={usmcaDecision}
              onChange={(e) => {
                const decision = e.target.value;
                if (decision === "" || decision === "qualifies" || decision === "does_not_qualify") {
                  setUsmcaDecision(decision);
                }
              }}
            >
              <option value="">Not supplied</option>
              <option value="qualifies">Qualifies</option>
              <option value="does_not_qualify">Does not qualify</option>
            </select>
          </div>
          <div>
            <label htmlFor="stack-usmca-details" className="side-label" style={{ padding: 0 }}>USMCA supporting details</label>
            <input
              id="stack-usmca-details"
              className="input"
              placeholder="decision reference or basis"
              value={usmcaDetails}
              onChange={(e) => setUsmcaDetails(e.target.value)}
            />
          </div>
          <label className="row" style={{ alignSelf: "flex-end", gap: "0.35rem", minHeight: "2.25rem" }}>
            <input
              type="checkbox"
              checked={usmcaVerified}
              onChange={(e) => setUsmcaVerified(e.target.checked)}
            />
            Qualification verified
          </label>
          <button
            className="btn btn-primary"
            disabled={quoting || !htsCode.trim() || !country.trim()}
            onClick={runQuote}
            style={{ alignSelf: "flex-end" }}
          >
            {quoting ? "Calculating…" : "Calculate"}
          </button>
        </div>

        {quoteError && <div className="pill pill-bad" role="alert">{quoteError}</div>}
        {quoteResult && <ResultCard result={quoteResult} />}
      </div>

      <div className="card">
        <div className="card-head">
          <FileSpreadsheet size={16} />
          <h2 className="card-title">Bulk upload</h2>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          CSV with <code className="mono">hts_code</code> and <code className="mono">country_of_origin</code> columns
          (common aliases like <code className="mono">hts</code>, <code className="mono">origin</code>, and{" "}
          <code className="mono">coo</code> are also recognised). Optional columns:{" "}
          <code className="mono">value</code>, <code className="mono">quantity</code>, <code className="mono">unit</code>,{" "}
          <code className="mono">programme</code>, <code className="mono">import_date</code> (YYYY-MM-DD),{" "}
          <code className="mono">steel_content_value</code>, <code className="mono">aluminum_content_value</code>,{" "}
          <code className="mono">usmca_verified</code>, <code className="mono">usmca_decision</code>, and{" "}
          <code className="mono">usmca_details</code>.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runBulkUpload(file);
            e.target.value = "";
          }}
        />
        <button className="btn btn-primary" disabled={bulkBusy} onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} /> {bulkBusy ? "Processing…" : "Upload CSV"}
        </button>

        {bulkError && <div className="pill pill-bad" role="alert" style={{ marginTop: "0.75rem" }}>{bulkError}</div>}

        {bulkRowErrors.length > 0 && (
          <div className="pill pill-warn" role="alert" style={{ marginTop: "0.75rem", display: "block", whiteSpace: "normal" }}>
            {bulkRowErrors.length} row(s) could not be read: {bulkRowErrors.map((e) => `row ${e.rowNumber}: ${e.reason}`).join("; ")}
          </div>
        )}

        {bulkRows && bulkRows.length > 0 && (
          <table className="table" style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th>Row</th>
                <th>HTS code</th>
                <th>Origin</th>
                <th>Total rate</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bulkRows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td className="mono">{row.input.htsCode}</td>
                  <td className="mono">{row.input.countryOfOrigin}</td>
                  <td>
                    {row.result ? totalRateLabel(row.result) : "—"}
                  </td>
                  <td>{usd(row.result?.totalAmount ?? null)}</td>
                  <td>
                    {row.error ? (
                      <span className="pill pill-bad">{row.error}</span>
                    ) : row.result && row.result.unresolvedMeasures.length > 0 ? (
                      <span className="pill pill-warn">Unresolved measure</span>
                    ) : (
                      <span className="pill pill-ok">Computed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
