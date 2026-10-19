"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowRight, FileText, FlaskConical, MessageSquare, UploadCloud } from "lucide-react";
import { calculateDemo, DEMO_COMPANY, DEMO_LABEL, DEMO_MAX_BYTES, DEMO_QUESTION, DEMO_REGULATIONS, DEMO_STORAGE_KEY, demoMoney, demoReport, demoResultCsv, parseDemoCatalogue, type DemoInput, type DemoResult } from "./demo-scenario";

function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TariffDemoPanel() {
  const router = useRouter(); const cataloguePicker = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState<DemoInput>({ catalogueCsv: "", historyCsv: "", regulationId: DEMO_REGULATIONS[0].id });
  const [count, setCount] = useState(0); const [filename, setFilename] = useState("");
  const [result, setResult] = useState<DemoResult | null>(null); const [reportOpen, setReportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false); const [dragging, setDragging] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DEMO_STORAGE_KEY);
      if (!saved) return;
      const scenario = JSON.parse(saved) as DemoInput;
      const calculated = calculateDemo(scenario);
      setInput(scenario); setCount(calculated.productCount); setFilename("Restored fictional scenario"); setResult(calculated);
    } catch { /* A missing or invalid browser snapshot does not become a result. */ }
  }, []);
  const regulation = DEMO_REGULATIONS.find(r => r.id === input.regulationId)!;
  function invalidate() { setResult(null); setReportOpen(false); setError(null); }
  function acceptCatalogue(text: string, name: string, history = "") {
    invalidate(); setCount(0); setFilename(name); setInput(i => ({ ...i, catalogueCsv: text, historyCsv: history }));
    try { setCount(parseDemoCatalogue(text).length); } catch (e) { setError((e as Error).message); }
  }
  async function upload(file?: File) {
    if (!file) return;
    // Invalidate synchronously, before File.text() resolves, so a replacement
    // file can never leave the previous calculation actionable while reading.
    invalidate(); setCount(0); setFilename(file.name);
    setInput(i => ({ ...i, catalogueCsv: "", historyCsv: "" }));
    if (file.size > DEMO_MAX_BYTES) { invalidate(); setCount(0); setInput(i => ({ ...i, catalogueCsv: "", historyCsv: "" })); setError("Use a CSV smaller than 1 MB."); return; }
    try { acceptCatalogue(await file.text(), file.name); } catch { setError("Could not read this file."); }
  }
  async function loadExample() {
    invalidate(); setLoading(true);
    try {
      const files = await Promise.all(["products.csv", "imports.csv"].map(async name => {
        const response = await fetch(`/examples/equipment-demo/${name}`);
        if (!response.ok) throw new Error(`Could not load ${name}.`);
        return response.text();
      }));
      acceptCatalogue(files[0], "products.csv · fictional example", files[1]);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  function calculate() {
    invalidate();
    try { setResult(calculateDemo(input)); } catch (e) { setError((e as Error).message); }
  }
  function ask() {
    if (!result) return;
    try { sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(input)); router.push("/chat?demo=equipment"); }
    catch { setError("Browser storage is unavailable. Enable session storage to ask about this scenario in chat."); }
  }
  return <div className="main-scroll equipment-demo">
    <header className="demo-header"><div><Link href="/tariff" className="demo-back">← Your dashboard</Link><div className="demo-eyebrow"><FlaskConical size={14} /> FICTIONAL WORKFLOW DEMO</div><h1>What if this tariff hits?</h1><p>{DEMO_COMPANY}. One portfolio. One decision to understand.</p></div><span className="demo-isolated">Separate from your real catalogue</span></header>
    <div className="demo-disclosure"><strong>Simulation, not a government notice.</strong> Every product, price, volume, shipment and duty baseline is fictional. HTS assignments are illustrative. Nothing here establishes actual tariff liability.</div>
    <div className="demo-workbench">
      <section className="demo-input-panel" aria-label="Scenario inputs">
        <div className="demo-section-label"><span>01</span><h2>Bring the products</h2></div>
        <div className={`demo-drop${dragging ? " is-dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files[0]); }}>
          <UploadCloud size={26} strokeWidth={1.4} /><strong>{count ? `${count} products ready` : "Drop your demo CSV here"}</strong><span>{filename || "HTS · origin · unit customs value · annual units"}</span>
          <button className="btn" type="button" onClick={() => cataloguePicker.current?.click()}>Upload product CSV</button><input ref={cataloguePicker} className="demo-file-input" type="file" accept=".csv,text/csv" aria-label="Product CSV" onChange={e => { void upload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        </div>
        <button type="button" className="demo-load" disabled={loading} onClick={() => void loadExample()}>{loading ? "Loading…" : "Use the 50-product example"}<ArrowRight size={15} /></button>
        <div className="demo-downloads"><a href="/examples/equipment-demo/products.csv" download>Product CSV ↓</a><a href="/examples/equipment-demo/imports.csv" download>Import history ↓</a></div>
        <details className="demo-history-input"><summary>{input.historyCsv ? "Import history attached · replace or remove" : "Add fictional import history (optional)"}</summary><p>Historical payments stay unchanged. Annual impact uses the catalogue’s planned annual units.</p><label>Import-history CSV<input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.currentTarget.files?.[0]; invalidate(); if (!file) return; if (file.size > DEMO_MAX_BYTES) { setError("History CSV must be under 1 MB."); return; } try { const text = await file.text(); setInput(i => ({ ...i, historyCsv: text })); } catch { setError("Could not read import history."); } }} /></label>{input.historyCsv && <button type="button" className="demo-text-button" onClick={() => { invalidate(); setInput(i => ({ ...i, historyCsv: "" })); }}>Remove history</button>}</details>
        <div className="demo-section-label demo-second"><span>02</span><h2>Choose the change</h2></div>
        <label className="demo-select-label" htmlFor="demo-regulation">Simulated regulation</label><select id="demo-regulation" value={input.regulationId} onChange={e => { invalidate(); setInput(i => ({ ...i, regulationId: e.target.value })); }}>{DEMO_REGULATIONS.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
        <p className="demo-rule-description">{regulation.description}</p><div className="demo-rule-scope"><span>Origins <b>{regulation.origins.join(" / ")}</b></span><span>HTS prefixes <b>{regulation.htsPrefixes.join(", ")}</b></span></div>
        <button className="demo-calculate" disabled={!count || loading} onClick={calculate}>Calculate impact <ArrowRight size={17} /></button>
        {error && <p className="demo-error" role="alert">{error}</p>}
      </section>
      <section className="demo-output" aria-label="Calculated impact" aria-live="polite">
        {!result ? <div className="demo-output-empty"><div className="demo-empty-visual"><span /><span /><span /><span /><span /></div><h2>See the cost before it lands.</h2><p>Upload the example, choose a simulated change, then calculate.</p><small>Integer-cent arithmetic. Exact origin + HTS-prefix matching. No AI maths.</small></div> : <>
          <div className="demo-result-label">NEXT 12 MONTHS · VOLUMES HELD CONSTANT</div><h2 className="demo-big-number">{demoMoney(result.totalExtraCents)}</h2><p className="demo-number-caption">extra annual duty under this fictional change</p>
          <div className="demo-metrics"><div><strong>{result.affectedCount}<small> / {result.productCount}</small></strong><span>products affected</span></div><div><strong>{demoMoney(result.affectedValueCents)}</strong><span>affected annual customs value</span></div><div><strong>{demoMoney(result.monthlyEquivalentCents)}</strong><span>monthly equivalent · annual ÷ 12</span></div></div>
          <div className="demo-before-after"><div><span>Annual duty before</span><b>{demoMoney(result.beforeCents)}</b></div><ArrowRight size={18} /><div><span>Annual duty after</span><b>{demoMoney(result.afterCents)}</b></div></div>
          <div className="demo-top-heading"><h3>Top 5 hit SKUs</h3><span>Ranked by extra annual duty</span></div>
          {result.topFive.length ? <ol className="demo-top-list">{result.topFive.map((r, i) => <li key={r.sku}><span className="demo-rank">{i + 1}</span><div><strong>{r.sku}</strong><span>{r.name}</span><div className="demo-impact-bar"><span style={{ width: `${Math.max(1, r.extraCents / result.topFive[0].extraCents * 100)}%` }} /></div></div><b>{demoMoney(r.extraCents)}</b></li>)}</ol> : <p className="demo-control-note">No products have added duty in this control scenario.</p>}
          <div className="demo-result-actions"><button className="btn" onClick={() => setReportOpen(true)}><FileText size={16} />Generate report</button><button className="demo-chat-button" onClick={ask}><MessageSquare size={16} />Ask Cante about this<ArrowRight size={15} /></button></div><p className="demo-ask-preview">“{DEMO_QUESTION}”</p>
        </>}
      </section>
    </div>
    {result && <>
      {reportOpen && <section className="demo-report" aria-label="Generated scenario report"><div className="demo-report-head"><div><span className="demo-eyebrow">03 · REPORT READY</span><h2>Your scenario, explained.</h2></div><div className="demo-report-downloads"><button className="btn" onClick={() => download("fictional-tariff-impact.md", demoReport(result), "text/markdown;charset=utf-8")}><ArrowDownToLine size={15} />Report</button><button className="btn" onClick={() => download("fictional-tariff-impact.csv", demoResultCsv(result), "text/csv;charset=utf-8")}>All SKU calculations ↓</button></div></div><p><strong>{result.affectedCount} of {result.productCount} products</strong> would add <strong>{demoMoney(result.totalExtraCents)} a year</strong> if this simulated tariff applied to the next year of planned imports.</p><p className="demo-formula">Annual customs value = unit customs value × planned units<br />Extra annual duty = rounded duty after − rounded duty before</p><ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul><p className="demo-report-stamp">{DEMO_LABEL} · {result.regulation.id}</p></section>}
      <section className="demo-detail"><div className="demo-top-heading"><h2>Product-by-product impact</h2><button className="demo-text-button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 10" : `Show all ${result.rows.length}`}</button></div><div className="demo-table-scroll"><table><thead><tr><th>SKU / Product</th><th>HTS / Origin</th><th>Annual units</th><th>Annual value</th><th>Rate before → after</th><th>Extra annual duty</th></tr></thead><tbody>{[...result.rows].sort((a, b) => b.extraCents - a.extraCents || a.sku.localeCompare(b.sku)).slice(0, showAll ? undefined : 10).map(r => <tr key={r.sku}><td><strong>{r.sku}</strong><small>{r.name}</small></td><td>{r.hts}<small>{r.origin} · {r.affected ? "Affected" : "No added duty"}</small></td><td>{r.annualUnits.toLocaleString("en-US")}</td><td>{demoMoney(r.annualValueCents)}</td><td>{r.baselineBps / 100}% → {(r.baselineBps + r.addedBps) / 100}%</td><td className={r.affected ? "demo-hit" : ""}>{demoMoney(r.extraCents)}</td></tr>)}</tbody></table></div></section>
      <details className="demo-ledger"><summary>Fictional import ledger · {result.history.rowCount} entry lines · kept separate from forecast</summary><p>{result.history.startDate ?? "No history attached"}{result.history.endDate ? ` to ${result.history.endDate}` : ""} · {demoMoney(result.history.customsValueCents)} customs value · {demoMoney(result.history.paidDutyCents)} duty already paid.</p><p>These past payments do not change when you select a new regulation. Download the history CSV for every entry line.</p><div className="demo-table-scroll"><table><thead><tr><th>Entry / line</th><th>Date</th><th>SKU</th><th>Quantity</th><th>Customs value</th><th>Paid duty</th></tr></thead><tbody>{result.history.rows.slice(0, 12).map(r => <tr key={`${r.entryId}-${r.line}`}><td>{r.entryId} / {r.line}</td><td>{r.date}</td><td>{r.sku}</td><td>{r.units}</td><td>{demoMoney(r.customsValueCents)}</td><td>{demoMoney(r.paidDutyCents)}</td></tr>)}</tbody></table></div>{result.history.rowCount > 12 && <p>Showing the first 12 entry lines of {result.history.rowCount}.</p>}</details>
    </>}
    <footer className="demo-footnote">Fictional data stays in this browser until you ask chat. Demo chat uses the calculated scenario and does not import it into your workspace or save company memories. <a href="/examples/equipment-demo/README.md">Data & methodology</a></footer>
  </div>;
}
