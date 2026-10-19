"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

type CheckEvidence = {
  run: { id: string; status: string; started_at: string; completed_at: string | null } | null;
  findings: { id: string; title: string; url: string | null; summary_en: string | null; relevance: string; reasoning: string }[];
  checkingAvailable: boolean; coverageNotes: string | null; failedSources: number; emptySources: number; sourceCount: number; moreFindings?: boolean;
};
export function TariffUpdates() {
  const [evidence, setEvidence] = useState<CheckEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [caveats, setCaveats] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/tariff/check-now", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load update history.");
    setEvidence(data);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)); return () => controller.current?.abort(); }, [load]);
  async function check() {
    if (busy) return;
    setBusy(true); setError(null); setCaveats([]); setStage("Starting official-source check…"); setElapsed(0);
    controller.current = new AbortController();
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    try {
      const response = await fetch("/api/tariff/check-now", { method: "POST", signal: controller.current.signal });
      if (!response.ok || !response.body) { const data = await response.json(); throw new Error(data.error ?? "Could not check updates."); }
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); let pending = ""; let completed = false;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.error ?? "Check failed.");
        if (event.type === "progress") setStage(event.message);
        if (event.type === "done") { completed = true; setCaveats(event.coverageCaveats ?? []); }
      };
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); const lines = pending.split("\n"); pending = lines.pop() ?? ""; lines.forEach(consume); }
        pending += decoder.decode(); consume(pending);
      } finally { await reader.cancel(); }
      if (!completed) throw new Error("Check ended before completion. Its result is not confirmed.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Check failed."); }
    finally { clearInterval(timer); setBusy(false); }
  }
  return <section className="tariff-updates" aria-labelledby="tariff-updates-heading">
    <div className="tariff-section-heading"><div><span className="tariff-eyebrow">Official notices</span><h2 id="tariff-updates-heading">Check for changes</h2><p id="tariff-check-availability" className="muted">{evidence?.checkingAvailable ? "Check official U.S. sources, then match findings against your saved products." : !evidence && !error ? "Loading check availability…" : "Unavailable here: the checking worker must be connected and your account needs write access. No new check has run."}</p></div><button className="btn btn-primary" aria-describedby="tariff-check-availability" disabled={busy || !evidence?.checkingAvailable} onClick={() => void check()}><RefreshCw size={15} className={busy ? "spin" : undefined} />{busy ? "Checking…" : "Check for changes"}</button></div>
    {busy && <p role="status">{stage} · {elapsed}s</p>}
    {error && <p className="tariff-attention" role="alert">{error}</p>}
    {!evidence?.run && !error && <p className="muted">No saved check yet.</p>}
    {evidence?.run && <>
      <p className="muted">{evidence.run.status === "complete" ? "Last completed" : `Last check: ${evidence.run.status}`} · {new Date(evidence.run.completed_at ?? evidence.run.started_at).toLocaleString()}</p>
      {evidence.run.status === "complete" && evidence.findings.length === 0 && <p>No new relevant findings were recorded. Read coverage notes before treating this as clear.</p>}
      {evidence.findings.map(finding => <details className="tariff-update-row" key={finding.id}><summary>{finding.title}</summary><p>{finding.summary_en}</p><p className="muted">{finding.reasoning}</p>{finding.url && /^https:\/\//.test(finding.url) && <a href={finding.url} target="_blank" rel="noreferrer">Official notice</a>}<p className="muted">A finding is a review lead; it does not establish a changed tariff for every uploaded row.</p></details>)}
      {evidence.moreFindings && <p className="tariff-attention">Showing the first 50 findings. This list is incomplete.</p>}
      {(evidence.coverageNotes || caveats.length > 0 || evidence.failedSources > 0 || evidence.emptySources > 0) && <details className="tariff-explanation" open><summary>Coverage notes</summary><p>{evidence.failedSources} source failures · {evidence.emptySources} sources returned no entries · {evidence.sourceCount} sources attempted</p><p style={{ whiteSpace: "pre-wrap" }}>{evidence.coverageNotes ?? caveats.join("\n")}</p></details>}
    </>}
    <p className="tariff-scope-note">After reviewing a notice or confirming new rules, recalculate your file. Saved historical audits retain their original results.</p>
  </section>;
}
