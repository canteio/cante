"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Upload,
} from "lucide-react";
import type { MonitoredExposureAlert } from "@/lib/tariff/federal-register-monitor";
import { BusinessImpactPanel } from "./business-impact-panel";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd = (val: number) => money.format(val);

export function MissionOneHub() {
  const [activeTab, setActiveTab] = useState<"alert" | "audit">("alert");
  const [alertData, setAlertData] = useState<MonitoredExposureAlert | null>(null);
  const [loadingAlert, setLoadingAlert] = useState(true);
  const [checkingLive, setCheckingLive] = useState(false);
  const [showSkusList, setShowSkusList] = useState(true);
  const [skuSearch, setSkuSearch] = useState("");

  useEffect(() => {
    void fetchAlert();
  }, []);

  async function fetchAlert() {
    setLoadingAlert(true);
    try {
      const res = await fetch("/api/tariff/monitor-federal-register");
      const data = await res.json();
      if (data.alert) {
        setAlertData(data.alert);
      }
    } catch {
      // Fallback handled gracefully
    } finally {
      setLoadingAlert(false);
    }
  }

  async function checkLiveFederalRegister() {
    setCheckingLive(true);
    try {
      const res = await fetch("/api/tariff/monitor-federal-register", { method: "POST" });
      const data = await res.json();
      if (data.alert) {
        setAlertData(data.alert);
      }
    } finally {
      setCheckingLive(false);
    }
  }

  const filteredAlertProducts = (alertData?.affectedProducts ?? []).filter(p => {
    if (!skuSearch.trim()) return true;
    const q = skuSearch.toLowerCase();
    return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.hts.includes(q) || p.supplier.toLowerCase().includes(q);
  });

  return (
    <div className="mission-hub" style={{ maxWidth: "1200px", margin: "0 auto", paddingBottom: "3rem" }}>
      {/* ─── Hero Visual Graphic Card ────────────────────────── */}
      <section className="import-graphic-card">
        <div className="import-graphic-text">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700, color: "var(--blue)", marginBottom: 6 }}>
            <Sparkles size={14} /> PROJECT MISSION ONE · TRADE COMPLIANCE HUB
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.02em" }}>
            Automated Tariff Impact &amp; Customs Audit
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.5 }}>
            Continuously monitors the Federal Register for newly enacted USTR and customs actions, cross-references your company&apos;s product catalog, and calculates exact financial exposure before entry filings.
          </p>
        </div>

        {/* Visual Drawing of Importing Flow */}
        <div className="import-graphic-svg" aria-label="Import flow illustration">
          <svg width="340" height="96" viewBox="0 0 340 96" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Cargo Ship */}
            <g transform="translate(10, 15)">
              <path d="M5 45 L55 45 L50 62 L15 62 Z" fill="#0284c7" />
              <rect x="18" y="25" width="10" height="20" fill="#38bdf8" rx="1" />
              <rect x="30" y="20" width="12" height="25" fill="#0369a1" rx="1" />
              <rect x="22" y="10" width="4" height="15" fill="#64748b" />
              <path d="M0 62 C15 58, 35 66, 60 62" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
              <text x="7" y="78" fill="#64748b" fontSize="9" fontWeight="600" fontFamily="sans-serif">Global Freight</text>
            </g>

            {/* Arrow 1 */}
            <path d="M75 42 L105 42" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="3 3" />
            <polygon points="108,42 102,39 102,45" fill="#94a3b8" />

            {/* Customs Inspection Port */}
            <g transform="translate(115, 12)">
              <rect x="0" y="8" width="54" height="52" rx="8" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
              <path d="M27 18 L40 24 L40 36 C40 44 27 50 27 50 C27 50 14 44 14 36 L14 24 Z" fill="rgba(2, 132, 199, 0.1)" stroke="#0284c7" strokeWidth="1.5" />
              <path d="M22 34 L26 38 L33 30" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <text x="3" y="74" fill="#64748b" fontSize="9" fontWeight="600" fontFamily="sans-serif">Customs 7501</text>
            </g>

            {/* Arrow 2 */}
            <path d="M180 42 L210 42" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="3 3" />
            <polygon points="213,42 207,39 207,45" fill="#94a3b8" />

            {/* Automated Engine */}
            <g transform="translate(220, 12)">
              <rect x="0" y="8" width="105" height="52" rx="8" fill="linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" />
              <circle cx="20" cy="34" r="9" fill="#22c55e" fillOpacity="0.2" />
              <text x="16" y="38" fill="#22c55e" fontSize="12" fontWeight="bold">✓</text>
              <text x="36" y="28" fill="#f8fafc" fontSize="10" fontWeight="bold" fontFamily="sans-serif">Tariff Matched</text>
              <text x="36" y="44" fill="#38bdf8" fontSize="11" fontWeight="800" fontFamily="sans-serif">Δ Exposure $</text>
              <text x="14" y="74" fill="#64748b" fontSize="9" fontWeight="600" fontFamily="sans-serif">Instant Audit</text>
            </g>
          </svg>
        </div>
      </section>

      {/* ─── Top Control Bar ────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className={`btn ${activeTab === "alert" ? "btn-primary" : ""}`}
            style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => setActiveTab("alert")}
          >
            <ShieldAlert size={15} color={activeTab === "alert" ? "#fff" : "#dc2626"} /> 
            Active Tariff Exposure
            {alertData && <span className="pill pill-bad" style={{ fontSize: "0.7rem", padding: "1px 6px", marginLeft: 4 }}>{alertData.affectedProductCount} SKUs</span>}
          </button>
          <button
            className={`btn ${activeTab === "audit" ? "btn-primary" : ""}`}
            style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => setActiveTab("audit")}
          >
            <Upload size={15} /> Upload &amp; Audit Your Files
          </button>
          <a
            href="/catalogue?country=United%20States"
            className="btn"
            style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Boxes size={15} /> Company Catalogue <ArrowRight size={13} />
          </a>
        </div>

        <button
          className="btn btn-small"
          disabled={checkingLive}
          onClick={() => void checkLiveFederalRegister()}
          title="Queries live official trade gazettes and CSMS bulletins"
        >
          <RefreshCw size={13} className={checkingLive ? "spin" : ""} />
          {checkingLive ? "Polling Government Feeds…" : "Check Government Feeds Live"}
        </button>
      </div>

      {/* ─── TAB 1: THE "OH SHIT, I NEED THIS" ALERT BANNER ───── */}
      {activeTab === "alert" && (
        <section aria-labelledby="regulatory-exposure-title">
          {alertData ? (
            <div className="mission-alert-banner">
              <div className="mission-alert-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="mission-alert-badge">
                    <AlertTriangle size={14} /> Critical Regulatory Action Detected
                  </span>
                  <span className="pill pill-muted">Document #{alertData.notice.documentNumber}</span>
                  <span className="pill pill-muted">Agency: {alertData.notice.agency}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a
                    href={alertData.notice.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-small"
                    style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.1)" }}
                  >
                    View Federal Register Notice <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              <h2 id="regulatory-exposure-title" style={{ fontSize: "1.35rem", fontWeight: 800, margin: "0 0 6px", color: "var(--text)" }}>
                {alertData.notice.title}
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: "0.875rem" }}>
                {alertData.summary}
              </p>

              {/* Big KPI Numbers */}
              <div className="mission-alert-kpi">
                <div>
                  <span className="metric-label" style={{ color: "#dc2626", fontWeight: 700 }}>Additional Annual Tariff Cost</span>
                  <div className="mission-alert-value">{usd(alertData.totalAnnualExposureUsd)}</div>
                  <span className="muted" style={{ fontSize: "0.75rem" }}>+25% Section 301 ad valorem surcharge</span>
                </div>

                <div>
                  <span className="metric-label">Affected Company SKUs</span>
                  <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--text)" }}>{alertData.affectedProductCount}</div>
                  <span className="muted" style={{ fontSize: "0.75rem" }}>Matched in enterprise catalogue</span>
                </div>

                <div>
                  <span className="metric-label">Overseas Suppliers</span>
                  <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--text)" }}>{alertData.affectedSupplierCount}</div>
                  <span className="muted" style={{ fontSize: "0.75rem" }}>Direct supply-chain impact</span>
                </div>

                <div>
                  <span className="metric-label">Enforcement Effective Date</span>
                  <div style={{ fontSize: "1.35rem", fontWeight: 700, color: "var(--text)", marginTop: 6 }}>{alertData.effectiveDate}</div>
                  <span className="pill pill-warn" style={{ fontSize: "0.7rem", marginTop: 4 }}>Urgent action required</span>
                </div>
              </div>

              {/* Action bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
                <button
                  className="btn btn-small btn-primary"
                  onClick={() => setShowSkusList(v => !v)}
                >
                  {showSkusList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showSkusList ? "Hide Affected Products Breakdown" : `Inspect All ${alertData.affectedProductCount} Affected SKUs`}
                </button>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  Last verified against official schedule: Today ({new Date(alertData.detectedAt).toLocaleTimeString()})
                </span>
              </div>

              {/* Detailed Breakdown List */}
              {showSkusList && (
                <div style={{ marginTop: 16, background: "var(--app-surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <strong>Affected Parts Breakdown ({alertData.affectedProductCount} SKUs)</strong>
                    <div style={{ position: "relative", width: "260px" }}>
                      <Search size={14} style={{ position: "absolute", left: 8, top: 9, color: "var(--text-muted)" }} />
                      <input
                        className="input"
                        style={{ paddingLeft: 28, fontSize: "0.8rem", height: 32 }}
                        placeholder="Filter by SKU, name, or HTS…"
                        value={skuSearch}
                        onChange={e => setSkuSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ overflowX: "auto" }}>
                    <table className="table" style={{ fontSize: "0.85rem" }}>
                      <thead>
                        <tr>
                          <th scope="col">SKU / Item</th>
                          <th scope="col">HTS Code</th>
                          <th scope="col">Origin &amp; Supplier</th>
                          <th scope="col">Annual Spend</th>
                          <th scope="col">Current Rate</th>
                          <th scope="col">New Tariff Rate</th>
                          <th scope="col">Additional Annual Surcharge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAlertProducts.map((p, idx) => (
                          <tr key={idx}>
                            <td>
                              <strong style={{ fontFamily: "var(--font-mono)", color: "var(--blue)" }}>{p.sku}</strong>
                              <div className="muted" style={{ fontSize: "0.75rem" }}>{p.name}</div>
                            </td>
                            <td><span className="mono">{p.hts}</span></td>
                            <td>
                              <span className="pill pill-muted" style={{ marginRight: 4 }}>{p.origin}</span>
                              <span style={{ fontSize: "0.8rem" }}>{p.supplier}</span>
                            </td>
                            <td>{usd(p.annualImportValueUsd)}</td>
                            <td>{p.currentDutyRatePercent}%</td>
                            <td><strong style={{ color: "#dc2626" }}>{p.newDutyRatePercent}%</strong></td>
                            <td>
                              <span className="pill pill-bad" style={{ fontWeight: 700 }}>
                                +{usd(p.additionalAnnualCostUsd)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : loadingAlert ? (
            <div className="card empty">Evaluating Federal Register notices against catalogue…</div>
          ) : (
            <div className="card" style={{ padding: "24px", textAlign: "center" }}>
              <CheckCircle2 size={32} color="var(--ok)" style={{ margin: "0 auto 8px" }} />
              <h3>No Unmitigated Regulatory Actions Detected</h3>
              <p className="muted">Your product catalogue currently has no active exposure against the latest Federal Register notices.</p>
            </div>
          )}
        </section>
      )}

      {/* ─── TAB 2: UNIFIED CUSTOMS INGESTION & AUDIT ────────── */}
      {activeTab === "audit" && (
        <BusinessImpactPanel />
      )}
    </div>
  );
}
