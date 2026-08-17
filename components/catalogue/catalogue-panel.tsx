"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Check, Upload, X } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

/**
 * Catalogue and classification workspace — items 2 and 6.
 *
 * The tier badge on every code is the point of this screen. A code with no
 * badge would let a CSV guess and a PEB-verified classification look identical,
 * which is the confusion lib/checks/facts.ts exists to prevent.
 */

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
  document: "document-verified",
  human: "human-confirmed",
  lead: "unconfirmed lead",
  guess: "seed guess",
};

export function CataloguePanel({ country }: { country: JurisdictionName }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [csv, setCsv] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/products");
    const data = await res.json();
    setProducts(data.products ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function suggest(product: Product) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/classifications/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: product.sku, productId: product.id }),
      });
      const data = await res.json();
      // A refusal is a real answer here — retrieval missed the heading, or the
      // model declined. Show it as information, not as a failure to retry.
      if (!res.ok) setError(data.error ?? "Suggestion failed.");
      else await load();
    } finally {
      setBusy(false);
    }
  }

  async function adopt(classificationId: string) {
    const adoptedBy = window.prompt("Who is adopting this model suggestion?");
    if (!adoptedBy) return;
    const reason = window.prompt(
      "Why do you stand behind it? (recorded — you are taking responsibility for a model's suggestion)",
    );
    if (!reason) return;

    const res = await fetch("/api/classifications/suggest", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classificationId, adoptedBy, reason }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Could not adopt.");
    else await load();
  }

  async function approve(classificationId: string) {
    const approvedBy = window.prompt("Who is approving this classification?");
    if (!approvedBy) return;
    const rationale = window.prompt("Why is this code correct? (recorded with the approval)");
    if (!rationale) return;

    const res = await fetch("/api/classifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classificationId, approvedBy, rationale }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Approval failed.");
    else await load();
  }

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Catalogue</h1>
          <p className="page-sub">
            Products, their classifications, and where each code came from. Only a code read off a
            real export document counts as verified.
          </p>
        </div>
        <CountryTabs value={country} />
      </div>

      <section className="card">
        <div className="card-head">
          <Upload size={15} strokeWidth={1.75} />
          <h2>Import CSV</h2>
        </div>
        <p className="page-sub">
          Accepted headers: sku, name, description, materials, origin, uom, unit_price, currency,
          hs_code, hts, schedule_b, kbli, eccn. Codes in a spreadsheet are filed as unconfirmed
          leads.
        </p>
        <textarea
          className="input mono"
          rows={5}
          value={csv}
          placeholder={"sku,name,hs_code\nPVC-100,Blue tarpaulin 12oz,6306.12.00"}
          onChange={(event) => setCsv(event.target.value)}
        />
        <div className="page-actions">
          <button className="btn" disabled={busy || !csv.trim()} onClick={() => void importCsv()}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>

        {error && <div className="pill pill-bad">{error}</div>}

        {summary && (
          <div className="import-summary">
            <div className="meta-row">
              <span className="pill pill-ok">{summary.created} created</span>
              <span className="pill pill-blue">{summary.updated} updated</span>
              <span className="pill pill-muted">{summary.unchanged} unchanged</span>
              {summary.rejected > 0 && (
                <span className="pill pill-bad">{summary.rejected} rejected</span>
              )}
            </div>
            {summary.rows
              .filter((row) => row.outcome === "rejected")
              .map((row) => (
                <div key={row.line} className="import-row">
                  Line {row.line}
                  {row.sku ? ` (${row.sku})` : ""}: {row.reason}
                </div>
              ))}
            {summary.caveats.map((caveat) => (
              <div key={caveat} className="import-row muted">
                {caveat}
              </div>
            ))}
          </div>
        )}
      </section>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : products.length === 0 ? (
        <div className="empty">
          <Boxes size={20} strokeWidth={1.5} />
          <p>
            No products yet. Until the catalogue has SKUs, a regulation cannot be matched to
            anything — alerts will say so rather than implying nothing is affected.
          </p>
        </div>
      ) : (
        <div className="checklist-grid">
          {products.map((product) => (
            <article key={product.id} className="card">
              <div className="checklist-card-top">
                <div>
                  <div className="mono strong">{product.sku}</div>
                  <div className="checklist-summary">{product.name}</div>
                </div>
                <div className="meta-row">
                  {product.originCountry && (
                    <span className="pill pill-muted">{product.originCountry}</span>
                  )}
                  <button
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => void suggest(product)}
                  >
                    Suggest code
                  </button>
                </div>
              </div>

              {product.materials.length > 0 && (
                <div className="checklist-meta-row">
                  {product.materials.map((material) => (
                    <span key={material} className="pill pill-muted">
                      {material}
                    </span>
                  ))}
                </div>
              )}

              <div className="checklist-block">
                <div className="side-label">Classifications</div>
                {product.classifications.length === 0 ? (
                  <div className="muted">No code on record.</div>
                ) : (
                  product.classifications.map((classification) => (
                    <div key={classification.id} className="code-row">
                      <span className="mono strong">{classification.code}</span>
                      <span className="pill pill-muted">{classification.system}</span>
                      <span className={`pill ${TIER_CLASS[classification.tier] ?? "pill-muted"}`}>
                        {TIER_LABEL[classification.tier] ?? classification.tier}
                      </span>
                      {classification.status === "approved" ? (
                        <span className="pill pill-ok">
                          <Check size={12} /> approved by {classification.approvedBy}
                        </span>
                      ) : classification.tier === "lead" &&
                        classification.basis.startsWith("Model suggestion") ? (
                        // A model suggestion cannot be approved. It must first be
                        // adopted by a named person, which is what makes it theirs.
                        <button
                          className="btn btn-small"
                          onClick={() => void adopt(classification.id)}
                        >
                          Adopt suggestion
                        </button>
                      ) : (
                        <button
                          className="btn btn-small"
                          onClick={() => void approve(classification.id)}
                        >
                          Approve
                        </button>
                      )}
                      <div className="code-basis">{classification.basis}</div>
                      {classification.rationale && (
                        <div className="code-basis">Rationale: {classification.rationale}</div>
                      )}
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
