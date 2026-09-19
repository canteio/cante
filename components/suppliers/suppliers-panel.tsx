"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Truck, ShieldCheck, ShieldAlert, Plus, Search, FileCheck, RefreshCw, CheckCircle2, AlertTriangle, Play } from "lucide-react";
import type { JurisdictionName } from "@/lib/countries";
import { CountryTabs } from "@/components/dashboard/country-tabs";
import { supplierBatchRefreshError, supplierBatchScreenCompleted, supplierScreenRefreshError, supplierScreeningFeedback } from "@/lib/suppliers/screening-feedback";
import { readSupplierPostResponse } from "@/lib/suppliers/post-response";

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

type Coverage = {
  totalSuppliers: number;
  neverScreened: string[];
  staleScreenings: Array<{ name: string; ageDays: number }>;
  currentMatches: Array<{ name: string; matchCount: number }>;
  erroredScreenings: string[];
};

type SupplierMutation =
  | { kind: "add" }
  | { kind: "screen"; supplierId: string }
  | { kind: "batch" };

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

export function SuppliersPanel({ country }: { country: JurisdictionName }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [supplierCountry, setSupplierCountry] = useState("South Korea");
  const [role, setRole] = useState("Raw Material Manufacturer");
  const [mutation, setMutation] = useState<SupplierMutation | null>(null);
  const mutationLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // UI/UX fix: the initial fetch used to have no loading state, so the panel
  // showed "Active Suppliers (0)" / "No matching suppliers found" while data
  // was still in flight — indistinguishable from a genuinely empty vendor
  // list. Now we track `loading` and render a distinct "Loading suppliers…"
  // state instead of a false-empty message (same friction class already
  // fixed for silent failures elsewhere: workqueue/checklist/catalogue/etc.).
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/suppliers");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data.error as string) ?? `Failed to load suppliers (status ${res.status}).`);
      }
      const data = await res.json();
      setSuppliers(data.suppliers ?? []);
      setCoverage(data.screeningCoverage ?? null);
      setError(null);
      return null;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load suppliers.";
      setError(message);
      // Mutations need the failure value too; otherwise their later success
      // message can erase the only evidence that fresh results never loaded.
      return message;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function beginMutation(next: SupplierMutation): boolean {
    // React state does not update until the next render, so the ref closes the
    // same-tick double-click window that disabled buttons alone cannot cover.
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setMutation(next);
    setError(null);
    setNote(null);
    return true;
  }

  function endMutation() {
    mutationLock.current = false;
    setMutation(null);
  }

  async function post(
    body: Record<string, unknown>,
    activeMutation: Exclude<SupplierMutation, { kind: "batch" }>,
  ): Promise<{ data: Record<string, unknown>; refreshError: string | null } | null> {
    if (!beginMutation(activeMutation)) return null;
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readSupplierPostResponse(res);
      const refreshError = await load();
      // Return refresh state with the mutation result so callers cannot present
      // fresh-result success while the supplier cards still show stale data.
      return { data, refreshError };
    } catch (cause) {
      // Keep failed mutations in-band: callers treat null as "stop", so a
      // network/invalid-response failure cannot fall through to success UI.
      const message = cause instanceof TypeError
        ? "Could not reach the supplier service. Check your connection and retry."
        : cause instanceof Error
          ? cause.message
          : "Supplier request failed. Try again.";
      setError(message);
      return null;
    } finally {
      endMutation();
    }
  }

  async function addSupplier() {
    if (!name.trim()) return;
    const res = await post(
      { action: "upsert", name: name.trim(), country: supplierCountry, role },
      { kind: "add" },
    );
    if (res) setName("");
  }

  async function screenSupplier(supplierId: string) {
    const result = await post(
      { action: "screen", supplierId },
      { kind: "screen", supplierId },
    );
    // The route returns the persisted result as `{ row, clear }`; reading the
    // old `screening` key silently dropped feedback after a successful click.
    const feedback = supplierScreeningFeedback(result?.data ?? null);
    if (!result || !feedback) return;

    const refreshFeedback = supplierScreenRefreshError(feedback, result.refreshError);
    if (refreshFeedback) {
      setNote(null);
      setError(refreshFeedback);
      return;
    }

    if (feedback.kind !== "success") {
      setError(feedback.message);
      return;
    }

    setNote(feedback.message);
    setTimeout(() => setNote(null), 3000);
  }

  async function screenAllSuppliers() {
    if (!beginMutation({ kind: "batch" })) return;
    // Previously this loop fired all requests and then unconditionally claimed
    // success ("Batch screening finished…") regardless of whether individual
    // screens actually failed (network error, 4xx/5xx) — same silent-failure
    // class already fixed in workqueue-panel.tsx and checklist-panel.tsx.
    // Now we track per-request outcome and surface a real error banner
    // listing which vendors failed, instead of a false "all done" note.
    const failed: string[] = [];
    try {
      for (const s of suppliers) {
        try {
          const res = await fetch("/api/suppliers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "screen", supplierId: s.id }),
          });
          const data = await readSupplierPostResponse(res);
          // A 200 can persist outcome="error" when the watchlist provider fails;
          // only clear/match rows mean this vendor was actually screened.
          if (!supplierBatchScreenCompleted(data)) failed.push(s.name);
        } catch {
          failed.push(s.name);
        }
      }
      // Refresh first: load() clears stale errors, so feedback must be applied
      // afterward or a real batch failure disappears as soon as it is shown.
      const refreshError = await load();
      const refreshFeedback = supplierBatchRefreshError(suppliers.length, failed.length, refreshError);
      if (refreshFeedback) {
        setError(refreshFeedback);
        return;
      }
      if (failed.length === 0) {
        setNote("Batch screening finished across all " + suppliers.length + " suppliers.");
        setTimeout(() => setNote(null), 4000);
      } else {
        setError(
          "Batch screening finished with " + failed.length + " failure(s): " + failed.join(", ") + ". Retry those vendors individually."
        );
      }
    } finally {
      endMutation();
    }
  }

  const mutationBusy = mutation !== null;
  const addSupplierBusy = mutation?.kind === "add";
  const filteredSuppliers = suppliers.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.country && s.country.toLowerCase().includes(q)) || s.role.toLowerCase().includes(q);
  });

  return (
    <div className="main-scroll">
      <div className="page-head">
        <div>
          <h1>Suppliers &amp; Vendor Due Diligence</h1>
          <p className="page-sub">
            Track overseas and domestic raw material vendors, supplier Certificates of Analysis (COA), Form E/AK origin certificates,
            and screen counterparties against official US/UN sanctions watchlists.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={screenAllSuppliers} disabled={mutationBusy || suppliers.length === 0}>
            <RefreshCw size={13} className={mutation?.kind === "batch" ? "spin" : ""} />
            {mutation?.kind === "batch" ? "Screening Watchlists…" : "Screen All Suppliers"}
          </button>
          <CountryTabs value={country} />
        </div>
      </div>

      {/* UI/UX fix: error/success banners here were plain <div>s with no
          role, so screen-reader users got zero notification when a screen
          or batch-screen action failed/succeeded (they'd have to re-scan
          the page to notice). import-monitor/panel.tsx already established
          role="alert" for errors and role="status" for transient success
          notes as the reference pattern — applying the same here. */}
      {error && <div className="pill pill-bad" role="alert" style={{ marginBottom: "1rem" }}>{error}</div>}
      {note && <div className="pill pill-ok" role="status" style={{ marginBottom: "1rem" }}>{note}</div>}

      {/* Overview Cards */}
      {coverage && (
        <div className="checklist-summary" style={{ marginBottom: "1.5rem" }}>
          <div className="checklist-summary-cell tone-ok">
            <span>Total Vendors</span>
            <strong>{coverage.totalSuppliers}</strong>
          </div>
          <div className="checklist-summary-cell tone-warn">
            <span>Unscreened</span>
            <strong>{coverage.neverScreened.length}</strong>
          </div>
          <div className="checklist-summary-cell tone-bad">
            <span>Sanction Matches</span>
            <strong>{coverage.currentMatches.length}</strong>
          </div>
        </div>
      )}

      {/* Add Supplier & Search Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        <section className="card">
          <div className="card-head">
            <Plus size={15} strokeWidth={1.75} />
            <h2>Register Vendor</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr auto", gap: "0.5rem", marginTop: "0.5rem" }}>
            {/* Keep the submitted registration snapshot immutable until its
                request finishes: otherwise a quick edit can be erased when
                the successful Add flow clears the original vendor name. */}
            <input
              className="input"
              placeholder="Vendor Name (e.g. LG Chem Ltd)"
              value={name}
              disabled={addSupplierBusy}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input"
              placeholder="Country"
              value={supplierCountry}
              disabled={addSupplierBusy}
              onChange={(e) => setSupplierCountry(e.target.value)}
            />
            <input
              className="input"
              placeholder="Role"
              value={role}
              disabled={addSupplierBusy}
              onChange={(e) => setRole(e.target.value)}
            />
            <button className="btn btn-primary" disabled={mutationBusy || !name.trim()} onClick={addSupplier}>
              {mutation?.kind === "add" ? "Adding…" : "Add"}
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <Search size={15} strokeWidth={1.75} />
            <h2>Search Vendors</h2>
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <input
              className="input"
              placeholder="Filter by vendor name, country, or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </section>
      </div>

      {/* Vendor Cards Grid */}
      <div className="side-label">
        {loading ? "Active Suppliers" : `Active Suppliers (${filteredSuppliers.length})`}
      </div>
      {loading ? (
        // role="status" so screen readers announce the loading state instead
        // of silence (same pattern applied to error/note banners above).
        <div className="empty" role="status">
          <RefreshCw size={24} strokeWidth={1.5} className="spin" style={{ marginBottom: 8 }} />
          <p>Loading suppliers…</p>
        </div>
      ) : filteredSuppliers.length === 0 ? (
        <div className="empty">
          <Truck size={24} strokeWidth={1.5} style={{ marginBottom: 8 }} />
          <p>No matching suppliers found. Add a vendor above or tell the AI Copilot in chat.</p>
        </div>
      ) : (
        <div className="checklist-grid">
          {filteredSuppliers.map((s) => (
            <article key={s.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div className="checklist-card-top">
                <div>
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>{s.name}</h3>
                  <div className="checklist-summary">
                    {s.role} {s.country ? (" · " + s.country) : ""}
                  </div>
                </div>
                {s.latestScreening ? (
                  <span className={"pill " + (SCREEN_CLASS[s.latestScreening.outcome] ?? "pill-muted")}>
                    Sanctions: {s.latestScreening.outcome.toUpperCase()}
                  </span>
                ) : (
                  <span className="pill pill-warn">Unscreened</span>
                )}
              </div>

              {/* Certificate Checklist */}
              <div style={{ marginTop: "0.25rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                <div className="side-label" style={{ padding: 0, marginBottom: 4 }}>Certificates &amp; Evidence</div>
                {s.documents.length === 0 ? (
                  <div className="muted" style={{ fontSize: "0.8rem" }}>No certificates on file.</div>
                ) : (
                  s.documents.map((doc) => (
                    <div key={doc.id} className="meta-row" style={{ marginTop: 2 }}>
                      <span style={{ fontSize: "0.85rem" }}>{doc.docType.replace(/_/g, " ")}</span>
                      <span className={"pill " + (STATUS_CLASS[doc.status] ?? "pill-muted")}>
                        {doc.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="checklist-actions" style={{ marginTop: "auto", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                <button className="btn btn-small" disabled={mutationBusy} onClick={() => screenSupplier(s.id)}>
                  <Search size={12} />
                  {mutation?.kind === "screen" && mutation.supplierId === s.id ? "Screening…" : "Screen Sanctions"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
