"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

/**
 * Document audit — item 8.
 *
 * The parse status badge is the load-bearing element. A document that could not
 * be read must never present the same way as one that was read and found clean,
 * so `failed` and `partial` are rendered before any findings are.
 */

type DocFinding = {
  id: string;
  kind: string;
  severity: string;
  message: string;
  documentValue: string | null;
  expectedValue: string | null;
  expectationTier: string;
  dutyDifference: number | null;
  dutyCurrency: string;
  dutyBasis: string[];
};

type TradeDoc = {
  id: string;
  docType: string;
  filename: string;
  documentNumber: string | null;
  documentDate: string | null;
  parseStatus: string;
  parseNote: string | null;
  uploadedAt: string;
};

const PARSE_CLASS: Record<string, string> = {
  parsed: "pill-ok",
  partial: "pill-warn",
  unparsed: "pill-muted",
  failed: "pill-bad",
};

const SEVERITY_CLASS: Record<string, string> = {
  high: "pill-bad",
  medium: "pill-warn",
  low: "pill-muted",
};

const DOC_TYPES = [
  "peb",
  "commercial_invoice",
  "packing_list",
  "purchase_order",
  "customs_entry",
  "bill_of_lading",
  "other",
];

export function DocumentsPanel({ country }: { country: JurisdictionName }) {
  const [documents, setDocuments] = useState<TradeDoc[]>([]);
  const [findings, setFindings] = useState<Record<string, DocFinding[]>>({});
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [docType, setDocType] = useState("peb");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/documents");
    const data = await res.json();
    setDocuments(data.documents ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ingest", docType, filename: filename || "pasted.txt", text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      setFindings((current) => ({ ...current, [data.document.id]: data.findings }));
      setText("");
      setFilename("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function promote(documentId: string) {
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "promote", documentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Promotion failed.");
      return;
    }
    setNote(
      data.promoted.length
        ? `Promoted ${data.promoted.length} code(s) to document tier. They still need approval in Catalogue.`
        : `Nothing promoted. ${data.skipped.join(" ")}`,
    );
  }

  async function showFindings(documentId: string) {
    const res = await fetch(`/api/documents?documentId=${documentId}`);
    const data = await res.json();
    setFindings((current) => ({ ...current, [documentId]: data.findings ?? [] }));
  }

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <p className="page-sub">
            Upload a PEB, invoice, packing list, or PO as text. Cante compares it against the
            catalogue and can promote the codes it declares to document tier — the only tier that
            counts as verified.
          </p>
        </div>
        <CountryTabs value={country} />
      </div>

      <section className="card">
        <div className="card-head">
          <FileText size={15} strokeWidth={1.75} />
          <h2>Add a document</h2>
        </div>
        <p className="page-sub">
          Text only. PDF extraction and OCR are not implemented, so paste the text or upload a text
          export rather than a scan.
        </p>
        <div className="meta-row">
          <select className="input" value={docType} onChange={(event) => setDocType(event.target.value)}>
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="filename"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
          />
        </div>
        <textarea
          className="input mono"
          rows={8}
          value={text}
          placeholder={"Nomor Pendaftaran: 000123\nTanggal: 12/08/2026\n\n1 PVC-100 Blue tarpaulin 6306.12.00 origin: Indonesia 1200 pcs"}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="page-actions">
          <button className="btn" disabled={busy || !text.trim()} onClick={() => void upload()}>
            {busy ? "Reading…" : "Upload and audit"}
          </button>
        </div>
        {error && <div className="pill pill-bad">{error}</div>}
        {note && <div className="pill pill-blue">{note}</div>}
      </section>

      {documents.length === 0 ? (
        <div className="empty">
          <FileText size={20} strokeWidth={1.5} />
          <p>No documents yet. This is the only automated path to a verified HS code.</p>
        </div>
      ) : (
        <div className="checklist-grid">
          {documents.map((document) => (
            <article key={document.id} className="card">
              <div className="checklist-card-top">
                <div>
                  <div className="strong">{document.filename}</div>
                  <div className="checklist-summary">
                    {document.docType.replace(/_/g, " ")}
                    {document.documentNumber ? ` · ${document.documentNumber}` : ""}
                    {document.documentDate ? ` · ${document.documentDate}` : ""}
                  </div>
                </div>
                <span className={`pill ${PARSE_CLASS[document.parseStatus] ?? "pill-muted"}`}>
                  {document.parseStatus}
                </span>
              </div>

              {document.parseNote && <div className="checklist-why">{document.parseNote}</div>}

              <div className="checklist-actions">
                <button className="btn btn-small" onClick={() => void showFindings(document.id)}>
                  Show findings
                </button>
                <button className="btn btn-small" onClick={() => void promote(document.id)}>
                  Promote codes
                </button>
              </div>

              {findings[document.id]?.length ? (
                <div className="checklist-block">
                  <div className="side-label">Discrepancies</div>
                  {findings[document.id].map((finding) => (
                    <div key={finding.id} className="impact-row">
                      <div className="meta-row">
                        <span className={`pill ${SEVERITY_CLASS[finding.severity] ?? "pill-muted"}`}>
                          {finding.severity}
                        </span>
                        <span className="pill pill-muted">{finding.kind.replace(/_/g, " ")}</span>
                      </div>
                      <div>{finding.message}</div>
                      {finding.expectedValue && (
                        <div className="code-basis muted">
                          Document: {finding.documentValue} · Catalogue: {finding.expectedValue} (
                          {finding.expectationTier} tier)
                        </div>
                      )}
                      {finding.dutyDifference !== null && (
                        <div className="strong">
                          Duty difference: {finding.dutyCurrency}{" "}
                          {finding.dutyDifference.toLocaleString()}
                          {finding.dutyDifference > 0
                            ? " — the declared code paid less than the catalogue code would."
                            : finding.dutyDifference < 0
                              ? " — the declared code paid more than the catalogue code would."
                              : " — no difference at published rates."}
                        </div>
                      )}
                      {finding.dutyBasis?.map((line, index) => (
                        <div key={index} className="code-basis muted">
                          {line}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : findings[document.id] ? (
                <div className="muted">No discrepancies found in what was read.</div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
