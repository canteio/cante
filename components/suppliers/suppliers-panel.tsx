"use client";

import { useCallback, useEffect, useState } from "react";
import { Truck, ShieldCheck, ShieldAlert, Plus, Search, FileCheck, RefreshCw } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

type SupplierDoc = {
  id: string;
  docType: string;
  status: string;
  requestedAt: string | null;
  expiresAt: string | null;
};

type Screening = {
  outcome: string;
  matchCount: number;
  screenedAt: string;
  errorMessage: string | null;
};

type Supplier = {
  id: string;
  name: string;
  country: string | null;
  role: string;
  documents: SupplierDoc[];
  latestScreening: Screening | null;
};

type Gap = {
  supplier: { id: string; name: string };
  docType: string;
  status: string;
  detail: string;
  severity: string;
};

type Coverage = {
  totalSuppliers: number;
  neverScreened: string[];
  staleScreenings: Array<{ name: string; ageDays: number }>;
  currentMatches: Array<{ name: string; matchCount: number }>;
  erroredScreenings: string[];
};

const STATUS_CLASS: Record<string, string> = {
  received: "pill-ok",
  requested: "pill-warn",
  not_requested: "pill-muted",
  expired: "pill-bad",
  rejected: "pill-bad",
  not_applicable: "pill-muted",
};

const SCREEN_CLASS: Record<string, string> = {
  clear: "pill-ok",
  match: "pill-bad",
  error: "pill-warn",
};

export function SuppliersPanel({ country }: { country: JurisdictionName }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [name, setName] = useState("");
  const [supplierCountry, setSupplierCountry] = useState("South Korea");
  const [role, setRole] = useState("Raw Material Manufacturer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers");
      const data = await res.json();
      setSuppliers(data.suppliers ?? []);
      setGaps(data.gaps ?? []);
      setCoverage(data.screeningCoverage ?? null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data.error as string) ?? "Request failed.");
        return null;
      }
      await load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function addSupplier() {
    if (!name.trim()) return;
    const res = await post({ action: "upsert", name: name.trim(), country: supplierCountry, role });
    if (res) setName("");
  }

  async function screenSupplier(supplierId: string) {
    const data = await post({ action: "screen", supplierId });
    if (data && data.screening) {
      setNote("Screening completed for supplier: outcome is " + ((data.screening as any).outcome || "clear") + ".");
    }
  }

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Suppliers & Vendor Due Diligence</h1>
          <p className="page-sub">
            Track overseas raw material suppliers, missing Certificates of Analysis (COA), Form E/AK origin certificates,
            and screen counterparties against official US/UN sanctions lists.
          </p>
        </div>
        <CountryTabs value={country} />
      </div>

      {error && <div className="pill pill-bad" style={{ marginBottom: "1rem" }}>{error}</div>}
      {note && <div className="pill pill-ok" style={{ marginBottom: "1rem" }}>{note}</div>}

      {/* Add Supplier Form */}
      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-head">
          <Plus size={15} strokeWidth={1.75} />
          <h2>Add New Supplier</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.5fr auto", gap: "0.5rem", marginTop: "0.5rem" }}>
          <input
            className="input"
            placeholder="Supplier Legal Name (e.g. LG Chem Ltd)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Country (e.g. South Korea, China, Taiwan)"
            value={supplierCountry}
            onChange={(e) => setSupplierCountry(e.target.value)}
          />
          <input
            className="input"
            placeholder="Role (e.g. PVC Resin Manufacturer)"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={addSupplier}>
            {busy ? "Adding…" : "Add Supplier"}
          </button>
        </div>
      </section>

      {/* Screening & Gaps Overview */}
      {coverage && (
        <section className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-head">
            <ShieldCheck size={16} />
            <h2>Sanctions & Evidence Coverage</h2>
          </div>
          <div className="meta-row" style={{ marginTop: "0.25rem" }}>
            <span className="pill pill-muted">{coverage.totalSuppliers} Total Suppliers</span>
            {coverage.neverScreened.length > 0 ? (
              <span className="pill pill-warn">{coverage.neverScreened.length} Not Screened Yet</span>
            ) : (
              <span className="pill pill-ok">100% Screened</span>
            )}
            {coverage.currentMatches.length > 0 && (
              <span className="pill pill-bad">{coverage.currentMatches.length} Sanction Matches!</span>
            )}
          </div>
        </section>
      )}

      {/* Supplier Grid */}
      <div className="side-label">Active Vendors ({suppliers.length})</div>
      {suppliers.length === 0 ? (
        <div className="empty">
          <Truck size={24} strokeWidth={1.5} style={{ marginBottom: 8 }} />
          <p>No suppliers registered yet. Add a vendor above or tell the AI Copilot in chat.</p>
        </div>
      ) : (
        <div className="checklist-grid">
          {suppliers.map((s) => (
            <article key={s.id} className="card">
              <div className="checklist-card-top">
                <div>
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>{s.name}</h3>
                  <div className="checklist-summary">
                    {s.role} {s.country ? (" · " + s.country) : ""}
                  </div>
                </div>
                {s.latestScreening ? (
                  <span className={"pill " + (SCREEN_CLASS[s.latestScreening.outcome] ?? "pill-muted")}>
                    Sanctions: {s.latestScreening.outcome.toUpperCase()}
                  </span>
                ) : (
                  <span className="pill pill-warn">Unscreened</span>
                )}
              </div>

              {/* Certificate Documents */}
              <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                <div className="side-label" style={{ padding: 0, marginBottom: 4 }}>Certificates & Evidence</div>
                {s.documents.length === 0 ? (
                  <div className="muted" style={{ fontSize: "0.8rem" }}>No certificates on file.</div>
                ) : (
                  s.documents.map((doc) => (
                    <div key={doc.id} className="meta-row" style={{ marginTop: 2 }}>
                      <span style={{ fontSize: "0.85rem" }}>{doc.docType.replace(/_/g, " ")}</span>
                      <span className={"pill " + (STATUS_CLASS[doc.status] ?? "pill-muted")}>
                        {doc.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="checklist-actions" style={{ marginTop: "0.75rem" }}>
                <button className="btn btn-small" onClick={() => screenSupplier(s.id)}>
                  <Search size={12} /> Screen Sanctions
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
