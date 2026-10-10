"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Tag, Search, LayoutGrid, List, Upload, Download, Sparkles, ArrowRight, FileSpreadsheet, CheckCircle2, X } from "lucide-react";
import { ChipInput } from "@/components/chip-input";
import type { JurisdictionName } from "@/lib/countries";

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick single product form
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [materials, setMaterials] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

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

  async function importCsv(contentToImport?: string) {
    const toImport = contentToImport ?? csv;
    if (!toImport.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: toImport }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Import failed.");
      else {
        setSummary(data.summary);
        setCsv("");
        setSelectedFile(null);
        setShowUploadModal(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleFileChosen(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError("Product CSV exceeds 2 MiB.");
      return;
    }
    setSelectedFile(file);
    try {
      const text = await file.text();
      setCsv(text);
    } catch {
      setError("Could not read file. Please retry.");
    }
  }

  async function loadDemoProducts() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/examples/lulzbot-public-products.csv");
      if (!res.ok) throw new Error("Could not fetch demo product dataset.");
      const demoCsv = await res.text();
      await importCsv(demoCsv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load demo products.");
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
      {/* Visual Workflow Journey Stepper */}
      <nav className="workflow-stepper" aria-label="Compliance workflow steps">
        <div className="workflow-step active">
          <span className="workflow-step-num">1</span>
          <div className="workflow-step-info">
            <span className="workflow-step-title">Product Catalogue</span>
            <span className="workflow-step-desc">SKUs, Names &amp; HTS codes</span>
          </div>
        </div>
        <div className="workflow-step-divider" />
        <a href="/tariff" className="workflow-step">
          <span className="workflow-step-num">2</span>
          <div className="workflow-step-info">
            <span className="workflow-step-title">Import History</span>
            <span className="workflow-step-desc">Upload broker entries</span>
          </div>
        </a>
        <div className="workflow-step-divider" />
        <a href="/tariff" className="workflow-step">
          <span className="workflow-step-num">3</span>
          <div className="workflow-step-info">
            <span className="workflow-step-title">Duty Audit &amp; Savings</span>
            <span className="workflow-step-desc">Overpayments &amp; tariff changes</span>
          </div>
        </a>
      </nav>

      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1>Product Catalogue</h1>
          <p className="page-sub">
            Add your company&apos;s product catalogue so Cante can cross-reference import duties and flag regulatory tariff changes.
          </p>
        </div>
      </div>

      {error && <div className="pill pill-bad" role="alert" style={{ marginBottom: "1rem", whiteSpace: "normal" }}>{error}</div>}

      {/* Hero Action Cards / Big Buttons */}
      <div className="card" style={{ marginBottom: "1.5rem", padding: "20px 22px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 4px" }}>Manage Products</h2>
            <p className="muted" style={{ margin: 0 }}>Add products via CSV spreadsheet or enter items one by one.</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              className="btn btn-lg btn-primary-gradient"
              onClick={() => { setShowUploadModal((v) => !v); setShowAddForm(false); }}
            >
              <Upload size={16} /> Upload Products CSV
            </button>
            <button
              ref={addFormTriggerRef}
              className="btn btn-lg"
              onClick={() => { setShowAddForm((v) => !v); setShowUploadModal(false); }}
            >
              <Plus size={16} /> Add Single Product
            </button>
            <a href="/examples/products-template.csv" download className="btn btn-lg" style={{ color: "var(--text)" }}>
              <Download size={16} /> Download Template
            </a>
            {products.length === 0 && (
              <button className="btn btn-lg" disabled={busy} onClick={() => void loadDemoProducts()} title="Load sample 3D printer parts to test the system instantly">
                <Sparkles size={16} color="var(--blue)" /> Load Sample Products
              </button>
            )}
          </div>
        </div>

        {/* Upload Modal / Dropzone Panel */}
        {showUploadModal && (
          <div style={{ background: "var(--app-background)", borderRadius: "var(--radius-lg)", padding: "18px", border: "1px solid var(--border)", marginTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <strong style={{ fontSize: "0.95rem" }}>Upload Product Spreadsheet</strong>
              <button className="btn btn-small" onClick={() => setShowUploadModal(false)}><X size={14} /></button>
            </div>
            
            <div
              className={`upload-dropzone ${dragOver ? "dragover" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFileChosen(file);
              }}
              onClick={() => document.getElementById("catalogue-file-input")?.click()}
            >
              <input
                id="catalogue-file-input"
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileChosen(file);
                }}
              />
              <div className="upload-icon-circle">
                <FileSpreadsheet size={26} />
              </div>
              {selectedFile ? (
                <>
                  <h3 style={{ color: "var(--blue)" }}>{selectedFile.name}</h3>
                  <p className="muted">{(selectedFile.size / 1024).toFixed(1)} KB · Ready to import</p>
                </>
              ) : (
                <>
                  <h3>Drag &amp; drop your Product CSV here</h3>
                  <p>Or click to browse from your computer (columns: sku, name, hts, materials)</p>
                </>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", flexWrap: "wrap", gap: "8px" }}>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                Need the right format? <a href="/examples/products-template.csv" download>Download the sample blank CSV</a>
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn" onClick={() => { setSelectedFile(null); setCsv(""); setShowUploadModal(false); }}>Cancel</button>
                <button className="btn btn-primary-gradient" disabled={busy || !csv.trim()} onClick={() => void importCsv()}>
                  {busy ? "Importing…" : "Confirm & Import Products"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick Add Single Product Form */}
        {showAddForm && (
          <section id="catalogue-add-product" style={{ background: "var(--app-background)", borderRadius: "var(--radius-lg)", padding: "18px", border: "1px solid var(--border)", marginTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Tag size={16} />
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Add Single Product</h3>
              </div>
              <button className="btn btn-small" onClick={() => setShowAddForm(false)}><X size={14} /></button>
            </div>
            <div className="catalogue-add-fields">
              <div>
                <label htmlFor="product-sku" className="side-label" style={{ padding: 0, marginBottom: 4, fontWeight: 600 }}>SKU / Part Number *</label>
                <input
                  className="input mono"
                  placeholder="e.g. DEMO-PLA-285"
                  id="product-sku" required value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="product-name" className="side-label" style={{ padding: 0, marginBottom: 4, fontWeight: 600 }}>Product Name / Description *</label>
                <input
                  className="input"
                  placeholder="e.g. PLA 3D Printer Filament 2.85mm"
                  id="product-name" required value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="product-hs" className="side-label" style={{ padding: 0, marginBottom: 4 }}>Declared HTS Code (optional)</label>
                <input
                  className="input mono"
                  placeholder="e.g. 3916.90.30.00"
                  id="product-hs" value={hsCode}
                  onChange={(e) => setHsCode(e.target.value)}
                />
              </div>
              <ChipInput label="Materials / Chemical components (optional)" values={materials}
                onChange={setMaterials} placeholder="PLA plastic; pigments" disabled={busy} />
            </div>
            <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button className="btn" onClick={() => { setShowAddForm(false); addFormTriggerRef.current?.focus(); }}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !sku.trim() || !name.trim()} onClick={addSingleProduct}>
                {busy ? "Saving…" : "Save Product"}
              </button>
            </div>
          </section>
        )}
      </div>

      {summary && (
        <div className="card" style={{ marginBottom: "1rem", background: "rgba(var(--azure), 0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <CheckCircle2 size={16} color="var(--ok)" />
            <strong>CSV Import Complete</strong>
          </div>
          <div className="meta-row">
            <span className="pill pill-ok">{summary.created} added</span>
            <span className="pill pill-blue">{summary.updated} updated</span>
            <span className="pill pill-muted">{summary.unchanged} unchanged</span>
            {summary.rejected > 0 && <span className="pill pill-bad">{summary.rejected} rejected</span>}
          </div>
          <div style={{ marginTop: "8px" }}>
            <a href="/tariff" className="btn btn-small btn-primary">
              Continue to Imports tab to audit duties <ArrowRight size={13} />
            </a>
          </div>
        </div>
      )}

      {/* Search Bar & View Mode Toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 300px" }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
          <input
            className="input"
            style={{ paddingLeft: "32px", width: "100%" }}
            aria-label="Search catalogue"
            placeholder="Search by SKU, product name, HTS code, or material…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="pill pill-muted">{filteredProducts.length} Products</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button className={"btn btn-small " + (viewMode === "grid" ? "btn-primary" : "")} aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}>
              <LayoutGrid size={13} />
            </button>
            <button className={"btn btn-small " + (viewMode === "table" ? "btn-primary" : "")} aria-label="Table view" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")}>
              <List size={13} />
            </button>
          </div>
        </div>
      </div>

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
