"use client";

import { MonitorCandidates } from "./monitor-candidates";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ImpactRow, summarizeBusinessImpact } from "@/lib/tariff/business-impact";

import type { ColumnMapping, CanonicalField } from "@/lib/tariff/column-mapping";

const fieldLabels: Record<CanonicalField, string> = {
  sku: "SKU", hts: "HTS code", origin: "Country of origin", supplier: "Supplier",
  annual_import_value_usd: "Annual import value (USD)", current_duty_rate: "Current duty rate (%)",
  evaluation_date: "Import date (optional)", quantity: "Quantity (optional)",
  chapter99_codes: "Chapter 99 codes (optional)", exclusion_id: "Exclusion ID (optional)",
  special_program_claim: "Special program claim (optional)",
};
type MappingProposal = ColumnMapping & { headers: string[]; sampleRows: Record<string, string>[] };

type ImpactRun = ReturnType<typeof summarizeBusinessImpact> & {
  id: string;
  filename: string;
  created_at: string;
};
type ImpactSnapshot = ImpactRun & { rows: ImpactRow[] };
const endpoint = "/api/tariff/impact-runs";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 6 });
const usd = (value: number | null) => value === null ? "not calculable" : money.format(value);
const rate = (value: number | null) => value === null ? "not calculable" : percent.format(value);

function errorMessage(data: unknown, fallback: string): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error : fallback;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || data === null) throw new Error(errorMessage(data, `Request failed (HTTP ${response.status}). Please retry.`));
  return data as T;
}

function RowEvidence({ row }: { row: ImpactRow }) {
  return (
    <details>
      <summary>Row {row.row_number} details — {row.sku ?? "missing SKU"}</summary>
      <p>Evaluation date: {row.evaluation_date ?? "not provided"}</p>
      <p>Quantity: {row.quantity ?? "not provided"} · Chapter 99 codes: {row.chapter99_codes ?? "not provided"}</p>
      <p>Exclusion ID: {row.exclusion_id ?? "not provided"} · Special program claim: {row.special_program_claim ?? "not provided"}</p>
      <p className="muted">These optional fields are saved as context and do not change the duty calculation.</p>
      {row.error && <p role="alert">{row.error}</p>}
      {row.stack_result ? (
        <>
          <p className="muted">Saved stack evidence, including components, citations, unresolvedMeasures and adCvdAdvisories. Numeric values below are shown exactly as returned.</p>
          <pre className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{JSON.stringify(row.stack_result, null, 2)}</pre>
        </>
      ) : <p className="muted">No stack result returned.</p>}
    </details>
  );
}

export function BusinessImpactPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [proposal, setProposal] = useState<MappingProposal | null>(null);
  const [run, setRun] = useState<ImpactSnapshot | null>(null);
  const [runs, setRuns] = useState<ImpactRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"mapping" | "upload" | "open" | "export" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const uploadRef = useRef<XMLHttpRequest | null>(null);
  const historyRequest = useRef(0);

  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await readResponse<{ runs: ImpactRun[] }>(await fetch(endpoint, { cache: "no-store" }));
      if (request === historyRequest.current) setRuns(data.runs);
    } catch (e) {
      if (request === historyRequest.current) setHistoryError(e instanceof Error ? e.message : "Could not load run history.");
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => { ++historyRequest.current; uploadRef.current?.abort(); };
  }, [loadHistory]);

  async function propose(file: File | null) {
    setFile(file);
    setProposal(null);
    setError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("CSV exceeds the 2 MiB upload limit."); return; }
    setBusy("mapping");
    try {
      setProposal(await readResponse<MappingProposal>(await fetch(`${endpoint}/propose-mapping`, {
        method: "POST", headers: { "Content-Type": "text/csv" }, body: file,
      })));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not propose column mapping."); }
    finally { setBusy(null); }
  }

  async function upload() {
    if (!file || !proposal || busy) return;
    setError(null);
    if (file.size > 2 * 1024 * 1024) {
      setError("CSV exceeds the 2 MiB upload limit.");
      return;
    }
    setBusy("upload");
    setProgress(null);
    setUploaded(false);
    setRun(null);
    try {
      // Fetch does not report upload progress. XHR reports actual transferred bytes;
      // analysis remains indeterminate after the upload finishes.
      const snapshot = await new Promise<ImpactSnapshot>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadRef.current = xhr;
        xhr.open("POST", endpoint);
        xhr.setRequestHeader("Content-Type", "text/csv");
        xhr.setRequestHeader("x-column-mapping", encodeURIComponent(JSON.stringify(proposal.mapping)));
        xhr.setRequestHeader("x-filename", file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160));
        xhr.responseType = "json";
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100));
        };
        xhr.upload.onload = () => setUploaded(true);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response as ImpactSnapshot);
          else reject(new Error(errorMessage(xhr.response, `Upload failed (HTTP ${xhr.status}). Please retry.`)));
        };
        xhr.onerror = () => reject(new Error("Connection lost. Check run history before retrying; the analysis may have been saved."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.send(file);
      });
      setRun(snapshot);
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload CSV.");
    } finally {
      uploadRef.current = null;
      setBusy(null);
    }
  }

  async function openRun(id: string) {
    setBusy("open");
    setError(null);
    setRun(null);
    try {
      setRun(await readResponse<ImpactSnapshot>(await fetch(`${endpoint}/${encodeURIComponent(id)}`, { cache: "no-store" })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open run.");
    } finally { setBusy(null); }
  }

  async function exportRun() {
    if (!run) return;
    setBusy("export");
    setError(null);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(run.id)}/export`, { cache: "no-store" });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), "Could not export run."));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "tariff-impact.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download CSV.");
    } finally { setBusy(null); }
  }

  return (
    <section aria-label="Tariff impact analysis">
      <MonitorCandidates runId={run?.id ?? null} />
      <div className="page-head">
        <div>
          <h2 id="impact-heading">Portfolio duty analysis</h2>
          <p className="page-sub">Upload annual imports to create the tenant-linked portfolio rows used by the company-impact view above.</p>
        </div>
      </div>
      <form className="card" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
        <label htmlFor="impact-csv" className="card-title">Import portfolio CSV</label>
        <p id="impact-csv-help" className="muted">
          Use any column names. Match columns for SKU, HTS code, country of origin, supplier, annual import value and current duty rate before analyzing.
          Optional: import date (YYYY-MM-DD), quantity, Chapter 99 codes, exclusion ID and special program claim.
          Use two-letter origins, USD values without separators,
          and percentage points (5 means 5%). Maximum 500 rows, 2 MiB.
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input id="impact-csv" className="input" type="file" accept=".csv,text/csv" aria-describedby="impact-csv-help"
            disabled={busy !== null} onChange={(event) => void propose(event.target.files?.[0] ?? null)} />
          {!proposal && file && <button className="btn" type="button" disabled={busy !== null} onClick={() => void propose(file)}>Retry column mapping</button>}
          <button className="btn btn-primary" type="submit" disabled={!file || !proposal || busy !== null}>Confirm mapping and analyze</button>
        </div>
        {proposal && <div style={{ overflowX: "auto" }}>
          <p>We think these columns match. Check each selection before confirming; choose None when your file has no matching column.</p>
          <table className="table">
            <thead><tr><th scope="col">Field</th><th scope="col">Your column</th><th scope="col">AI confidence</th></tr></thead>
            <tbody>{(Object.keys(fieldLabels) as CanonicalField[]).map(field => <tr key={field}>
              <th scope="row"><label htmlFor={`mapping-${field}`}>{fieldLabels[field]}</label></th>
              <td><select id={`mapping-${field}`} className="input" disabled={busy !== null} value={proposal.mapping[field] ?? ""}
                onChange={event => setProposal({ ...proposal, mapping: { ...proposal.mapping, [field]: event.target.value || null } })}>
                <option value="">None</option>
                {proposal.headers.map(header => <option key={header} value={header}>{header}</option>)}
              </select></td>
              <td>{Math.round(proposal.confidence[field] * 100)}%</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </form>
      {error && <p className="pill pill-bad" role="alert" style={{ whiteSpace: "normal" }}>{error}</p>}
      {busy && (
        <div role="status" className="card">
          {busy === "upload" ? uploaded ? "Upload complete. Analyzing and saving results…" : `Uploading CSV${progress === null ? "…" : ` — ${progress}%`}`
            : busy === "mapping" ? "Suggesting column matches…" : busy === "open" ? "Loading saved analysis…" : "Downloading CSV…"}
          {busy === "upload" && !uploaded && <progress aria-label="CSV upload progress" max={100} value={progress ?? undefined} style={{ display: "block", marginTop: 8 }} />}
        </div>
      )}
      {run && (
        <section className="card" aria-labelledby="impact-result-heading">
          <div className="card-head">
            <div>
              <h2 id="impact-result-heading" className="card-title">Results — {run.filename}</h2>
              <p className="muted">Saved {new Date(run.created_at).toLocaleString()}</p>
            </div>
            <button className="btn" disabled={busy !== null} onClick={() => void exportRun()}>Export CSV</button>
          </div>
          <div className="meta-row" style={{ flexWrap: "wrap" }}>
            <span className="pill pill-blue">{run.affected_sku_count} distinct affected SKUs</span>
            <span className="pill pill-muted">{run.unique_supplier_count} distinct suppliers</span>
            <span className="pill pill-ok">{run.computed_count} computed</span>
            <span className="pill pill-warn">{run.unresolved_count} unresolved</span>
            <span className="pill pill-bad">{run.error_count} errors</span>
          </div>
          <p>Resolved annual duty delta subtotal: <strong>{usd(run.resolved_annual_delta_subtotal_usd)}</strong></p>
          {run.estimated_annual_duty_delta_usd === null
            ? <p className="pill pill-warn" style={{ whiteSpace: "normal" }}>Portfolio total withheld — {run.unresolved_count + run.error_count} of {run.source_count} rows unresolved</p>
            : <p>Portfolio estimated annual duty delta: <strong>{usd(run.estimated_annual_duty_delta_usd)}</strong></p>}
          <p>Effective date: {run.effective_date_status === "single" ? run.effective_date : run.effective_date_status === "mixed" ? "mixed" : "not provided"}</p>
          <div role="region" aria-label="Tariff impact rows" tabIndex={0} style={{ overflowX: "auto" }}>
            <table className="table">
              <caption className="muted" style={{ textAlign: "left", marginBottom: 8 }}>Annual amounts in USD. Expand a row for saved calculation evidence.</caption>
              <thead><tr>{["SKU", "HTS", "Origin", "Supplier", "Annual value", "Current rate", "Computed total rate", "Current annual duty", "Computed annual duty", "Delta", "Direction", "Status"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{run.rows.map(row => (
                <Fragment key={row.row_number}>
                  <tr>
                    <th scope="row">{row.sku ?? "not provided"}</th>
                    <td className="mono">{row.hts ?? "not provided"}</td><td>{row.origin ?? "not provided"}</td><td>{row.supplier ?? "not provided"}</td>
                    <td>{usd(row.annual_import_value_usd)}</td><td>{rate(row.current_duty_rate)}</td><td>{rate(row.computed_total_rate)}</td>
                    <td>{usd(row.current_annual_duty_usd)}</td><td>{usd(row.computed_annual_duty_usd)}</td><td>{usd(row.annual_delta_usd)}</td>
                    <td>{row.direction.replace(/_/g, " ")}</td>
                    <td><span className={`pill ${row.status === "computed" ? "pill-ok" : row.status === "error" ? "pill-bad" : "pill-warn"}`}>{row.status}</span></td>
                  </tr>
                  <tr><td colSpan={12}><RowEvidence row={row} /></td></tr>
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      <section className="card" aria-labelledby="impact-history-heading">
        <div className="card-head">
          <h2 id="impact-history-heading" className="card-title">Run history</h2>
          <button className="btn btn-small" disabled={historyLoading || busy !== null} onClick={() => void loadHistory()}>Refresh history</button>
        </div>
        {historyLoading ? <p role="status">Loading run history…</p>
          : historyError ? <p role="alert">{historyError}</p>
          : runs.length === 0 ? <p className="muted">No saved analyses yet.</p>
          : <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{runs.map(saved => (
            <li key={saved.id} className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
              <button className="btn btn-small" disabled={busy !== null} aria-current={run?.id === saved.id ? "true" : undefined} onClick={() => void openRun(saved.id)}>{saved.filename}</button>
              <span className="muted">{new Date(saved.created_at).toLocaleString()} · {saved.source_count} rows · {saved.computed_count} computed · {saved.unresolved_count} unresolved · {saved.error_count} errors</span>
            </li>
          ))}</ul>}
      </section>
    </section>
  );
}
