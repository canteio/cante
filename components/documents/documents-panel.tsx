"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, ShieldAlert, CheckCircle2, AlertTriangle, Play, Upload } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";
import { auditDocumentDiscrepancies, type DocumentSet, type DiscrepancyAuditResult } from "@/lib/documents/discrepancy";

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

const SAMPLE_CLEAN_SHIPMENT: DocumentSet = {
  shipmentReference: "SHP-2026-08-BUSAN",
  commercialInvoice: {
    invoiceNumber: "INV-LG-9988",
    invoiceDate: "2026-08-10",
    sellerName: "Acme Chemicals (Busan, South Korea)",
    buyerName: "Acme Manufacturing",
    currency: "USD",
    incoterm: "CIF",
    totalValue: 50000,
    lineItems: [
      { itemDescription: "PVC Resin Primary Forms (K-67)", htsusCode: "3904.10.00", quantity: 50, unitPrice: 1000, totalAmount: 50000 },
    ],
  },
  packingList: {
    totalPackages: 2000,
    totalGrossWeightKg: 50500,
    totalNetWeightKg: 50000,
    containerNumbers: ["TGHU1234567", "MSKU7654321"],
  },
  billOfLading: {
    blNumber: "ONE202608101",
    shipperName: "Acme Chemicals",
    consigneeName: "Acme Manufacturing",
    portOfLoading: "Busan, South Korea",
    portOfDischarge: "Tanjung Priok, Jakarta",
    containerNumbers: ["TGHU1234567", "MSKU7654321"],
    declaredGrossWeightKg: 50500,
    freightPayableTerm: "PREPAID",
  },
  certificateOfOrigin: {
    coNumber: "AK2026-8877",
    formType: "FORM_AK",
    countryOfOrigin: "KR",
    invoiceReferenceNumber: "INV-LG-9988",
    declaredHtsCode: "3904.10.00",
    originCriterion: "WO",
  },
  certificateOfAnalysis: {
    productName: "PVC Resin K-67",
    batchNumber: "LOT-2026-08",
    chemicalParameters: [
      { parameterName: "Polyvinyl chloride", casNumber: "9002-86-2", measuredValue: "99.8%", isPass: true },
    ],
  },
};

const SAMPLE_DISCREPANT_SHIPMENT: DocumentSet = {
  shipmentReference: "SHP-2026-08-DISCREPANT",
  commercialInvoice: {
    invoiceNumber: "INV-5544",
    invoiceDate: "2026-08-12",
    sellerName: "Example Chemicals",
    buyerName: "Acme Manufacturing",
    currency: "USD",
    incoterm: "CIF",
    totalValue: 35000,
    lineItems: [
      { itemDescription: "DOP Plasticizer", htsusCode: "2917.34.00", quantity: 35, unitPrice: 1000, totalAmount: 35000 },
    ],
  },
  packingList: {
    totalPackages: 175,
    totalGrossWeightKg: 35000,
    totalNetWeightKg: 37000, // Net > Gross!
    containerNumbers: ["CONT111", "CONT222"],
  },
  billOfLading: {
    blNumber: "BL-5544",
    shipperName: "Example Chemicals",
    consigneeName: "Acme Manufacturing",
    portOfLoading: "Shanghai",
    portOfDischarge: "Tanjung Priok",
    containerNumbers: ["CONT111"], // CONT222 missing!
    declaredGrossWeightKg: 40000, // Weight mismatch!
    freightPayableTerm: "COLLECT", // CIF vs Collect conflict!
  },
  certificateOfOrigin: {
    coNumber: "FORM-E-99",
    formType: "FORM_E",
    countryOfOrigin: "CN",
    invoiceReferenceNumber: "INV-0000", // Invoice mismatch!
    declaredHtsCode: "3812.39", // HTS mismatch!
    originCriterion: "RVC",
  },
  certificateOfAnalysis: {
    productName: "DOP Plasticizer",
    batchNumber: "B-99",
    chemicalParameters: [
      { parameterName: "Dioctyl phthalate", measuredValue: "99.5%", isPass: true }, // missing CAS number!
    ],
  },
};

export function DocumentsPanel({ country }: { country: JurisdictionName }) {
  const [documents, setDocuments] = useState<TradeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditResult, setAuditResult] = useState<DiscrepancyAuditResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      setDocuments(data.documents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function runAudit(docSet: DocumentSet) {
    const res = auditDocumentDiscrepancies(docSet);
    setAuditResult(res);
  }

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Shipment Documents & Cross-Check Audit</h1>
          <p className="page-sub">
            Cross-references Commercial Invoices, Packing Lists, Bills of Lading, COAs, and Origin Certificates
            to detect mismatches before customs filing and prevent port holds.
          </p>
        </div>
        <CountryTabs value={country} />
      </div>

      {/* Discrepancy Engine Sandbox */}
      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-head">
          <ShieldAlert size={16} />
          <h2>Live Document Cross-Check Engine</h2>
        </div>
        <p className="page-sub" style={{ margin: "4px 0 12px" }}>
          Test the automated discrepancy validator on live shipment document sets:
        </p>
        <div className="page-actions" style={{ marginBottom: "1rem" }}>
          <button className="btn btn-primary" onClick={() => runAudit(SAMPLE_CLEAN_SHIPMENT)}>
            <Play size={13} /> Test Clean Shipment (Korea PVC Resin)
          </button>
          <button className="btn" onClick={() => runAudit(SAMPLE_DISCREPANT_SHIPMENT)}>
            <AlertTriangle size={13} /> Test Discrepant Shipment (Weight/HTS Conflicts)
          </button>
        </div>

        {auditResult && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <div className="meta-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div>
                <span className="side-label" style={{ padding: 0 }}>Clearance Readiness</span>
                <div style={{ fontSize: "1.25rem", fontWeight: "bold", color: auditResult.clearanceReadinessScore > 80 ? "var(--ok)" : "var(--danger)" }}>
                  {auditResult.clearanceReadinessScore} / 100
                </div>
              </div>
              <span className={`pill ${auditResult.hasDiscrepancies ? "pill-bad" : "pill-ok"}`}>
                {auditResult.hasDiscrepancies ? `${auditResult.flags.length} Discrepancies Flagged` : "100% Ready for Customs Entry"}
              </span>
            </div>

            <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              {auditResult.summary}
            </p>

            {auditResult.flags.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {auditResult.flags.map((flag, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--card-bg)",
                      border: "1px solid var(--border)",
                      // Bug fix: stray `}` was embedded inside the "var(--warn)" string literal,
                      // producing an invalid CSS value ("var(--warn)}") for non-CRITICAL flags.
                      // Browsers silently drop invalid CSS values, so WARNING-severity discrepancy
                      // cards rendered with NO left border color at all — visually indistinguishable
                      // from a CRITICAL flag's colored border. Fixed template literal below.
                      borderLeft: `4px solid ${flag.severity === "CRITICAL" ? "var(--danger)" : "var(--warn)"}`,
                      padding: "8px 12px",
                      borderRadius: 4,
                    }}
                  >
                    <div className="meta-row" style={{ justifyContent: "space-between", marginBottom: 2 }}>
                      <strong style={{ fontSize: "0.9rem" }}>{flag.title}</strong>
                      <span className={`pill ${flag.severity === "CRITICAL" ? "pill-bad" : "pill-warn"}`}>
                        {flag.severity}
                      </span>
                    </div>
                    <p style={{ margin: "2px 0 4px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                      {flag.details}
                    </p>
                    <div className="code-basis" style={{ margin: "4px 0" }}>
                      <strong>Resolution:</strong> {flag.recommendedResolution}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Uploaded History */}
      <div className="side-label">Uploaded Document Archive ({documents.length})</div>
      {loading ? (
        <div className="empty">Loading documents…</div>
      ) : documents.length === 0 ? (
        <div className="empty">No uploaded documents archived yet.</div>
      ) : (
        <div className="checklist-grid">
          {documents.map((doc) => (
            <article key={doc.id} className="card">
              <div className="checklist-card-top">
                <div>
                  <span className="pill pill-blue">{doc.docType.toUpperCase()}</span>
                  <h3 style={{ margin: "4px 0 2px", fontSize: "0.95rem" }}>{doc.filename}</h3>
                </div>
                <span className="pill pill-ok">{doc.parseStatus}</span>
              </div>
              <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
