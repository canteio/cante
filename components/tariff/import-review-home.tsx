"use client";

import { useState } from "react";
import Link from "next/link";
import { ProductSetup, type SelectedProduct } from "@/components/tariff/product-setup";
import { TariffStackPanel } from "@/components/tariff/tariff-stack-panel";
import { TariffUpdates } from "@/components/tariff/tariff-updates";

export function ImportReviewHome({ canReviewRules = false }: { canReviewRules?: boolean }) {
  const [selected, setSelected] = useState<SelectedProduct | null>(null);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  return <div className="main-scroll tariff-dashboard">
    <div className="page-head"><div><h1>Your trade dashboard</h1><p className="page-sub">Upload products once. Check for changes.</p></div>{canReviewRules && <Link className="tariff-text-button" href="/tariff/rules">Rule reviews</Link>}</div>
    <nav className="tariff-workflow" aria-label="Dashboard sections"><a href="#products">1 <span>Your products</span></a><a href="#updates">2 <span>Check for changes</span></a></nav>
    <div id="updates"><TariffUpdates /></div>
    <ProductSetup onDelete={id => setSelected(current => current?.id === id ? null : current)} onSelect={product => { setSelected({ ...product }); setCalculatorOpen(true); requestAnimationFrame(() => document.getElementById("duties")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} />
    <details id="duties" className="tariff-optional-calculator" open={calculatorOpen} onToggle={event => setCalculatorOpen(event.currentTarget.open)}><summary>Optional: calculate duties</summary><TariffStackPanel embedded selectedProduct={selected} /></details>
    <div className="tariff-history-link"><span>Check your CSV against freshly fetched official rates.</span><Link href="/tariff/demo">Run a live data check →</Link></div>
    <footer className="tariff-history-link"><span>Already imported? Check what you paid.</span><Link href="/tariff/audits">Historical audits →</Link></footer>
  </div>;
}
