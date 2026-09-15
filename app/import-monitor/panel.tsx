"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { searchMonitor } from "@/pipelines/import-manifest/monitor/query";
import { describeSourceStatus } from "@/pipelines/import-manifest/monitor/status-labels";
import { clampLimit } from "@/pipelines/import-manifest/monitor/limit-clamp";

type Results = ReturnType<typeof searchMonitor>;
export function ImportMonitorPanel() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  // Paired with the new "Results per page" field below: Previous/Next must
  // step by whatever limit is actually in effect for the current query, not
  // a hardcoded 50 — otherwise a non-default limit silently skips or repeats
  // rows when paging (e.g. limit=20 + step 50 skips 30 rows every click).
  const [pageSize, setPageSize] = useState(50);
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
    // Bug fix: the old code derived the `limit` sent to the API and the local
    // `pageSize` used to step Previous/Next from two different expressions —
    // `Number(fields.get("limit")) || 50` treats an explicit 0 as falsy and
    // falls back to 50 for pageSize, while the loop below still sent the raw
    // string "0" to the API (which the server rejects, min 1). That mismatch
    // meant Previous/Next could silently step by a size the server never
    // actually used. clampLimit() (pipelines/import-manifest/monitor/
    // limit-clamp.ts) now owns this clamping logic as a pure, unit-tested
    // function (see limit-clamp.test.ts) instead of inline arithmetic that
    // only a browser-rendered form submission could exercise — matches the
    // server's documented 1-100 range (see monitorQueryDocs in query.ts).
    const rawLimit = Number(fields.get("limit"));
    const limit = clampLimit(rawLimit);
    const params = new URLSearchParams();
    for (const [key, value] of fields) {
      if (key === "limit") continue; // set explicitly below from the clamped value
      let v = String(value).trim();
      // API's country filter is a strict ^[A-Z]{2}$ match (see monitorQuery in
      // query.ts) but a human typing "cn"/"Cn" got a silent zero-result query
      // with no indication why — normalize case here instead of making every
      // user discover the uppercase-only contract by trial and error.
      if (key === "country" && v) v = v.toUpperCase();
      if (v) params.set(key, v);
    }
    params.set("limit", String(limit));
    setOffset(0);
    setPageSize(limit);
    setQuery(params.toString());
  }
  // UI/UX friction: once any filter (cargo/country/importer/hsChapter/kind) was
  // set, there was no way back to the unfiltered default view short of manually
  // clearing every field by hand — the two selects in particular don't have an
  // obvious "empty" option to click back to for country. A single Reset button
  // clears the DOM form back to its defaults and re-fires the default query.
  function reset() {
    formRef.current?.reset();
    setOffset(0); setPageSize(50); setQuery("");
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
      {/* UI/UX + agent-usability gap: the API has long supported a `limit`
          param (1-100, default 50, see monitorQueryDocs in query.ts) but no
          form field ever exposed it — a human wanting fewer/more results per
          page, or an agent that read the machine-readable params doc and
          tried to act on it, had no UI path to it short of hand-editing the
          URL. Also fixes a latent pagination bug: Previous/Next below used
          to hardcode a step of 50 regardless of the actual limit in effect,
          so a hand-edited `&limit=20` URL would silently skip/duplicate rows
          when paging. Both now read the same `limit` state. */}
      <label>Results per page<input name="limit" type="number" min={1} max={100} defaultValue={50} title="1-100, matches the API's documented limit range" /></label>
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
      {/* UI/UX friction: a brand-new workspace (or one whose worker has never
          run) landed on a dead end — "Monitoring has not run yet" with no
          indication of whether that's expected, how long it takes, or what
          to do about it. A first-time user (or an agent probing the API
          before there's data) had to go read README/source to learn that
          `npm run imports:refresh` is the operator action that populates
          this view. State the concrete next step inline instead. */}
      {data.status === "never_run" && <p>No refresh has completed for this workspace yet. Once the scheduled worker (<code>npm run imports:refresh</code>) runs for the first time, results will appear here automatically — no action needed on this page.</p>}
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
      {/* UI/UX friction: a zero-result *filtered* search (e.g. a typo'd importer
          name or an HS chapter with no matches) rendered the exact same generic
          copy as a genuinely empty, unfiltered dataset — a user had no signal
          that their filters were the likely cause, and no one-click way back to
          the unfiltered view short of manually clearing each field (the Reset
          button lives up in the form, easy to miss after scrolling to results).
          When filters are active (query !== ""), name that explicitly and offer
          an inline shortcut that reuses the same reset() the form's Reset
          button calls, instead of a dead-end sentence. */}
      {data.results.length === 0 && (query !== "" ? <p>No matches for the current filters. Try loosening or removing one — e.g. drop the HS chapter or country — or{" "}
        <button type="button" className="btn btn-small" disabled={busy} onClick={reset}>Clear all filters</button> to see the full unfiltered set.</p>
        : <p>No matches in the available evidence. Check coverage above before drawing conclusions.</p>)}
      {data.results.map(row => <article key={row.id} className="import-monitor-result">
        <h2>{row.importer}</h2>
        <p>{row.kind === "named_importer" ? "Named CPSC importer + commodity match" : "Research candidate: commodity overlap only"}{row.newInLatestRun ? " · New in latest refresh" : ""}</p>
        <p>{row.shipment.cargoDescription} · Shipper country: {row.shipment.shipperCountryCode ?? "unknown"}</p>
        <p>B/L {row.shipment.billOfLading} · Manifest filed {row.shipment.manifestFiledDate} · First found {row.firstSeenAt.slice(0, 10)}</p>
        <a href={row.recallUrl} target="_blank" rel="noopener noreferrer">{row.recallTitle}</a>
        <p>Recall: {row.recallDate} · Shared terms: {row.terms.join(", ")}</p>
      </article>)}
      <div className="page-actions">
        <button className="btn" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button>
        <button className="btn" disabled={busy || offset + pageSize >= data.total} onClick={() => setOffset(offset + pageSize)}>Next</button>
      </div>
    </>}
  </section>;
}
