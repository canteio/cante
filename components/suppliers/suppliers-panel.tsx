"use client";

import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";

/**
 * Suppliers, evidence (item 9), and screening (item 10).
 *
 * `neverScreened` is shown first and prominently. A screening panel that lists
 * only the parties it has checked is quietly reassuring about the ones it
 * hasn't, which is the failure mode this whole codebase is built to avoid.
 */

type SupplierDoc = {
  id: string;
  docType: string;
  status: string;
  requestedAt: string | null;
  expiresAt: string | null;
};

type Screening = {
  outcome: string;
  matchCount: number;
  screenedAt: string;
  errorMessage: string | null;
};

type Supplier = {
  id: string;
  name: string;
  country: string | null;
  role: string;
  documents: SupplierDoc[];
  latestScreening: Screening | null;
};

type Gap = {
  supplier: { id: string; name: string };
  docType: string;
  status: string;
  detail: string;
  severity: string;
};

type Coverage = {
  totalSuppliers: number;
  neverScreened: string[];
  staleScreenings: Array<{ name: string; ageDays: number }>;
  currentMatches: Array<{ name: string; matchCount: number }>;
  erroredScreenings: string[];
};

const STATUS_CLASS: Record<string, string> = {
  received: "pill-ok",
  requested: "pill-warn",
  not_requested: "pill-muted",
  expired: "pill-bad",
  rejected: "pill-bad",
  not_applicable: "pill-muted",
};

const SCREEN_CLASS: Record<string, string> = {
  clear: "pill-ok",
  match: "pill-bad",
  error: "pill-warn",
};

const EVIDENCE_TYPES = [
  "certificate_of_origin",
  "material_declaration",
  "reach",
  "rohs",
  "pfas",
  "sni",
  "test_report",
];

export function SuppliersPanel({ country }: { country: JurisdictionName }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/suppliers");
    const data = await res.json();
    setSuppliers(data.suppliers ?? []);
    setGaps(data.gaps ?? []);
    setCoverage(data.screeningCoverage ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setError(null);
    const res = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError((data.error as string) ?? "Request failed.");
      return null;
    }
    await load();
    return data;
  }

  async function requestEvidence(supplierId: string) {
    const docType = window.prompt(`Which document? (${EVIDENCE_TYPES.join(", ")})`);
    if (!docType) return;
    const data = await post({ action: "request", supplierId, docType });
    if (data) {
      // Explicitly not "sent" — nothing was delivered.
      setNote(
        "Request recorded. Nothing was sent — copy the draft below and send it yourself:\n\n" +
          String(data.draftMessage ?? ""),
      );
    }
  }

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Suppliers</h1>
          <p className="page-sub">
            Counterparties, the evidence they owe, and when each was last screened against the US
            consolidated list.
          </p>
        </div>
        <CountryTabs value={country} />
      </div>

      {coverage && (
        <section className="card">
          <div className="card-head">
            <h2>Screening coverage</h2>
          </div>
          <div className="meta-row">
            <span className="pill pill-muted">{coverage.totalSuppliers} suppliers</span>
            {coverage.neverScreened.length > 0 && (
              <span className="pill pill-bad">{coverage.neverScreened.length} never screened</span>
            )}
            {coverage.staleScreenings.length > 0 && (
              <span className="pill pill-warn">{coverage.staleScreenings.length} stale</span>
            )}
            {coverage.currentMatches.length > 0 && (
              <span className="pill pill-bad">{coverage.currentMatches.length} matched</span>
            )}
            {coverage.erroredScreenings.length > 0 && (
              <span className="pill pill-warn">
                {coverage.erroredScreenings.length} failed to screen
              </span>
            )}
          </div>
          {coverage.neverScreened.length > 0 && (
            <div className="code-basis">
              Never screened: {coverage.neverScreened.join(", ")}. An unscreened party is not a clear
              one.
            </div>
          )}
          <div className="code-basis muted">
            Restricted-party screening against one official US list. This is not export-licence
            determination or ECCN classification.
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Add a supplier</h2>
        </div>
        <div className="meta-row">
          <input
            className="input"
            placeholder="Supplier name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="btn"
            disabled={!name.trim()}
            onClick={async () => {
              if (await post({ action: "upsert", name })) setName("");
            }}
          >
            Add
          </button>
        </div>
        {error && <div className="pill pill-bad">{error}</div>}
        {note && <pre className="code-basis">{note}</pre>}
      </section>

      {gaps.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Evidence gaps</h2>
          </div>
          {gaps.map((gap, index) => (
            <div key={index} className="impact-row">
              <div className="meta-row">
                <span className={`pill ${gap.severity === "high" ? "pill-bad" : "pill-warn"}`}>
                  {gap.severity}
                </span>
                <span className="pill pill-muted">{gap.docType.replace(/_/g, " ")}</span>
              </div>
              <div>{gap.detail}</div>
            </div>
          ))}
        </section>
      )}

      {suppliers.length === 0 ? (
        <div className="empty">
          <Truck size={20} strokeWidth={1.5} />
          <p>No suppliers yet.</p>
        </div>
      ) : (
        <div className="checklist-grid">
          {suppliers.map((supplier) => (
            <article key={supplier.id} className="card">
              <div className="checklist-card-top">
                <div>
                  <div className="strong">{supplier.name}</div>
                  <div className="checklist-summary">
                    {supplier.role}
                    {supplier.country ? ` · ${supplier.country}` : ""}
                  </div>
                </div>
                {supplier.latestScreening ? (
                  <span className={`pill ${SCREEN_CLASS[supplier.latestScreening.outcome] ?? "pill-muted"}`}>
                    {supplier.latestScreening.outcome}
                    {supplier.latestScreening.outcome === "match"
                      ? ` (${supplier.latestScreening.matchCount})`
                      : ""}
                  </span>
                ) : (
                  <span className="pill pill-bad">never screened</span>
                )}
              </div>

              {supplier.latestScreening?.errorMessage && (
                <div className="checklist-why">
                  Last screen failed: {supplier.latestScreening.errorMessage}. This party is
                  unscreened, not clear.
                </div>
              )}

              {supplier.documents.length > 0 && (
                <div className="checklist-block">
                  <div className="side-label">Evidence</div>
                  {supplier.documents.map((document) => (
                    <div key={document.id} className="meta-row">
                      <span className="pill pill-muted">{document.docType.replace(/_/g, " ")}</span>
                      <span className={`pill ${STATUS_CLASS[document.status] ?? "pill-muted"}`}>
                        {document.status.replace(/_/g, " ")}
                      </span>
                      {document.expiresAt && (
                        <span className="pill pill-muted">expires {document.expiresAt}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="checklist-actions">
                <button className="btn btn-small" onClick={() => void requestEvidence(supplier.id)}>
                  Request evidence
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => void post({ action: "screen", supplierId: supplier.id })}
                >
                  Screen now
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
