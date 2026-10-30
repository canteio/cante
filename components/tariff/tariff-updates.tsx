"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { LiveCheckResult } from "@/app/api/tariff/live-check/check";
import { ProductImpactReport } from "./product-impact-report";
type CheckEvidence = { latest: { id: string; filename: string; created_at: string } | null; canWrite: boolean; checkingAvailable: boolean; status: string; verified: boolean; result: LiveCheckResult | null };
export function TariffUpdates() {
  const [evidence, setEvidence] = useState<CheckEvidence | null>(null);
  const [fresh, setFresh] = useState<{ result: LiveCheckResult; checkId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [stage, setStage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/tariff/check-now", { cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load your latest check."); setEvidence(data);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)); return () => controller.current?.abort(); }, [load]);
  async function check() {
    if (busy) return; setBusy(true); setError(null); setFresh(null); setStage("Opening your latest saved file…"); controller.current = new AbortController();
    try {
      const response = await fetch("/api/tariff/check-now", { method: "POST", signal: controller.current.signal });
      if (!response.ok || !response.body) { const data = await response.json(); throw new Error(data.error ?? "Could not start check."); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ""; let completed = false;
      const consume = (line: string) => { if (!line.trim()) return; const event = JSON.parse(line); if (event.type === "error") throw new Error(event.error ?? "Check failed."); if (event.type === "progress") setStage(event.message); if (event.type === "done") { completed = true; setFresh({ result: event.result, checkId: event.checkId }); } };
      try { for (;;) { const part = await reader.read(); if (part.done) break; pending += decoder.decode(part.value, { stream: true }); const lines = pending.split("\n"); pending = lines.pop() ?? ""; lines.forEach(consume); } pending += decoder.decode(); consume(pending); } finally { await reader.cancel(); }
      if (!completed) throw new Error("Check stopped before completion. No result is confirmed.");
      try { await load(); } catch { setError("The fresh result is shown, but saved history could not be reloaded."); }
    } catch (failure) { setFresh(null); setError(failure instanceof Error ? failure.message : "Check failed."); }
    finally { setBusy(false); setStage(""); }
  }
  const report = fresh?.result ?? evidence?.result; const checkId = fresh?.checkId ?? evidence?.latest?.id;
  return <section className="tariff-updates" aria-labelledby="tariff-updates-heading">
    <div className="tariff-section-heading"><div><span className="tariff-eyebrow">Official-source checks</span><h2 id="tariff-updates-heading">Check for changes</h2><p id="tariff-check-availability" className="muted">{evidence?.latest ? `Refresh ${evidence.latest.filename} against current official sources, then see product costs and evidence.` : "Start by uploading a file for an official-source check. Products saved in the catalogue alone do not establish a check baseline."}</p></div>{evidence && !evidence.latest && evidence.canWrite ? <Link className="btn btn-primary" href="/tariff/demo" aria-describedby="tariff-check-availability">Upload and check your file</Link> : <button className="btn btn-primary" aria-describedby="tariff-check-availability" disabled={busy || (!error && !evidence?.checkingAvailable) || Boolean(evidence && !evidence.canWrite)} onClick={() => { if (!evidence) { setError(null); void load().catch(e => setError(e.message)); } else { void check(); } }}><RefreshCw size={15} className={busy ? "spin" : undefined} />{busy ? "Checking…" : !evidence ? error ? "Retry loading checks" : "Loading checks…" : "Check for changes"}</button>}</div>
    {evidence && !evidence.canWrite && <p className="tariff-attention">Your account has view-only access. Ask a workspace owner for write access to run checks.</p>}
    <p><Link href="/tariff/demo">{evidence?.latest ? "Upload a replacement file →" : "Upload and check your file →"}</Link> · <Link href="/tariff/history">Check history →</Link></p>
    {busy && <p role="status">{stage}</p>}{error && <p className="tariff-attention" role="alert">{error}</p>}
    {evidence?.latest && <p className="muted">Latest saved check: {evidence.status} · {new Date(evidence.latest.created_at).toLocaleString()}{!evidence.verified ? " · saved calculation is unverified; run a fresh check" : " · worker execution verified"}</p>}
    {report && !busy && <ProductImpactReport result={report} checkId={checkId} />}
    <p className="tariff-scope-note">Checks run when you upload or click. Product matches require applicability review; incomplete duties and costs stay unresolved.</p>
  </section>;
}
