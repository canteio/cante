"use client";
import { useEffect, useState } from "react";

type Candidate = { id: string; product_id: string; match_kind: "exact_code" | "code_prefix"; created_at: string };
export function MonitorCandidates() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/tariff/monitor-candidates", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Signal lookup failed");
        const data = await response.json();
        if (!controller.signal.aborted) setCandidates(data.candidates);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  if (error) return <p role="status">Tariff monitor signals are unavailable. Review the workqueue.</p>;
  if (!candidates) return <p role="status">Loading tariff monitor signals…</p>;
  if (!candidates.length) return null;
  return <section className="card" aria-label="Possible tariff change signals">
    <h2 className="card-title">Signal — possible tariff change</h2>
    <p>{new Set(candidates.map(candidate => candidate.product_id)).size} product(s) may be affected by monitored findings. Re-run your tariff analysis to check current published rates.</p>
    <p className="muted">Code overlap only; applicability and any rate change remain unverified. Signals remain visible after analysis and do not establish a duty rate or dollar impact.</p>
    <p className="muted">Latest signal: {new Date(candidates[0].created_at).toLocaleString()}</p>
    <a className="btn btn-small" href="#impact-csv">Re-upload portfolio CSV</a>{" "}
    <a className="btn btn-small" href="/workqueue">Review findings</a>
  </section>;
}
