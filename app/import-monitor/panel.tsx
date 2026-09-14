"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { searchMonitor } from "@/pipelines/import-manifest/monitor/query";

type Results = ReturnType<typeof searchMonitor>;
export function ImportMonitorPanel() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(""); setData(null);
    fetch(`/api/import-monitor?${query}&offset=${offset}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Monitoring query failed");
        setData(result);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [query, offset]);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of fields) if (String(value).trim()) params.set(key, String(value).trim());
    setOffset(0); setQuery(params.toString());
  }
  return <section className="import-monitor">
    <form onSubmit={search} className="import-monitor-form">
      <label>Cargo<input name="cargo" placeholder="e.g. baby stroller" maxLength={200} /></label>
      <label>Shipper country<select name="country"><option value="">All countries</option><option value="CN">China</option><option value="ID">Indonesia</option></select></label>
      <label>Importer<input name="importer" placeholder="Company name" maxLength={200} /></label>
      <label>Evidence<select name="kind"><option value="named_importer">Named in CPSC recall</option><option value="commodity_candidate">Commodity overlap only</option><option value="all">Both</option></select></label>
      <button className="btn btn-primary" disabled={busy}>Search</button>
    </form>
    {busy && <p role="status">Loading monitoring results…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p role="status"><strong>{data.status === "never_run" ? "Monitoring has not run yet" : data.status === "current" ? "Current within configured coverage" : "Incomplete or stale coverage"}</strong>
        {data.updatedAt && ` · Last refresh ${new Date(data.updatedAt).toLocaleString()}`}</p>
      {data.sources && Object.entries(data.sources).map(([name, source]) => <p key={name}>
        <strong>{name === "shipments" ? "Shipments" : "CPSC recalls"}: {source.status}</strong> · {source.count} records · {source.message}
        {source.dataAsOf && ` Data as of ${source.dataAsOf.slice(0, 10)}.`}
      </p>)}
      <details open={data.status !== "current"}><summary>Coverage and interpretation</summary><ul>{data.caveats.map(c => <li key={c}>{c}</li>)}</ul></details>
      <p>{data.total} matching shipment–recall pairs.</p>
      {data.results.length === 0 && <p>No matches in the available evidence. Check coverage above before drawing conclusions.</p>}
      {data.results.map(row => <article key={row.id} className="import-monitor-result">
        <h2>{row.importer}</h2>
        <p>{row.kind === "named_importer" ? "Named CPSC importer + commodity match" : "Research candidate: commodity overlap only"}{row.newInLatestRun ? " · New in latest refresh" : ""}</p>
        <p>{row.shipment.cargoDescription} · Shipper country: {row.shipment.shipperCountryCode ?? "unknown"}</p>
        <p>B/L {row.shipment.billOfLading} · Manifest filed {row.shipment.manifestFiledDate} · First found {row.firstSeenAt.slice(0, 10)}</p>
        <a href={row.recallUrl} target="_blank" rel="noopener noreferrer">{row.recallTitle}</a>
        <p>Recall: {row.recallDate} · Shared terms: {row.terms.join(", ")}</p>
      </article>)}
      <div className="page-actions">
        <button className="btn" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
        <button className="btn" disabled={busy || offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Next</button>
      </div>
    </>}
  </section>;
}
