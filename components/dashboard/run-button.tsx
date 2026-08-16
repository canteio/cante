"use client";

import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JurisdictionName } from "@/lib/countries";

export function RunButton({ customerId, country }: { customerId: string | null; country: JurisdictionName }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, country }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(data.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button className="btn" onClick={run} disabled={running || !customerId}>
        {running ? <Loader2 size={14} className="spin" /> : <Play size={13} fill="currentColor" strokeWidth={0} />}
        {running ? "Checking…" : "Run check now"}
      </button>
      {running && (
        <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: 6 }}>
          Fetching {country} sources, then reading them. A few minutes.
        </div>
      )}
      {error && (
        <div className="callout callout-bad" style={{ textAlign: "left", maxWidth: 400 }}>
          {error}
        </div>
      )}
    </div>
  );
}
