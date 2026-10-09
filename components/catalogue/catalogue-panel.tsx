"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Tag, Search, LayoutGrid, List } from "lucide-react";
import { ChipInput } from "@/components/chip-input";
import type { JurisdictionName } from "@/lib/countries";
// MVP: import { CountryTabs } from "@/components/dashboard/country-tabs";

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
  document: "Document-Verified (PIB/PEB/7501)",
  human: "Human-Confirmed",
  lead: "Lead / Declared",
  guess: "Seed / Guess",
};

export function CataloguePanel({ country }: { country: JurisdictionName }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [csv, setCsv] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick single product form
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [materials, setMaterials] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  // UI/UX friction fix: Escape didn't close the "Add Product" form, unlike
  // the action-modal dialog pattern already used in workqueue-panel.tsx
  // (role="dialog" + Escape-to-close). Users expect Escape to cancel any
  // open inline form, not just true modal dialogs. Mirrors that pattern here.
  //
  // Follow-up fix (same keyboard-nav/focus-trap audit that fixed the
  // jurisdiction picker in chat-panel.tsx): closing via Escape left keyboard
  // focus stranded wherever it happened to be inside the now-hidden form,
  // instead of returning it to the "Add Product" trigger button per the
  // WAI-ARIA APG disclosure pattern (focus must return to the control that
  // opened the region on close). Added a ref on the trigger button and call
  // .focus() on it inside the existing Escape handler.
  const addFormTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!showAddForm) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowAddForm(false);
        addFormTriggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAddForm]);

  const load = useCallback(async () => {
    setLoading(true);
    // Previously this had no error handling: a failed fetch (network error or
    // non-2xx) left the user staring at "No matching items in catalogue" with
    // no way to tell an empty catalogue apart from a broken load — same
    // silent-failure class already fixed in workqueue/checklist/suppliers
    // panels this cycle. Now surfaces a real error banner and keeps loading
    // state accurate even when the request throws.
    setError(null);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load catalogue.");
        return;
      }
      setProducts(data.products ?? []);
    } catch {
      setError("Failed to load catalogue. Check your connection and try again.");
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
      // The import contract accepts one declared HS code, but a list of materials.
      // Quote CSV cells so punctuation in real product names cannot corrupt a row.
      const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
      const csvContent = "sku,name,hs_code,materials\n" + [sku.trim(), name.trim(), hsCode.trim(), materials.join(";")].map(cell).join(",");
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
        setMaterials([]);
        setShowAddForm(false);
        await load();
      }
    } catch {
      setError("Could not save product. Please try again.");
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

  const filteredProducts = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const matchesHts = p.classifications.some((c) => c.code.toLowerCase().includes(q));
    const matchesMaterials = p.materials.some((m) => m.toLowerCase().includes(q));
    return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || matchesHts || matchesMaterials;
  });

  return (
    <div className="main-scroll catalogue-editor">
      <div className="page-head">
        <div>
          <h1>Product Catalogue</h1>
          <p className="page-sub">
            Add the products you make or buy so Cante can match changes to your business.
          </p>
        </div>
        <div className="page-actions">
          <button ref={addFormTriggerRef} aria-expanded={showAddForm} aria-controls="catalogue-add-product" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            <Plus size={14} /> {showAddForm ? "Close Form" : "Add Product"}
          </button>
          {/* MVP: country switching disabled; retained for later. <CountryTabs value={country} /> */}
        </div>
      </div>

      {/* UI/UX friction sweep (a11y): announce load/import failures and the
          loading state to screen readers, matching the role="alert"/
          role="status" pattern from app/import-monitor/panel.tsx (and now
          workqueue-panel.tsx / checklist-panel.tsx in this same sweep). */}
      {error && <div className="pill pill-bad" role="alert" style={{ marginBottom: "1rem" }}>{error}</div>}

      {/* Quick Add Modal/Form */}
      {showAddForm && (
        <section id="catalogue-add-product" className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-head">
            <Tag size={16} />
            <h2>Add product</h2>
          </div>
          <p className="muted" role="status">{[sku.trim(), name.trim()].filter(Boolean).length} of 2 required fields complete. Examples are not saved data.</p>
          <div className="catalogue-add-fields">
            <div>
              <label htmlFor="product-sku" className="side-label" style={{ padding: 0, marginBottom: 2 }}>SKU / Material Code *</label>
              <input
                className="input mono"
                placeholder="e.g. RM-PVC-K67 or FIN-TARP-01"
                id="product-sku" required value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="product-name" className="side-label" style={{ padding: 0, marginBottom: 2 }}>Product / Material Name *</label>
              <input
                className="input"
                placeholder="e.g. PVC Resin K-67 or Tarpaulin 12oz"
                id="product-name" required value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="product-hs" className="side-label" style={{ padding: 0, marginBottom: 2 }}>Declared HS Code (optional)</label>
              <input
                className="input mono"
                placeholder="e.g. 3904.10.00"
                id="product-hs" value={hsCode}
                onChange={(e) => setHsCode(e.target.value)}
              />
            </div>
            <ChipInput label="Materials / chemical composition (optional)" values={materials}
              onChange={setMaterials} placeholder="PVC resin" disabled={busy} />
          </div>
          <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button className="btn" onClick={() => { setShowAddForm(false); addFormTriggerRef.current?.focus(); }}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !sku.trim() || !name.trim()} onClick={addSingleProduct}>
              {busy ? "Saving…" : "Save Product"}
            </button>
          </div>
        </section>
      )}

      {/* Search & Bulk CSV Row */}
      <div className="catalogue-tools">
        <section className="card">
          <div className="card-head">
            <Search size={15} strokeWidth={1.75} />
            <h2>Search Catalogue</h2>
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <input
              className="input"
              aria-label="Search catalogue" placeholder="Search by SKU, item name, HS code, or chemical ingredient…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </section>

        {/* Bulk import is a secondary path; keep it out of first-product setup. */}
        <details className="card profile-disclosure" open>
          <summary>Upload product CSV</summary>
          <p className="muted">Start with SKU and name. Add your reviewed HTS code if you have it.</p>
          <input className="input" aria-label="Product CSV file" type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { setError("Product CSV exceeds 2 MiB."); return; }
            try { setCsv(await file.text()); } catch { setError("Could not read the product CSV. Please try again."); }
          }} />
          <p><a href="/examples/products-template.csv" download>Download blank template</a> · <a href="/tariff">Continue to imports →</a></p>
          <label htmlFor="catalogue-csv" className="muted">Paste a header row and product rows. Separate materials with semicolons.</label>
          <textarea id="catalogue-csv" className="input mono" rows={4} placeholder={'e.g. sku,name,hs_code,materials\nTARP-01,Tarpaulin,,PVC;Polyester'}
            value={csv} onChange={(e) => setCsv(e.target.value)} />
          <button className="btn" disabled={busy || !csv.trim()} onClick={() => void importCsv()}>{busy ? "Importing…" : "Import products"}</button>
        </details>
      </div>

      {summary && (
        <div className="import-summary" style={{ marginBottom: "1rem" }}>
          <div className="meta-row">
            <span className="pill pill-ok">{summary.created} created</span>
            <span className="pill pill-blue">{summary.updated} updated</span>
            <span className="pill pill-muted">{summary.unchanged} unchanged</span>
          </div>
        </div>
      )}

      {/* Product Grid */}
      <div className="meta-row" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <div className="side-label" style={{ padding: 0 }}>Registered Items ({filteredProducts.length})</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={"btn btn-small " + (viewMode === "grid" ? "btn-primary" : "")} aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}>
            <LayoutGrid size={13} />
          </button>
          <button className={"btn btn-small " + (viewMode === "table" ? "btn-primary" : "")} aria-label="Table view" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")}>
            <List size={13} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty" role="status">Loading catalogue…</div>
      ) : filteredProducts.length === 0 ? (
        <div className="empty">{products.length ? "No products match your search." : "No products yet. Add your first product to get started."}</div>
      ) : viewMode === "table" ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "var(--app-surface-active)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>SKU</th>
                <th style={{ padding: "8px 12px" }}>Name</th>
                <th style={{ padding: "8px 12px" }}>Tariff HS Codes</th>
                <th style={{ padding: "8px 12px" }}>Materials</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--accent-primary, #0284c7)" }}>{p.sku}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 500 }}>{p.name}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {p.classifications.map((c) => (
                      <span key={c.id} className={"pill " + (TIER_CLASS[c.tier] ?? "pill-muted")} style={{ marginRight: 4 }}>
                        {c.code}
                      </span>
                    ))}
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--text-secondary)" }}>{p.materials.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="checklist-grid">
          {filteredProducts.map((p) => (
            <article key={p.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div className="checklist-card-top">
                <div>
                  <span className="mono strong" style={{ color: "var(--accent-primary, #0284c7)" }}>{p.sku}</span>
                  <h3 style={{ margin: "2px 0 4px", fontSize: "1rem" }}>{p.name}</h3>
                </div>
                {p.unitValue !== null && (
                  <span className="pill pill-muted">
                    {p.currency} {p.unitValue.toLocaleString()}
                  </span>
                )}
              </div>

              {p.materials.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0" }}>
                  {p.materials.map((m, idx) => (
                    <span key={idx} className="pill pill-muted" style={{ fontSize: "0.75rem" }}>{m}</span>
                  ))}
                </div>
              )}

              {/* Classifications */}
              <div style={{ marginTop: "auto", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                <div className="side-label" style={{ padding: 0, marginBottom: 4 }}>Tariff Classifications</div>
                {p.classifications.length === 0 ? (
                  <span className="muted" style={{ fontSize: "0.8rem" }}>No tariff codes attached yet.</span>
                ) : (
                  p.classifications.map((c) => (
                    <div key={c.id} className="meta-row" style={{ marginTop: 2, justifyContent: "space-between" }}>
                      <span className="mono strong">{c.code}</span>
                      <span className={"pill " + (TIER_CLASS[c.tier] ?? "pill-muted")}>
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
