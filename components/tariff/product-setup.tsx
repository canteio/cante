"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Upload, Trash2 } from "lucide-react";
import { normalizeCountryCode } from "@/lib/tariff/bulk";
import { easternIsoDate } from "@/lib/tariff/date";
import type { StackedDutyResult } from "@/lib/tariff/stack";

export type SelectedProduct = { id: string; name: string; htsCode: string; countryOfOrigin: string; importDate: string; dutyResult?: StackedDutyResult; editShipment?: boolean; codeConfirmed?: boolean };
type Product = { id: string; sku: string; name: string; originCountry: string | null; unitValue: number | null; currency: string; description?: string | null; materials?: string[]; unitOfMeasure?: string | null; productClass?: string | null; notes?: string | null; classifications: { system: string; code: string; status: string; tier: string }[] };
type Summary = { created: number; updated: number; unchanged: number; rejected: number; caveats: string[]; rows: { line: number; sku: string; outcome: string; reason?: string }[] };
type Check = { status: "checking" } | { status: "done"; result: StackedDutyResult } | { status: "error"; message: string };
const blank = { sku: "", name: "", hts: "", origin: "", price: "", currency: "USD" };
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
function priceFor(product: Product) {
  if (product.unitValue === null) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency || "USD" }).format(product.unitValue); }
  catch { return `${product.unitValue} ${product.currency}`; }
}
function codesFor(product: Product) {
  return [...new Set(product.classifications.filter(c => c.system === "hts" && c.status !== "rejected").map(c => c.code.trim()))];
}
function codeFor(product: Product) {
  const codes = [...new Set(codesFor(product).map(c => /^[\d.\s]+$/.test(c) ? c.replace(/\D/g, "") : c))];
  return codes.length === 1 && /^\d{10}$/.test(codes[0]) ? codes[0] : null;
}
export function adviceFor(result: StackedDutyResult) {
  if (result.unresolvedMeasures.some(m => /could not be checked|coverage|no supported|not held|no confirmed rule/i.test(m))) return { message: "Cante coverage gap. Ask your broker to confirm the complete duty.", shipment: false };
  if (result.unresolvedMeasures.some(m => /quantity|content value|shipment.value|qualification|melt|smelt|weight|unit/i.test(m))) return { message: "Shipment facts missing. Add quantity, value or qualification evidence.", shipment: true };
  if (result.unresolvedMeasures.length) return { message: "Some duties remain unresolved. Ask your broker to review the breakdown.", shipment: false };
  if (result.adCvdAdvisories.length) return { message: "AD/CVD may apply. Ask your broker to check the order scope.", shipment: false };
  if (result.uflpaAdvisories.length) return { message: "Supply-chain lead. Ask your compliance team to check origin evidence.", shipment: false };
  if (result.totalRatePercent === null) return { message: "Quantity-based duty. Add shipment quantity and value.", shipment: true };
  return null;
}

export function ProductSetup({ onSelect, onDelete }: { onSelect: (product: SelectedProduct) => void; onDelete?: (id: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"preview" | "all" | "minimized">("preview");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [retry, setRetry] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const entry = useRef<HTMLFormElement>(null);
  const today = easternIsoDate();
  const filtered = products.filter(p => `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()));
  const shown = view === "minimized" ? [] : view === "all" || search ? filtered : filtered.slice(0, 5);
  const checkKey = (p: Product) => `${codeFor(p)}|${normalizeCountryCode(p.originCountry ?? "")}|${today}`;
  const targets = [...new Map(shown.filter(p => codeFor(p) && /^[A-Z]{2}$/.test(normalizeCountryCode(p.originCountry ?? ""))).map(p => [checkKey(p), p])).entries()];
  const targetSignature = targets.map(([key]) => key).sort().join(",");
  // Check visible rows only, deduplicate code/origin/date, and bound concurrent requests.
  useEffect(() => {
    const pending = targets.filter(([key]) => !checks[key] || checks[key].status === "checking");
    if (!pending.length) return;
    const controller = new AbortController(); let next = 0;
    setChecks(current => ({ ...current, ...Object.fromEntries(pending.map(([key]) => [key, { status: "checking" }])) }));
    async function worker() {
      while (!controller.signal.aborted) {
        const item = pending[next++]; if (!item) return;
        const [key, p] = item;
        try {
          const params = new URLSearchParams({ code: codeFor(p)!, country: normalizeCountryCode(p.originCountry!), importDate: today });
          const response = await fetch(`/api/tariff/stack?${params}`, { cache: "no-store", signal: controller.signal });
          const data = await response.json();
          if (!response.ok || !data.result) throw Error(data.error ?? "Tariff lookup unavailable.");
          if (!controller.signal.aborted) setChecks(current => ({ ...current, [key]: { status: "done", result: data.result } }));
        } catch (e) {
          if (!controller.signal.aborted) setChecks(current => ({ ...current, [key]: { status: "error", message: e instanceof Error ? e.message : "Tariff lookup unavailable." } }));
        }
      }
    }
    void worker(); void worker();
    return () => controller.abort();
    // Result updates do not rerun completed checks. Changing visible keys cancels unfinished work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSignature, retry]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/products", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Could not load products.");
      setProducts(data.products ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load products."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(csv: string, single = false) {
    if (busy) return;
    setBusy(true); setError(null); setSummary(null);
    try {
      const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Could not save products.");
      setSummary(data.summary);
      if (single && data.summary.rejected === 0) { setForm(blank); setEditing(null); }
      setView("preview"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save products."); }
    finally { setBusy(false); }
  }
  async function remove(p: Product) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/products?${new URLSearchParams({ productId: p.id })}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.deleted) throw Error(data.error ?? "Product was not deleted. Reload and try again.");
      setProducts(current => current.filter(product => product.id !== p.id));
      if (editing?.id === p.id) { setEditing(null); setForm(blank); }
      setPendingDelete(null); onDelete?.(p.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete product."); }
    finally { setBusy(false); }
  }
  async function upload(selected: File) {
    try {
      if (selected.size > 2 * 1024 * 1024) throw Error("File exceeds 2 MiB. Split it into smaller files.");
      await save(await selected.text());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read file."); }
  }
  function edit(p: Product) {
    setEditing(p); setForm({ sku: p.sku, name: p.name, hts: codeFor(p) ?? "", origin: p.originCountry ?? "", price: p.unitValue === null ? "" : String(p.unitValue), currency: p.currency || "USD" });
    entry.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    entry.current?.querySelector<HTMLInputElement>(!codeFor(p) ? 'input[name="hts"]' : 'input[name="origin"]')?.focus({ preventScroll: true });
  }
  function select(p: Product, result?: StackedDutyResult, editShipment = false) {
    onSelect({ id: p.id, name: p.name, htsCode: codeFor(p)!, countryOfOrigin: normalizeCountryCode(p.originCountry!), importDate: today, dutyResult: result, editShipment, codeConfirmed: p.classifications.some(c => c.system === "hts" && c.status === "approved" && c.code.replace(/\D/g, "") === codeFor(p)) });
  }
  return <section id="products" className="product-setup" aria-labelledby="product-heading">
    <div className="tariff-section-heading"><div><span className="tariff-eyebrow">Your catalogue</span><h2 id="product-heading">Your products</h2><p className="muted">Review status appears here. Open details only when you need them.</p></div><button className="btn" disabled={busy} onClick={() => file.current?.click()}><Upload size={15} />Import products CSV</button></div>
    <form ref={entry} className="product-entry" onSubmit={e => { e.preventDefault(); const columns=["sku","name","hts_code","origin_country","unit_value","currency","description","materials","unit_of_measure","product_class","notes"]; const values=[form.sku.trim(),form.name.trim(),form.hts.trim(),normalizeCountryCode(form.origin),form.price,form.currency,editing?.description??"",(editing?.materials??[]).join(";"),editing?.unitOfMeasure??"",editing?.productClass??"",editing?.notes??""]; void save(columns.join(",")+"\n"+values.map(quote).join(","),true); }}>
      <label>Product name<input className="input" required disabled={busy} value={form.name} placeholder="e.g. Printer motor" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>SKU<input className="input" required readOnly={!!editing} disabled={busy} value={form.sku} placeholder="Your part number" onChange={e => setForm({ ...form, sku: e.target.value })} /></label>
      <label>U.S. HTS code<input name="hts" className="input" required disabled={busy} pattern="(?:[0-9][. ]*){10}" title="Enter ten digits, with optional dots or spaces." value={form.hts} placeholder="10-digit code" onChange={e => setForm({ ...form, hts: e.target.value })} /></label>
      <label>Origin<input name="origin" className="input" required disabled={busy} value={form.origin} placeholder="Made in…" onChange={e => setForm({ ...form, origin: e.target.value })} /></label>
      <label>Unit price · {form.currency}<input className="input" type="number" min="0" step="any" disabled={busy} value={form.price} placeholder="Optional" onChange={e => setForm({ ...form, price: e.target.value })} /></label>
      <div className="product-form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Save product"}</button>{editing && <button className="btn" type="button" disabled={busy} onClick={() => { setEditing(null); setForm(blank); }}>Cancel edit</button>}</div>
    </form>
    <p className="tariff-scope-note">CSV codes need confirmation. Unit price is a reference, not shipment customs value.</p>
    <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={e => { const selected = e.target.files?.[0]; if (selected) void upload(selected); e.target.value = ""; }} />
    {error && <p className="tariff-attention" role="alert">{error} <button className="tariff-text-button" onClick={() => { setError(null); void load(); }}>Reload products</button></p>}
    {summary && <div className="product-import-summary" role="status"><p>{summary.created} added · {summary.updated} updated · {summary.unchanged} unchanged · {summary.rejected} rejected</p>{summary.rows.filter(r => r.outcome === "rejected").map(r => <p key={r.line}>Row {r.line} · {r.sku || "Missing SKU"}: {r.reason}</p>)}{summary.caveats.map((note, i) => <p className="tariff-scope-note" key={i}>{note}</p>)}</div>}
    {loading ? <p className="muted" role="status">Loading products…</p> : products.length === 0 ? <div className="product-empty"><strong>Your first product starts here.</strong><p>Add a name, SKU, HTS code and origin above.</p></div> : <>
      <div className="product-table-heading"><span>{search ? `${filtered.length} matching / ` : ""}{products.length} {products.length === 1 ? "product" : "products"}</span><div className="product-list-controls"><input className="input" aria-label="Search products" placeholder="Find a product…" value={search} onChange={e => { setSearch(e.target.value); if (view === "minimized") setView("preview"); }} />{view === "minimized" ? <button className="btn" onClick={() => setView("preview")}>Show products</button> : <>{view !== "all" && filtered.length > 5 && !search && <button className="btn" onClick={() => setView("all")}>Show all ({filtered.length})</button>}{view === "all" && filtered.length > 5 && <button className="btn" onClick={() => setView("preview")}>Show fewer</button>}<button className="btn" onClick={() => setView("minimized")}>Minimize</button></>}</div></div>
      {shown.length > 0 && <div className="product-table-wrap"><table className="product-table"><thead><tr><th>Product</th><th>HTS / origin</th><th>Unit price</th><th>Review status</th><th>Action</th></tr></thead><tbody>{shown.map(p => {
        const code = codeFor(p); const country = normalizeCountryCode(p.originCountry ?? ""); const complete = !!code && /^[A-Z]{2}$/.test(country);
        const approved = !!code && p.classifications.some(c => c.system === "hts" && c.status === "approved" && c.code.replace(/\D/g, "") === code);
        const check = checks[checkKey(p)]; const result = check?.status === "done" ? check.result : undefined; const advice = result ? adviceFor(result) : null;
        const dataIssue = !code ? (codesFor(p).length > 1 ? "Conflicting HTS codes. Ask your broker which code applies." : "Exact HTS missing. Add the ten-digit code from your broker.") : !/^[A-Z]{2}$/.test(country) ? "Origin missing. Add the country of manufacture." : null;
        const review = !!dataIssue || !approved || !!advice;
        return <tr key={p.id}><td><strong>{p.name}</strong><small>{p.sku}</small></td><td data-label="HTS / origin">{code ?? "HTS missing / conflicting"}<small>{country || "Origin missing"}</small></td><td data-label="Unit price">{priceFor(p)}</td><td className="product-review-cell" data-label="Review status"><span className={`pill ${review ? "pill-warn" : "pill-muted"}`}>{dataIssue ? "Needs facts" : check?.status === "error" ? "Check failed" : !approved ? "Needs review" : check?.status === "checking" || !check ? "Checking duties…" : review ? "Needs review" : "Supported rate"}</span>{dataIssue && <small>{dataIssue}</small>}{!dataIssue && !approved && <small>HTS unconfirmed. Ask your broker to confirm the code.</small>}{complete && check?.status === "error" && <small>Duty lookup failed. Retry the check.</small>}{complete && advice && <small>{advice.message}</small>}{complete && result && !advice && result.totalRatePercent !== null && <small>{new Intl.NumberFormat("en-US",{style:"percent",maximumFractionDigits:4}).format(result.totalRatePercent)} · supported duties only</small>}</td><td className="product-row-actions">
          {dataIssue ? <button className="tariff-product-action" disabled={busy} onClick={() => edit(p)}>Add product facts <ArrowRight size={14} /></button> : check?.status === "error" ? <button className="tariff-product-action" onClick={() => { setChecks(current => { const next = { ...current }; delete next[checkKey(p)]; return next; }); setRetry(n => n + 1); }}>Retry check</button> : <button className="tariff-product-action" disabled={!result} onClick={() => select(p,result,!!advice?.shipment)}>{advice?.shipment ? "Add shipment facts" : "View breakdown"} <ArrowRight size={14} /></button>}
          <button className="product-delete" aria-label={`Delete ${p.name}`} disabled={busy} onClick={() => setPendingDelete(pendingDelete === p.id ? null : p.id)}><Trash2 size={15} /></button>
          {pendingDelete === p.id && <div className="product-delete-confirm" role="group" aria-label={`Confirm deletion of ${p.name}`}><p>Delete this product and its classifications?</p><button className="btn" disabled={busy} onClick={() => void remove(p)}>{busy ? "Deleting…" : "Delete product"}</button><button className="tariff-text-button" disabled={busy} onClick={() => setPendingDelete(null)}>Keep product</button></div>}
        </td></tr>;
      })}</tbody></table></div>}
      {view === "preview" && !search && filtered.length > 5 && <p className="tariff-scope-note">Showing 5 of {filtered.length} products.</p>}
      {view !== "minimized" && filtered.length === 0 && <p className="muted">No matching products.</p>}
      {view !== "minimized" && shown.length > 0 && <p className="tariff-scope-note">Duty checks use {today}. A supported rate is not a complete landed cost.</p>}
    </>}
    <a className="tariff-text-button" href="/examples/products-template.csv" download>Download product template</a>
  </section>;
}
