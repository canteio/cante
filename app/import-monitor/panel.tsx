"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { searchMonitor } from "@/pipelines/import-manifest/monitor/query";
import { describeSourceStatus } from "@/pipelines/import-manifest/monitor/status-labels";

type Results = ReturnType<typeof searchMonitor>;
export function ImportMonitorPanel() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(""); setRetryable(false); setData(null);
    fetch(`/api/import-monitor?${query}&offset=${offset}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) { setRetryable(Boolean(result.retryable)); throw new Error(result.error ?? "Monitoring query failed"); }
        setData(result);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [query, offset, retryToken]);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of fields) {
      let v = String(value).trim();
      // API's country filter is a strict ^[A-Z]{2}$ match (see monitorQuery in
      // query.ts) but a human typing "cn"/"Cn" got a silent zero-result query
      // with no indication why — normalize case here instead of making every
      // user discover the uppercase-only contract by trial and error.
      if (key === "country" && v) v = v.toUpperCase();
      if (v) params.set(key, v);
    }
    setOffset(0); setQuery(params.toString());
  }
  // UI/UX friction: once any filter (cargo/country/importer/hsChapter/kind) was
  // set, there was no way back to the unfiltered default view short of manually
  // clearing every field by hand — the two selects in particular don't have an
  // obvious "empty" option to click back to for country. A single Reset button
  // clears the DOM form back to its defaults and re-fires the default query.
  function reset() {
    formRef.current?.reset();
    setOffset(0); setQuery("");
  }
  return <section className="import-monitor">
    <form ref={formRef} onSubmit={search} className="import-monitor-form">
      <label>Cargo<input name="cargo" placeholder="e.g. baby stroller" maxLength={200} /></label>
      {/* UI/UX friction: the API's country filter is a plain ISO alpha-2 match
          (see monitorQuery in query.ts) with no allowlist, but this select only
          ever offered CN/Indonesia — a user or agent looking for e.g. Vietnam
          (VN) or Mexico (MX) shipments had no way to reach a filter the backend
          already fully supports, short of hand-editing the URL. Switched to a
          free-text input (like hsChapter already is) with a datalist of common
          shipper origins as a hint, not a restriction. */}
      <label>Shipper country<input name="country" list="country-options" placeholder="e.g. CN" pattern="[A-Za-z]{2}" maxLength={2} title="Two-letter ISO country code, e.g. CN" />
        <datalist id="country-options">
          <option value="CN" label="China" />
          <option value="ID" label="Indonesia" />
          <option value="VN" label="Vietnam" />
          <option value="MX" label="Mexico" />
          <option value="IN" label="India" />
          <option value="TW" label="Taiwan" />
        </datalist>
      </label>
      <label>Importer<input name="importer" placeholder="Company name" maxLength={200} /></label>
      {/* API's monitorQuery has long supported hsChapter filtering (see query.ts)
          but no form field ever exposed it, so a real user had no way to reach
          a working, documented filter short of hand-editing the URL. */}
      <label>HS chapter<input name="hsChapter" placeholder="e.g. 95" pattern="\d{2}" maxLength={2} title="Two-digit HS chapter code, e.g. 95" /></label>
      <label>Evidence<select name="kind"><option value="named_importer">Named in CPSC recall</option><option value="commodity_candidate">Commodity overlap only</option><option value="all">Both</option></select></label>
      <button className="btn btn-primary" disabled={busy}>Search</button>
      <button type="button" className="btn" disabled={busy || query === ""} onClick={reset}>Reset</button>
    </form>
    {busy && <p role="status">Loading monitoring results…</p>}
    {error && <p role="alert">{error}
      {/* UI/UX friction: a 503 storage outage rendered identically to a bad
          filter, so a user had no way to tell "fix your search" from "this
          will probably work if you just try again" without reading source.
          The API now flags retryable 503s explicitly; surface that as an
          actual retry button instead of leaving the user to guess and
          re-click Search by hand. */}
      {retryable && <button type="button" className="btn" disabled={busy} onClick={() => setRetryToken(t => t + 1)}> Retry</button>}
    </p>}
    {data && <>
      <p role="status"><strong>{data.status === "never_run" ? "Monitoring has not run yet" : data.status === "current" ? "Current within configured coverage" : "Incomplete or stale coverage"}</strong>
        {data.updatedAt && ` · Last refresh ${new Date(data.updatedAt).toLocaleString()}`}</p>
      {/* UI/UX friction: raw machine status tokens ("blocked", "error",
          "sample") were shown verbatim to a signed-in customer with zero
          explanation of what they mean or imply for trustworthiness of the
          results below. describeSourceStatus() gives plain-English copy
          instead (see status-labels.ts). */}
      {data.sources && Object.entries(data.sources).map(([name, source]) => <p key={name}>
        <strong>{name === "shipments" ? "Shipments" : "CPSC recalls"}: {describeSourceStatus(source.status)}</strong> · {source.count} records · {source.message}
        {source.dataAsOf && ` Data as of ${source.dataAsOf.slice(0, 10)}.`}
      </p>)}
      <details open={data.status !== "current"}><summary>Coverage and interpretation</summary><ul>{data.caveats.map(c => <li key={c}>{c}</li>)}</ul></details>
      {/* Prior copy only ever said "N matching pairs" with no indication of which
          slice of N the visible cards represent, so paging past page 1 gave no
          way to tell where you were (or that "Next" being disabled meant you'd
          reached the end) without counting cards by eye. Show the 1-based
          visible range alongside the total, matching the Previous/Next below. */}
      <p>{data.total === 0 ? "0 matching shipment–recall pairs." :
        `Showing ${offset + 1}\u2013${Math.min(offset + data.results.length, data.total)} of ${data.total} matching shipment\u2013recall pairs.`}</p>
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
