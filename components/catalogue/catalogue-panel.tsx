"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Check, Plus, Upload, X, Tag, FileText } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

type Classification = {
  id: string;
  system: string;
  code: string;
  tier: string;
  basis: string;
  status: string;
  rationale: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  materials: string[];
  originCountry: string | null;
  unitValue: number | null;
  currency: string;
  classifications: Classification[];
};

type ImportSummary = {
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  rows: Array<{ line: number; sku: string; outcome: string; reason?: string }>;
  caveats: string[];
};

const TIER_CLASS: Record<string, string> = {
  document: "pill-ok",
  human: "pill-blue",
  lead: "pill-warn",
  guess: "pill-muted",
};

const TIER_LABEL: Record<string, string> = {
  document: "Document Verified (PIB/PEB/7501)",
  human: "Human Confirmed",
  lead: "Lead / Declared",
  guess: "Seed / Guess",
};

export function CataloguePanel({ country }: { country: JurisdictionName }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [csv, setCsv] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick single product form
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [materials, setMaterials] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      setProducts(data.products ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addSingleProduct() {
    if (!sku.trim() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const csvContent = `sku,name,hs_code,materials\n"${sku.trim()}","${name.trim()}","${hsCode.trim()}","${materials.trim()}"`;
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvContent }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Failed to add product.");
      else {
        setSku("");
        setName("");
        setHsCode("");
        setMaterials("");
        setShowAddForm(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function importCsv() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Import failed.");
      else {
        setSummary(data.summary);
        setCsv("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Product Catalogue & Materials</h1>
          <p className="page-sub">
            Your manufactured goods and imported raw materials. Classifications determine import taxes (Bea Masuk, PPN, PPh 22), LARTAS quotas, and export rules.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            <Plus size={14} /> {showAddForm ? "Close Form" : "Add Product"}
          </button>
          <CountryTabs value={country} />
        </div>
      </div>

      {error && <div className="pill pill-bad" style={{ marginBottom: "1rem" }}>{error}</div>}

      {/* Quick Add Modal/Form */}
      {showAddForm && (
        <section className="card" style={{ marginBottom: "1.5rem", borderLeft: "4px solid var(--accent)" }}>
          <div className="card-head">
            <Tag size={16} />
            <h2>Add Single Product or Raw Material</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.5rem" }}>
            <div>
              <label className="side-label" style={{ padding: 0, marginBottom: 2 }}>SKU / Material Code *</label>
              <input
                className="input mono"
                placeholder="e.g. RM-PVC-K67 or FIN-TARP-01"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div>
              <label className="side-label" style={{ padding: 0, marginBottom: 2 }}>Product / Material Name *</label>
              <input
                className="input"
                placeholder="e.g. PVC Resin K-67 or Tarpaulin 12oz"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="side-label" style={{ padding: 0, marginBottom: 2 }}>Declared HS Code</label>
              <input
                className="input mono"
                placeholder="e.g. 3904.10.00"
                value={hsCode}
                onChange={(e) => setHsCode(e.target.value)}
              />
            </div>
            <div>
              <label className="side-label" style={{ padding: 0, marginBottom: 2 }}>Materials / Chemistry</label>
              <input
                className="input"
                placeholder="e.g. Polyvinyl Chloride (CAS 9002-86-2)"
                value={materials}
                onChange={(e) => setMaterials(e.target.value)}
              />
            </div>
          </div>
          <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button className="btn" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !sku.trim() || !name.trim()} onClick={addSingleProduct}>
              {busy ? "Saving…" : "Save Product"}
            </button>
          </div>
        </section>
      )}

      {/* CSV Bulk Ingest Accordion */}
      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-head">
          <Upload size={15} strokeWidth={1.75} />
          <h2>Bulk CSV Import</h2>
        </div>
        <p className="page-sub" style={{ margin: "4px 0 8px" }}>
          Paste CSV rows with headers: <code className="mono">sku, name, hs_code, materials, unit_price</code>
        </p>
        <textarea
          className="input mono"
          rows={3}
          value={csv}
          placeholder={"sku,name,hs_code,materials\nRM-DOP-01,DOP Plasticizer,2917.34.00,Dioctyl phthalate"}
          onChange={(event) => setCsv(event.target.value)}
        />
        <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" disabled={busy || !csv.trim()} onClick={() => void importCsv()}>
            {busy ? "Importing…" : "Import CSV"}
          </button>
        </div>

        {summary && (
          <div className="import-summary" style={{ marginTop: "0.75rem" }}>
            <div className="meta-row">
              <span className="pill pill-ok">{summary.created} created</span>
              <span className="pill pill-blue">{summary.updated} updated</span>
              <span className="pill pill-muted">{summary.unchanged} unchanged</span>
            </div>
          </div>
        )}
      </section>

      {/* Product List */}
      <div className="side-label">Registered Items ({products.length})</div>
      {loading ? (
        <div className="empty">Loading catalogue…</div>
      ) : products.length === 0 ? (
        <div className="empty">No products in catalogue yet. Add your first item above or chat with the AI Copilot.</div>
      ) : (
        <div className="checklist-grid">
          {products.map((p) => (
            <article key={p.id} className="card">
              <div className="checklist-card-top">
                <div>
                  <span className="mono strong" style={{ color: "var(--accent)" }}>{p.sku}</span>
                  <h3 style={{ margin: "2px 0 4px", fontSize: "1rem" }}>{p.name}</h3>
                </div>
                {p.unitValue !== null && (
                  <span className="pill pill-muted">
                    {p.currency} {p.unitValue.toLocaleString()}
                  </span>
                )}
              </div>

              {p.materials.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}>
                  {p.materials.map((m, idx) => (
                    <span key={idx} className="pill pill-muted" style={{ fontSize: "0.75rem" }}>{m}</span>
                  ))}
                </div>
              )}

              {/* Classifications */}
              <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                <div className="side-label" style={{ padding: 0, marginBottom: 4 }}>Tariff Classifications</div>
                {p.classifications.length === 0 ? (
                  <span className="muted" style={{ fontSize: "0.8rem" }}>No tariff codes attached yet.</span>
                ) : (
                  p.classifications.map((c) => (
                    <div key={c.id} className="meta-row" style={{ marginTop: 2 }}>
                      <span className="mono strong">{c.code}</span>
                      <span className={`pill ${TIER_CLASS[c.tier] ?? "pill-muted"}`}>
                        {TIER_LABEL[c.tier] ?? c.tier}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
