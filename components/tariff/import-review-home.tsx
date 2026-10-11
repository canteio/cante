"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Boxes } from "lucide-react";
import { CataloguePanel } from "@/components/catalogue/catalogue-panel";
import { BusinessImpactPanel } from "@/components/tariff/business-impact-panel";

/**
 * One page, not two tabs. Products and Imports & results used to be
 * separate sidebar items; a manufacturer's actual job is sequential (add
 * what you make, then check what you paid), not a choice between two
 * unlabeled nouns. Step 1 collapses to a one-line summary the moment a
 * product exists, so a returning user lands straight on real results —
 * the thing they actually came back for — instead of an empty form.
 */
export function ImportReviewHome() {
  const [productCount, setProductCount] = useState<number | null>(null);
  const [stepOpen, setStepOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/products", { cache: "no-store" })
      .then(res => res.ok ? res.json() : { products: [] })
      .then((data: { products?: unknown[] }) => {
        if (cancelled) return;
        const count = data.products?.length ?? 0;
        setProductCount(count);
        setStepOpen(count === 0);
      })
      .catch(() => { if (!cancelled) setProductCount(0); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Imports &amp; results</h1>
          <p className="page-sub">Check duties paid. See what needs attention.</p>
        </div>
      </div>

      <section className="card step-one-card" style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          className="step-one-toggle"
          aria-expanded={stepOpen}
          onClick={() => setStepOpen(v => !v)}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Boxes size={16} />
            <strong>Step 1 · Your products</strong>
            <span className="muted">
              {productCount === null ? "Loading…" : productCount === 0 ? "None yet — add some below" : `${productCount} product${productCount === 1 ? "" : "s"}`}
            </span>
          </span>
          {stepOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {stepOpen && (
          <div style={{ marginTop: 14 }}>
            <CataloguePanel country="United States" compact />
          </div>
        )}
      </section>

      <BusinessImpactPanel />
    </div>
  );
}
