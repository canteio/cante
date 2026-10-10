"use client";

import { MonitorCandidates, ScheduleMonitor } from "./monitor-candidates";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ImpactRow, summarizeBusinessImpact } from "@/lib/tariff/business-impact";
import type { ColumnMapping, CanonicalField } from "@/lib/tariff/column-mapping";
import { 
  Upload, FileSpreadsheet, Download, Sparkles, ArrowRight, CheckCircle2, 
  AlertTriangle, DollarSign, ChevronDown, ChevronUp, RefreshCw, 
  ExternalLink, ShieldCheck, X, FileText, Check
} from "lucide-react";

const fieldLabels: Record<CanonicalField, string> = {
  qualification_verified: "Qualification explicitly reviewed (true/false)", qualification_basis: "Qualification review basis",
  entry_id: "Historical entry ID", line_number: "Entry line number", customs_value_usd: "Entry customs value (USD)", paid_duty_usd: "Duty paid (USD)",
  sku: "SKU", hts: "HTS code", origin: "Country of origin", supplier: "Supplier",
  annual_import_value_usd: "Annual import value (USD)", current_duty_rate: "Current duty rate (%)",
  evaluation_date: "Entry date (required for history)", quantity: "Quantity (optional)", unit: "Quantity unit (optional)",
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
    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border)", fontSize: "0.85rem" }}>
      {row.entry_id && (
        <p style={{ margin: "4px 0" }}>
          <strong>Customs Entry:</strong> {row.entry_id} · <strong>Line:</strong> {row.line_number ?? "1"} · <strong>Catalogue Link:</strong>{" "}
          <span className={`pill ${row.product_id ? "pill-ok" : "pill-muted"}`}>{row.product_id ? "Matched in Catalogue" : "Unmatched SKU"}</span>
        </p>
      )}
      {row.raw_input.bill_of_lading && (
        <p className="muted" style={{ margin: "4px 0" }}>
          Bill of Lading: {row.raw_input.bill_of_lading}. Arrival: {row.raw_input.arrival_date || "not supplied"}.
        </p>
      )}
      {row.raw_input.description && <p style={{ margin: "4px 0" }}><strong>Goods Description:</strong> {row.raw_input.description}</p>}
      {row.raw_input.source_url && /^https?:\/\//.test(row.raw_input.source_url) && (
        <p style={{ margin: "4px 0" }}>
          <a href={row.raw_input.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            Uploaded Source Document <ExternalLink size={12} />
          </a>
        </p>
      )}
      <p style={{ margin: "4px 0" }} className="muted">
        Entry Date: {row.evaluation_date ?? "not provided"} · Quantity: {row.quantity ?? "not provided"} {row.unit ?? ""} · Chapter 99 Codes: {row.chapter99_codes ?? "none"}
      </p>

      {row.review_reason && (
        <div className="card" style={{ background: "rgba(180, 83, 9, 0.05)", borderColor: "rgba(180, 83, 9, 0.2)", margin: "8px 0", padding: "8px 12px" }}>
          <strong style={{ color: "var(--warn)", display: "flex", alignItems: "center", gap: "4px" }}>
            <AlertTriangle size={14} /> Review Guidance
          </strong>
          <p style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>{row.review_reason}</p>
        </div>
      )}

      {row.error && (
        <div role="alert" className="card" style={{ background: "rgba(220, 38, 38, 0.05)", borderColor: "rgba(220, 38, 38, 0.2)", margin: "8px 0", padding: "8px 12px" }}>
          <strong style={{ color: "var(--danger)" }}>Missing or Invalid Data to Correct:</strong>
          <p style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>
            {row.error.replace(/annual_import_value_usd/g, "import value").replace(/customs_value_usd/g, "customs value").replace(/paid_duty_usd/g, "duty paid").replace(/entry_id/g, "entry ID").replace(/line_number/g, "entry line").replace(/\bhts\b/g, "HTS code").replace(/\bsku\b/g, "SKU")}
          </p>
        </div>
      )}

      {row.stack_result ? (
        <div style={{ marginTop: "8px" }}>
          <table className="table" style={{ fontSize: "0.8rem", marginBottom: "6px" }}>
            <thead>
              <tr>
                <th scope="col">Tariff Measure</th>
                <th scope="col">Rate</th>
                <th scope="col">Calculated Duty</th>
                <th scope="col">Legal Citation</th>
              </tr>
            </thead>
            <tbody>
              {row.stack_result.components.map((part, index) => (
                <tr key={index}>
                  <td><strong>{part.label}</strong></td>
                  <td>{rate(part.ratePercent)}</td>
                  <td>{usd(part.amount)}</td>
                  <td>
                    {part.citation.map((url, i) =>
                      /^https?:\/\//.test(url) ? (
                        <a key={url} href={url} target="_blank" rel="noreferrer" style={{ marginRight: 6, display: "inline-flex", alignItems: "center", gap: "2px" }}>
                          USITC Source {i + 1} <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span key={url} style={{ marginRight: 6 }}>{url}</span>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: "0.75rem", margin: "4px 0" }}>
            {row.stack_result.stackingExplanation.join(" ")}
          </p>
          {row.stack_result.unresolvedMeasures.length > 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--warn)", margin: "4px 0" }}>
              <strong>Requires Legal Review:</strong> {row.stack_result.unresolvedMeasures.join("; ")}
            </p>
          )}
        </div>
      ) : (
        <p className="muted" style={{ margin: "4px 0", fontStyle: "italic" }}>No tariff breakdown available for this entry.</p>
      )}
    </div>
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
  const [dragOver, setDragOver] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [activeFilter, setActiveFilter] = useState<"all" | "overpaid" | "review" | "error">("all");
  const [showMappingDrawer, setShowMappingDrawer] = useState(false);

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

  async function propose(fileToPropose: File | null) {
    setFile(fileToPropose);
    setProposal(null);
    setError(null);
    if (!fileToPropose) return;
    if (fileToPropose.size > 2 * 1024 * 1024) { setError("CSV exceeds the 2 MiB upload limit."); return; }
    setBusy("mapping");
    try {
      const prop = await readResponse<MappingProposal>(await fetch(`${endpoint}/propose-mapping`, {
        method: "POST", headers: { "Content-Type": "text/csv" }, body: fileToPropose,
      }));
      setProposal(prop);
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

  async function loadDemoImports() {
    setError(null);
    setBusy("mapping");
    try {
      const res = await fetch("/examples/lulzbot-synthetic-imports.csv");
      if (!res.ok) throw new Error("Could not fetch demo imports dataset.");
      const blob = await res.blob();
      const demoFile = new File([blob], "lulzbot-synthetic-imports.csv", { type: "text/csv" });
      await propose(demoFile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sample dataset.");
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

  const toggleRow = (rowNum: number) => {
    setExpandedRows(prev => ({ ...prev, [rowNum]: !prev[rowNum] }));
  };

  // KPI Calculations
  const overpaidRows = run ? run.rows.filter(r => r.status === "computed" && (r.annual_delta_usd ?? 0) < 0) : [];
  const totalOverpayment = overpaidRows.reduce((sum, r) => sum + Math.abs(r.annual_delta_usd ?? 0), 0);
  const underpaidRows = run ? run.rows.filter(r => r.status === "computed" && (r.annual_delta_usd ?? 0) > 0) : [];
  const totalUnderpayment = underpaidRows.reduce((sum, r) => sum + (r.annual_delta_usd ?? 0), 0);

  const filteredRows = run ? run.rows.filter(row => {
    if (activeFilter === "overpaid") return row.status === "computed" && (row.annual_delta_usd ?? 0) < 0;
    if (activeFilter === "review") return row.status === "unresolved";
    if (activeFilter === "error") return row.status === "error";
    return true;
  }) : [];

  return (
    <section aria-label="Tariff impact analysis">
      {/* Visual Workflow Journey Stepper */}
      <nav className="workflow-stepper" aria-label="Compliance workflow steps">
        <a href="/catalogue" className="workflow-step">
          <span className="workflow-step-num">1</span>
          <div className="workflow-step-info">
            <span className="workflow-step-title">Product Catalogue</span>
            <span className="workflow-step-desc">Company SKUs &amp; HTS</span>
          </div>
        </a>
        <div className="workflow-step-divider" />
        <div className="workflow-step active">
          <span className="workflow-step-num">2</span>
          <div className="workflow-step-info">
            <span className="workflow-step-title">Upload Imports</span>
            <span className="workflow-step-desc">Customs 7501 entry lines</span>
          </div>
        </div>
        <div className="workflow-step-divider" />
        <div className={`workflow-step ${run ? "completed" : ""}`}>
          <span className="workflow-step-num">3</span>
          <div className="workflow-step-info">
            <span className="workflow-step-title">Duty Audit &amp; Savings</span>
            <span className="workflow-step-desc">Overpayments &amp; tariff changes</span>
          </div>
        </div>
      </nav>

      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1>Imports &amp; Tariff Audit</h1>
          <p className="page-sub">
            Upload your broker&apos;s customs entry lines to verify duties paid, detect overpayments, and evaluate business exposure.
          </p>
        </div>
      </div>

      {error && <div className="pill pill-bad" role="alert" style={{ marginBottom: "1rem", whiteSpace: "normal" }}>{error}</div>}

      {/* Hero Upload Dropzone Card */}
      <div className="card" style={{ marginBottom: "1.5rem", padding: "20px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 4px" }}>Customs Entry Ingestion</h2>
            <p className="muted" style={{ margin: 0 }}>
              Drop your broker CSV or entry summary spreadsheet below. Column headers are automatically recognized.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <a href="/examples/imports-template.csv" download className="btn btn-lg" style={{ color: "var(--text)" }}>
              <Download size={16} /> Download Blank CSV Template
            </a>
            {!file && (
              <button className="btn btn-lg" disabled={busy !== null} onClick={() => void loadDemoImports()}>
                <Sparkles size={16} color="var(--blue)" /> Load Sample Dataset
              </button>
            )}
          </div>
        </div>

        {/* Drag & Drop Area */}
        <div
          className={`upload-dropzone ${dragOver ? "dragover" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void propose(dropped);
          }}
          onClick={() => document.getElementById("impact-csv-input")?.click()}
        >
          <input
            id="impact-csv-input"
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => void propose(e.target.files?.[0] ?? null)}
          />
          <div className="upload-icon-circle">
            <Upload size={26} />
          </div>
          {file ? (
            <>
              <h3 style={{ color: "var(--blue)" }}>{file.name}</h3>
              <p className="muted">{(file.size / 1024).toFixed(1)} KB · Columns matched with AI assistant</p>
            </>
          ) : (
            <>
              <h3>Drag &amp; drop your Customs Import CSV here</h3>
              <p>Or click to browse files (accepts entry numbers, dates, HTS codes, values, duty paid)</p>
            </>
          )}
        </div>

        {/* File Actions & Column Mapping Trigger */}
        {file && proposal && (
          <div style={{ marginTop: "16px", background: "var(--app-background)", borderRadius: "var(--radius-lg)", padding: "16px", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <strong style={{ fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
                  <CheckCircle2 size={16} color="var(--ok)" /> Ready to Audit: {file.name}
                </strong>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.8rem" }}>
                  Columns recognized. Review mappings if you have custom header names.
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowMappingDrawer(v => !v)}
                >
                  {showMappingDrawer ? "Hide Column Matches" : "Review Column Matches"}
                </button>
                <button
                  type="button"
                  className="btn btn-lg btn-primary-gradient"
                  disabled={busy !== null}
                  onClick={() => void upload()}
                >
                  {busy === "upload" ? "Analyzing Duties…" : "Run Tariff Audit & Calculate Discrepancies →"}
                </button>
              </div>
            </div>

            {/* Column Mapping Details */}
            {showMappingDrawer && (
              <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
                <table className="table" style={{ fontSize: "0.85rem" }}>
                  <thead>
                    <tr>
                      <th scope="col">Standard Field</th>
                      <th scope="col">Matched in Your File</th>
                      <th scope="col">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(fieldLabels) as CanonicalField[])
                      .filter(field => !["annual_import_value_usd", "current_duty_rate"].includes(field))
                      .map(field => (
                        <tr key={field}>
                          <td><strong>{fieldLabels[field]}</strong></td>
                          <td>
                            <select
                              className="input"
                              style={{ width: "100%", maxWidth: "260px" }}
                              disabled={busy !== null}
                              value={proposal.mapping[field] ?? ""}
                              onChange={event => setProposal({ ...proposal, mapping: { ...proposal.mapping, [field]: event.target.value || null } })}
                            >
                              <option value="">None (skip field)</option>
                              {proposal.headers.map(header => <option key={header} value={header}>{header}</option>)}
                            </select>
                          </td>
                          <td>
                            <span className={`pill ${proposal.confidence[field] > 0.8 ? "pill-ok" : proposal.confidence[field] > 0.4 ? "pill-blue" : "pill-muted"}`}>
                              {Math.round(proposal.confidence[field] * 100)}% Match
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Progress bar during calculation */}
        {busy && (
          <div role="status" className="card" style={{ marginTop: "12px", background: "rgba(var(--azure), 0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <RefreshCw size={16} className="spin" color="var(--blue)" />
              <strong>
                {busy === "upload" ? uploaded ? "Processing entry lines against USITC HTS and Section 301/232 tables…" : `Uploading file${progress === null ? "…" : ` (${progress}%)`}`
                  : busy === "mapping" ? "Analyzing CSV header structure…" : busy === "open" ? "Loading saved review…" : "Exporting report…"}
              </strong>
            </div>
            {busy === "upload" && !uploaded && (
              <progress aria-label="CSV upload progress" max={100} value={progress ?? undefined} style={{ display: "block", width: "100%", marginTop: 8 }} />
            )}
          </div>
        )}
      </div>

      {/* Results Dashboard Section */}
      {run && (
        <section aria-labelledby="audit-dashboard-heading" style={{ marginBottom: "2rem" }}>
          <div className="card-head" style={{ marginBottom: "14px" }}>
            <div>
              <h2 id="audit-dashboard-heading" style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 4px" }}>
                Audit Results: {run.filename}
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                Analyzed on {new Date(run.created_at).toLocaleDateString()} at {new Date(run.created_at).toLocaleTimeString()}
              </p>
            </div>
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => void exportRun()}>
              <Download size={14} /> Export Audit Report (CSV)
            </button>
          </div>

          {/* Executive KPI Metric Grid */}
          <div className="metric-grid">
            <div className={`metric-card ${totalOverpayment > 0 ? "tone-ok" : ""}`}>
              <span className="metric-label">Potential Duty Overpayments</span>
              <span className="metric-value">{usd(totalOverpayment)}</span>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {overpaidRows.length > 0 ? `${overpaidRows.length} entry line(s) overpaid` : "No duty overpayments flagged"}
              </span>
            </div>

            <div className={`metric-card ${totalUnderpayment > 0 ? "tone-warn" : ""}`}>
              <span className="metric-label">Underpaid / Additional Exposure</span>
              <span className="metric-value">{usd(totalUnderpayment)}</span>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {underpaidRows.length > 0 ? `${underpaidRows.length} entry line(s) at risk` : "No underpayments detected"}
              </span>
            </div>

            <div className="metric-card tone-blue">
              <span className="metric-label">Lines Checked &amp; Verified</span>
              <span className="metric-value">{run.computed_count} / {run.source_count}</span>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {run.affected_sku_count} unique SKU(s) evaluated
              </span>
            </div>

            <div className={`metric-card ${run.unresolved_count + run.error_count > 0 ? "tone-warn" : ""}`}>
              <span className="metric-label">Requires Broker Review</span>
              <span className="metric-value">{run.unresolved_count + run.error_count}</span>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {run.error_count > 0 ? `${run.error_count} missing fields` : "Needs evidence verification"}
              </span>
            </div>
          </div>

          {/* Filter Bar */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
            <button
              className={`btn btn-small ${activeFilter === "all" ? "btn-primary" : ""}`}
              onClick={() => setActiveFilter("all")}
            >
              All Entries ({run.rows.length})
            </button>
            <button
              className={`btn btn-small ${activeFilter === "overpaid" ? "btn-primary" : ""}`}
              onClick={() => setActiveFilter("overpaid")}
            >
              Overpayments Flagged ({overpaidRows.length})
            </button>
            <button
              className={`btn btn-small ${activeFilter === "review" ? "btn-primary" : ""}`}
              onClick={() => setActiveFilter("review")}
            >
              Needs Review ({run.unresolved_count})
            </button>
            <button
              className={`btn btn-small ${activeFilter === "error" ? "btn-primary" : ""}`}
              onClick={() => setActiveFilter("error")}
            >
              Data Errors ({run.error_count})
            </button>
          </div>

          {/* Result Entry Cards */}
          <div role="region" aria-label="Tariff entry lines">
            {filteredRows.length === 0 ? (
              <div className="card empty">No entries match the selected filter.</div>
            ) : (
              filteredRows.map((row) => {
                const isOverpaid = row.status === "computed" && (row.annual_delta_usd ?? 0) < 0;
                const isUnderpaid = row.status === "computed" && (row.annual_delta_usd ?? 0) > 0;
                const isExpanded = !!expandedRows[row.row_number];

                return (
                  <article
                    key={row.row_number}
                    className={`audit-entry-card ${isOverpaid ? "has-overpayment" : isUnderpaid ? "has-underpayment" : row.status === "error" ? "has-error" : ""}`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                          <strong style={{ fontSize: "0.95rem", fontFamily: "var(--font-mono)" }}>
                            {row.entry_id ? `Entry ${row.entry_id}` : `Row #${row.row_number}`}
                          </strong>
                          {row.sku && <span className="pill pill-blue">{row.sku}</span>}
                          {row.hts && <span className="pill pill-muted font-mono">HTS: {row.hts}</span>}
                          {row.origin && <span className="pill pill-muted">Origin: {row.origin}</span>}
                          {row.evaluation_date && <span className="pill pill-muted">{row.evaluation_date}</span>}
                        </div>
                        <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                          {row.raw_input.description || (row.customs_value_usd ? `Customs Value: ${usd(row.customs_value_usd)}` : "No description provided")}
                        </p>
                      </div>

                      {/* Discrepancy Figures */}
                      <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                        <div style={{ textAlign: "right" }}>
                          <span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>Paid Duty</span>
                          <strong style={{ fontSize: "0.95rem" }}>{usd(row.paid_duty_usd ?? row.current_annual_duty_usd)}</strong>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>Cante Assessed</span>
                          <strong style={{ fontSize: "0.95rem" }}>{usd(row.computed_annual_duty_usd)}</strong>
                        </div>
                        <div>
                          {isOverpaid ? (
                            <span className="pill pill-ok" style={{ fontSize: "0.8rem", padding: "4px 8px" }}>
                              Potential Overpayment: {usd(Math.abs(row.annual_delta_usd!))}
                            </span>
                          ) : isUnderpaid ? (
                            <span className="pill pill-warn" style={{ fontSize: "0.8rem", padding: "4px 8px" }}>
                              Underpaid: {usd(row.annual_delta_usd!)}
                            </span>
                          ) : row.status === "computed" ? (
                            <span className="pill pill-ok" style={{ fontSize: "0.8rem", padding: "4px 8px" }}>
                              Exact Match
                            </span>
                          ) : row.status === "error" ? (
                            <span className="pill pill-bad" style={{ fontSize: "0.8rem", padding: "4px 8px" }}>
                              Missing Data
                            </span>
                          ) : (
                            <span className="pill pill-warn" style={{ fontSize: "0.8rem", padding: "4px 8px" }}>
                              Needs Review
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => toggleRow(row.row_number)}
                          aria-expanded={isExpanded}
                          aria-label={`Toggle details for row ${row.row_number}`}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Breakdown and Evidence */}
                    {isExpanded && <RowEvidence row={row} />}
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Regulatory Monitoring & Schedule Accordion */}
      <details className="card" style={{ marginBottom: "1.5rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Regulatory Schedule &amp; Automatic Rule Monitoring Status
        </summary>
        <div style={{ marginTop: "12px" }}>
          <ScheduleMonitor runId={run?.id ?? null} />
          <MonitorCandidates runId={run?.id ?? null} />
        </div>
      </details>

      {/* Saved Reviews History */}
      <section className="card" aria-labelledby="impact-history-heading">
        <div className="card-head">
          <div>
            <h2 id="impact-history-heading" className="card-title">Saved Import Audits</h2>
            <p className="muted" style={{ margin: 0 }}>Review previous customs audits and export historical records.</p>
          </div>
          <button className="btn btn-small" disabled={historyLoading || busy !== null} onClick={() => void loadHistory()}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {historyLoading ? (
          <p role="status">Loading audit history…</p>
        ) : historyError ? (
          <p role="alert">{historyError}</p>
        ) : runs.length === 0 ? (
          <p className="muted">No saved import audits yet. Upload a CSV above to get started.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {runs.map((saved) => (
              <li
                key={saved.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div>
                  <button
                    className="btn btn-small"
                    style={{ fontWeight: 600, marginRight: "8px" }}
                    disabled={busy !== null}
                    aria-current={run?.id === saved.id ? "true" : undefined}
                    onClick={() => void openRun(saved.id)}
                  >
                    {saved.filename}
                  </button>
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    {new Date(saved.created_at).toLocaleDateString()} · {saved.source_count} rows ({saved.computed_count} computed, {saved.unresolved_count} unreviewed)
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="btn btn-small btn-primary"
                    disabled={busy !== null}
                    onClick={() => void openRun(saved.id)}
                  >
                    View Results
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
