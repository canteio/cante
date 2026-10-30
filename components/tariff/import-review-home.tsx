"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {DUTY_CALCULATION_VERSION} from "@/lib/tariff/duty-expression";
import { DailyMonitor } from "./daily-monitor";
import { tariffFactsFingerprint } from "@/app/api/tariff/live-check/comparison";
import {
  RefreshCw,
  Upload,
  MessageSquare,
  Plus,
  X,
  ChevronDown,
  ArrowUpRight,
} from "lucide-react";
import {
  uploadChatFile,
  type FileAttachment,
} from "@/components/chat/upload-file";
import { FileColumnReview } from "@/components/chat/file-column-review";
import { ChatPanel } from "@/components/chat/chat-panel";
import { normalizeCountryCode, normalizeHtsCode } from "@/lib/tariff/bulk";
import type { LiveCheckResult } from "@/app/api/tariff/live-check/check";

type Product = {
  id: string;
  sku: string;
  name: string;
  originCountry: string | null;
  unitValue: number | null;
  currency: string;
  tariffInputs?: {
    fictional?: boolean;
    quantity?: number | null;
    unit?: string | null;
    usmcaQualification?: unknown;
    customsValue: number | null;
    valueBasis?: string;
    remedyFacts?: Record<string, unknown>;
  } | null;
  classifications: { system: string; code: string; status: string }[];
};
type Evidence = {
  latest: { id: string; filename: string; created_at: string } | null;
  status: string;
  verified: boolean;
  result: LiveCheckResult | null;
  canWrite: boolean;
  checkingAvailable: boolean;
  productCount: number;
  workerConfigured: boolean;
  legacyChecks: {
    id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
  }[];
  legacyFindings?: {
    id: string;
    title: string;
    url: string | null;
    summary_en: string | null;
  }[];
  legacyError?: string | null;
};
const money = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(n)
    : "Needs data";
const rate = (n: number | null | undefined) =>
  typeof n === "number"
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n * 100)}%`
    : "Needs review";
function codeFor(p: Product) {
  const codes = [
    ...new Set(
      p.classifications
        .filter((c) => c.system === "hts" && c.status !== "rejected")
        .map((c) => normalizeHtsCode(c.code)),
    ),
  ];
  return codes.length === 1 ? codes[0] : null;
}
const blank = {
  sku: "",
  name: "",
  hts: "",
  origin: "",
  value: "",
  basis: "annual",
  quantity: "",
  unit: "",
  standard: "",
  other232: "",
  weight: "",
  usMetal: "",
  ukMetal: "",
};
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
export function ImportReviewHome({
  canReviewRules = false,
  customerId = null,
}: {
  canReviewRules?: boolean;
  customerId?: string | null;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [fresh, setFresh] = useState<{
    result: LiveCheckResult;
    checkId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "changed" | "review">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chat, setChat] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatMounted, setChatMounted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const chatButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    const responses = await Promise.all([
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/tariff/check-now", { cache: "no-store" }),
    ]);
    const [catalogue, checks] = await Promise.all(
      responses.map((r) => r.json()),
    );
    if (!responses[0].ok)
      throw Error(catalogue.error ?? "Could not load products.");
    setProducts(catalogue.products ?? []);
    if (!responses[1].ok)
      throw Error(checks.error ?? "Could not load previous checks.");
    setEvidence(checks);
    setFresh((current) =>
      current && checks.result && checks.latest?.id !== current.checkId
        ? null
        : current,
    );
  }, []);
  useEffect(() => {
    void load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => abort.current?.abort();
  }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("check");
    if (!id || !/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(id)) return;
    void fetch(`/api/tariff/check-history/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const archive = await r.json();
        if (!r.ok) throw Error(archive.error);
        if (!archive.verifiedResult)
          throw Error(
            "This saved report has no verified execution. Its original inputs remain in the check archive.",
          );
        setFresh({ result: archive.verifiedResult, checkId: id });
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    function sync() {
      void load().catch((e) => setError(e.message));
    }
    window.addEventListener("cante:workspace-updated", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("cante:workspace-updated", sync);
      window.removeEventListener("focus", sync);
    };
  }, [load]);
  useEffect(() => {
    if (!chat) return;
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setChat(false);
        chatButton.current?.focus();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [chat]);
  const report = fresh?.result ?? evidence?.result;
  const checkId = fresh?.checkId ?? evidence?.latest?.id;
  function ask(prompt: string) {
    setQuestion(prompt);
    setChatMounted(true);
    setChat(true);
  }
  async function uploadFile(selected: File) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await uploadChatFile(selected, setStage);
      setAttachment(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the file.");
    } finally {
      setBusy(false);
      setStage("");
      if (file.current) file.current.value = "";
    }
  }
  async function run(upload?: FileAttachment) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStage(
      upload
        ? "Saving your file and products…"
        : "Reading your saved products…",
    );
    abort.current = new AbortController();
    try {
      const response = await fetch(
        upload ? "/api/tariff/workspace/import" : "/api/tariff/check-now",
        {
          method: "POST",
          signal: abort.current.signal,
          ...(upload
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  uploadId: upload.uploadId,
                  tableIndex: upload.tableIndex,
                  mapping: upload.mapping,
                  basis: upload.basis,
                  mappingConfirmed: upload.mappingConfirmed,
                }),
              }
            : {}),
        },
      );
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw Error(data?.error ?? "The server could not start this check. Your saved inputs remain available; please retry.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let done = false;
      function consume(line: string) {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "error") throw Error(event.error);
        if (event.type === "progress") setStage(event.message);
        if (event.type === "done") {
          done = true;
          setAttachment(null);
          setFresh({ result: event.result, checkId: event.checkId });
        }
      }
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          pending += decoder.decode(item.value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          lines.forEach(consume);
        }
        consume(pending + decoder.decode());
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!done)
        throw Error(
          "The check stopped before completion. Previous results remain saved.",
        );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The check did not finish.",
      );
    } finally {
      setBusy(false);
      setStage("");
      await load().catch((e) => setError(e.message));
      if (file.current) file.current.value = "";
    }
  }
  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const csv = [
        "sku,name,hts_code,origin_country,input_basis,value_basis,annual_customs_value_usd,quantity,quantity_unit,standard_commercial,other_232_heading,metal_weight_percent,us_metal_qualification,uk_metal_qualification",
        [
          form.sku,
          form.name,
          form.hts,
          form.origin,
          "catalogue",
          form.value ? form.basis : "",
          form.value,
          form.quantity,
          form.unit,
          form.standard,
          form.other232,
          form.weight,
          form.usMetal,
          form.ukMetal,
        ]
          .map(quote)
          .join(","),
      ].join("\n");
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await response.json();
      if (!response.ok || data.summary?.rejected)
        throw Error(
          data.error ??
            data.summary?.rows?.find(
              (r: { outcome: string }) => r.outcome === "rejected",
            )?.reason ??
            "Product was not saved.",
        );
      setAdding(false);
      setForm(blank);
      await load();
      setFresh(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save product.");
    } finally {
      setSaving(false);
    }
  }
  const rows = products.map((p) => {
    const hts = codeFor(p);
    const origin = normalizeCountryCode(p.originCountry ?? "");
    const result = report?.rows.find(
      (r) =>
        r.product.sku === p.sku &&
        r.product.hts === hts &&
        r.product.origin === origin,
    );
    const change = report?.comparison?.rows.find(
      (r) => r.sku === p.sku && r.hts === hts && r.origin === origin,
    );
    const legal =
      report?.historicalComparison.candidateProducts?.some(
        (r) => r.sku === p.sku && r.hts === hts && r.origin === origin,
      ) ?? false;
    const unconfirmed =
      !!hts &&
      !p.classifications.some(
        (c) =>
          c.system === "hts" &&
          c.status === "approved" &&
          normalizeHtsCode(c.code) === hts,
      );
    const stale = (!!result&&report?.calculationVersion!==DUTY_CALCULATION_VERSION)||
      (!!result &&
        tariffFactsFingerprint([
          result.product.customsValue,
          result.product.valueBasis ??
            (result.product.history
              ? "historical"
              : result.product.inputBasis
                ? undefined
                : "annual"),
        ]) !==
          tariffFactsFingerprint([
            p.tariffInputs?.customsValue ?? null,
            p.tariffInputs?.valueBasis,
          ])) ||
      (!!result &&
        tariffFactsFingerprint([
          result.product.quantity ?? null,
          result.product.unit ?? null,
          result.product.remedyFacts ?? {},
          result.product.usmcaQualification ?? null,
        ]) !==
          tariffFactsFingerprint([
            p.tariffInputs?.quantity ?? null,
            p.tariffInputs?.unit ?? null,
            p.tariffInputs?.remedyFacts ?? {},
            p.tariffInputs?.usmcaQualification ?? null,
          ]));
    const review =
      !hts ||
      !origin ||
      unconfirmed ||
      !result ||
      stale ||
      !!result.error ||
      result.stack?.totalAmount == null;
    return {
      p,
      hts,
      origin,
      result,
      change,
      legal,
      review,
      stale,
      unconfirmed,
    };
  });
  const visible = rows.filter(
    (r) =>
      `${r.p.name} ${r.p.sku} ${r.hts ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "changed"
          ? r.change?.status === "changed" ||
            r.change?.status === "rate_changed" ||
            r.legal
          : r.review)),
  );
  const currentCatalogueCovered =
    !!report &&
    report.rows.length === rows.length &&
    rows.every((row) => row.result && !row.stale);
  const changed = rows.filter((r) => r.change?.status === "changed").length;
  const needs = rows.filter((r) => r.review).length;
  return (
    <div className={`main-scroll tariff-workspace${chat ? " has-chat" : ""}`}>
      <div className="workspace-content">
        <header className="workspace-header">
          <div>
            <span className="workspace-kicker">YOUR WORKSPACE</span>
            <h1>Tariff dashboard</h1>
            <p>Your products. Today’s rules. What it costs.</p>
          </div>
          <div className="workspace-actions">
            <button
              ref={chatButton}
              className="btn"
              onClick={() => {
                setChatMounted(true);
                setChat(true);
              }}
            >
              <MessageSquare size={16} />
              Ask Cante
            </button>
            <button
              className="btn btn-primary"
              disabled={
                loading ||
                busy ||
                !products.length ||
                evidence?.canWrite === false
              }
              onClick={() => void run()}
            >
              <RefreshCw size={16} className={busy ? "spin" : undefined} />
              {busy ? "Working…" : "Check for changes"}
            </button>
          </div>
        </header>
        <div className="workspace-checkline">
          <span className={`workspace-dot${busy ? " is-busy" : ""}`} />
          {busy ? (
            <span role="status">{stage}</span>
          ) : (
            <span>
              {evidence?.latest
                ? `Last refreshed ${new Date(evidence.latest.created_at).toLocaleString()} · ${evidence.status}`
                : evidence?.legacyChecks?.[0]
                  ? `Previous notice check ${new Date(evidence.legacyChecks[0].completed_at ?? evidence.legacyChecks[0].started_at).toLocaleDateString()}`
                  : "Ready for your first check"}
            </span>
          )}
          <span className="workspace-check-scope">
            Refreshes on click · compares saved checks
          </span>
        </div>
        <DailyMonitor />
        {evidence?.canWrite === false && (
          <p className="workspace-alert">Your account has view-only access.</p>
        )}
        {error && (
          <div className="workspace-alert" role="alert">
            {error}
            <button
              className="tariff-text-button"
              onClick={() => {
                setError(null);
                setLoading(true);
                void load()
                  .catch((e) => setError(e.message))
                  .finally(() => setLoading(false));
              }}
            >
              Reload saved data
            </button>
          </div>
        )}
        <section
          className="workspace-summary"
          aria-label="Latest check summary"
        >
          <div>
            <span>Saved products</span>
            <strong>{loading ? "—" : products.length}</strong>
            <small>One catalogue, shared with chat</small>
          </div>
          <div>
            <span>Calculated cost changes</span>
            <strong>
              {currentCatalogueCovered &&
              report?.comparison?.status === "compared"
                ? changed
                : "—"}
            </strong>
            <small>
              {currentCatalogueCovered &&
              report?.comparison?.status === "compared"
                ? "Comparable products only"
                : "A verified before / after check is needed"}
            </small>
          </div>
          <div>
            <span>Duty exposure difference</span>
            <strong>
              {money(
                currentCatalogueCovered
                  ? report?.comparison?.fullDutyDifference
                  : null,
              )}
            </strong>
            <small>
              {!currentCatalogueCovered && report
                ? "Refresh needed for the current catalogue"
                : (report?.valuationBasis ?? report?.basis) === "annual"
                  ? "At the same annual import values"
                  : (report?.valuationBasis ?? report?.basis) === "historical"
                    ? "On the same historical import values"
                    : "Customs values and comparable coverage required"}
            </small>
          </div>
          <div>
            <span>Needs attention</span>
            <strong>{loading ? "—" : needs}</strong>
            <small>Missing facts or review needed</small>
          </div>
        </section>
        <section
          className="workspace-products"
          aria-labelledby="workspace-products-title"
        >
          <div className="workspace-table-head">
            <div>
              <h2 id="workspace-products-title">Products</h2>
              <p>
                Select a product for its duty breakdown, changes and evidence.
              </p>
            </div>
            <div className="workspace-actions">
              <input
                ref={file}
                type="file"
                accept=".csv,.xlsx,.xlsm,.docx,.pdf"
                hidden
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) void uploadFile(selected);
                }}
              />
              <button
                className="btn"
                disabled={busy || evidence?.canWrite === false}
                onClick={() => file.current?.click()}
              >
                <Upload size={15} />
                Upload file
              </button>
              <button
                className="tariff-text-button"
                disabled={evidence?.canWrite === false}
                onClick={() => {
                  setForm(blank);
                  setAdding(!adding);
                }}
              >
                <Plus size={15} />
                Add product
              </button>
            </div>
          </div>
          {attachment && (
            <div className="workspace-upload-review">
              <FileColumnReview file={attachment} onChange={setAttachment} />
              <div className="workspace-actions">
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    (!attachment.mappingConfirmed &&
                      !attachment.tables?.[attachment.tableIndex ?? 0]?.ready)
                  }
                  onClick={() => void run(attachment)}
                >
                  Save products &amp; check
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => setAttachment(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {adding && (
            <form className="workspace-product-form" onSubmit={saveProduct}>
              <label>
                SKU
                <input
                  required
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </label>
              <label>
                Product name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                10-digit HTS
                <input
                  value={form.hts}
                  onChange={(e) => setForm({ ...form, hts: e.target.value })}
                />
              </label>
              <label>
                Origin (country code)
                <input
                  value={form.origin}
                  onChange={(e) => setForm({ ...form, origin: e.target.value })}
                />
              </label>
              <label>
                Customs value (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="Leave blank if unknown"
                />
              </label>
              <label>
                What does that value cover?
                <select
                  value={form.basis}
                  onChange={(e) => setForm({ ...form, basis: e.target.value })}
                >
                  <option value="annual">Annual imports</option>
                  <option value="historical">
                    Uploaded historical imports
                  </option>
                </select>
              </label>
              <details className="workspace-fact-fields">
                <summary>Shipment facts and qualifications</summary>
                <p>
                  Use shipment records. Leave unknown facts blank. These
                  declarations affect which duties apply.
                </p>
                <label>
                  Quantity for this customs value
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={form.quantity}
                    onChange={(e) =>
                      setForm({ ...form, quantity: e.target.value })
                    }
                  />
                </label>
                <label>
                  Quantity unit
                  <input
                    value={form.unit}
                    placeholder="Use the published unit, e.g. kg or No."
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </label>
                <label>
                  Ordinary commercial goods?
                  <select
                    value={form.standard}
                    onChange={(e) =>
                      setForm({ ...form, standard: e.target.value })
                    }
                  >
                    <option value="">Unknown</option>
                    <option value="true">Yes — confirmed from records</option>
                    <option value="false">No</option>
                  </select>
                </label>
                <label>
                  Other Section 232 sector treatment?
                  <select
                    value={form.other232}
                    onChange={(e) =>
                      setForm({ ...form, other232: e.target.value })
                    }
                  >
                    <option value="">Unknown</option>
                    <option value="none">
                      Confirmed: no other sector treatment
                    </option>
                    {form.other232 && form.other232 !== "none" && (
                      <option value={form.other232}>
                        {form.other232} — requires scope review
                      </option>
                    )}
                  </select>
                </label>
                <label>
                  Applicable metal by weight (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={form.weight}
                    onChange={(e) =>
                      setForm({ ...form, weight: e.target.value })
                    }
                  />
                </label>
                <label>
                  U.S. metal qualification?
                  <select
                    value={form.usMetal}
                    onChange={(e) =>
                      setForm({ ...form, usMetal: e.target.value })
                    }
                  >
                    <option value="">Unknown</option>
                    <option value="true">
                      Yes — qualification evidence reviewed
                    </option>
                    <option value="false">No</option>
                  </select>
                </label>
                <label>
                  UK metal qualification?
                  <select
                    value={form.ukMetal}
                    onChange={(e) =>
                      setForm({ ...form, ukMetal: e.target.value })
                    }
                  >
                    <option value="">Unknown</option>
                    <option value="true">
                      Yes — qualification evidence reviewed
                    </option>
                    <option value="false">No</option>
                  </select>
                </label>
              </details>
              <div className="workspace-actions">
                <button className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save product"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="workspace-toolbar">
            <div className="workspace-tabs" aria-label="Filter products">
              {(
                [
                  ["all", "All products"],
                  ["changed", "Changes"],
                  ["review", "Needs attention"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              aria-label="Search products"
              placeholder="Search name, SKU or HTS…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {loading ? (
            <p className="workspace-empty" role="status">
              Loading your saved products…
            </p>
          ) : !products.length ? (
            <div className="workspace-empty">
              <h3>Add your products once.</h3>
              <p>
                Upload a product or import CSV here, or attach it in chat. Both
                save to this catalogue.
              </p>
              <a href="/examples/products-template.csv" download>
                Download CSV template
              </a>
            </div>
          ) : !visible.length ? (
            <p className="workspace-empty">No products match this view.</p>
          ) : (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>HTS / origin</th>
                    <th>Current duty rate</th>
                    <th>Duty cost / change</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(
                    ({
                      p,
                      hts,
                      origin,
                      result,
                      change,
                      legal,
                      review,
                      stale,
                      unconfirmed,
                    }) => (
                      <ProductRow
                        key={p.id}
                        product={p}
                        hts={hts}
                        origin={origin}
                        result={result}
                        change={change}
                        legal={legal}
                        stale={stale}
                        unconfirmed={unconfirmed}
                        review={review}
                        open={expanded === p.id}
                        onToggle={() =>
                          setExpanded(expanded === p.id ? null : p.id)
                        }
                        onAsk={() =>
                          ask(
                            `Explain the tariff changes, current duty breakdown and missing facts for SKU ${p.sku}. Use our saved workspace checks and distinguish confirmed costs from unresolved amounts.`,
                          )
                        }
                        onEdit={() => {
                          setForm({
                            sku: p.sku,
                            name: p.name,
                            hts: hts ?? "",
                            origin,
                            value: String(p.tariffInputs?.customsValue ?? ""),
                            basis: p.tariffInputs?.valueBasis ?? "annual",
                            quantity: String(p.tariffInputs?.quantity ?? ""),
                            unit: p.tariffInputs?.unit ?? "",
                            standard: String(
                              p.tariffInputs?.remedyFacts?.standardCommercial ??
                                "",
                            ),
                            other232: String(
                              p.tariffInputs?.remedyFacts?.other232Heading ??
                                "",
                            ),
                            weight: String(
                              p.tariffInputs?.remedyFacts?.metalWeightPercent ??
                                "",
                            ),
                            usMetal: String(
                              p.tariffInputs?.remedyFacts
                                ?.usMetalQualification ?? "",
                            ),
                            ukMetal: String(
                              p.tariffInputs?.remedyFacts
                                ?.ukMetalQualification ?? "",
                            ),
                          });
                          setAdding(true);
                        }}
                      />
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <details className="workspace-evidence">
          <summary>
            Check history &amp; source evidence <ChevronDown size={15} />
          </summary>
          <p>
            Past checks stay saved. A published notice is a review lead until
            its applicability is established.
          </p>
          {evidence?.latest && (
            <p>
              <Link href={`/tariff/history?check=${evidence.latest.id}`}>
                Open saved input and evidence <ArrowUpRight size={13} />
              </Link>
              {!evidence.verified &&
                " · Saved execution is unverified; dollar baselines are withheld."}
            </p>
          )}
          {report && (
            <>
              <p>{report.comparison?.reason}</p>
              <ul>
                {report.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>{" "}
                    · {s.status}
                    {s.error ? ` · ${s.error}` : ""}
                  </li>
                ))}
              </ul>
              <details>
                <summary>What changed in the published rules</summary>
                <p>
                  {report.historicalComparison.previous?.description ??
                    "Previous revision unavailable"}{" "}
                  →{" "}
                  {report.historicalComparison.current?.description ??
                    "Current revision unavailable"}
                </p>
                {report.historicalComparison.issues?.map((issue, i) => (
                  <p key={i}>{issue}</p>
                ))}
                {report.historicalComparison.legalChanges.map((change, i) => (
                  <div className="workspace-rule-change" key={i}>
                    <h3>Chapter 99 · U.S. note {change.note}</h3>
                    <div>
                      <section>
                        <small>Previous published text</small>
                        <p>{change.before}</p>
                      </section>
                      <section>
                        <small>Current published text</small>
                        <p>{change.after}</p>
                      </section>
                    </div>
                    {change.kind === "extensive_text_change" && (
                      <p>
                        Excerpts show part of this change. Review the retained
                        source documents.
                      </p>
                    )}
                  </div>
                ))}
                {report.historicalComparison.legalChanges.length === 0 && (
                  <p>
                    No legal-note text differences were established in the
                    captured comparison. Review its coverage before treating
                    that as no change.
                  </p>
                )}
              </details>
              <details>
                <summary>Coverage and limitations</summary>
                <ul>
                  {report.coverageNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
          {evidence?.legacyError && <p role="alert">{evidence.legacyError}</p>}
          {!!evidence?.legacyChecks?.length && (
            <>
              <h3>Earlier official-notice checks</h3>
              {evidence.legacyChecks.map((r) => (
                <p key={r.id}>
                  {new Date(r.completed_at ?? r.started_at).toLocaleString()} ·{" "}
                  {r.status}
                </p>
              ))}
              {evidence.legacyFindings?.map((f) => (
                <details key={f.id}>
                  <summary>{f.title}</summary>
                  <p>{f.summary_en}</p>
                  {f.url && f.url.startsWith("https://") && (
                    <a href={f.url} target="_blank" rel="noreferrer">
                      Retained official notice
                    </a>
                  )}
                </details>
              ))}
              <p>
                These notice checks are retained separately from verified
                numerical duty baselines.
              </p>
            </>
          )}
          <Link href="/tariff/history">All saved checks</Link>
          {canReviewRules && (
            <>
              {" "}
              · <Link href="/tariff/rules">Rule review</Link>
            </>
          )}
        </details>
        <footer className="workspace-footer">
          Checks use current official sources and supported rules. Unknown facts
          and unsupported duties remain visible.
        </footer>
      </div>
      {chatMounted && (
        <aside
          hidden={!chat}
          className="workspace-chat"
          aria-label="Ask Cante about your dashboard"
        >
          <div className="workspace-chat-head">
            <div>
              <strong>Ask Cante</strong>
              <span>Same products. Same saved checks.</span>
            </div>
            <button
              className="btn-icon"
              aria-label="Close chat"
              onClick={() => {
                setChat(false);
                chatButton.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          </div>
          <ChatPanel
            customerId={customerId}
            initialConversationId={null}
            initialCountry="United States"
            embedded
            initialPrompt={question}
          />
        </aside>
      )}
    </div>
  );
}
function ProductRow({
  product: p,
  hts,
  origin,
  result,
  change,
  legal,
  review,
  stale,
  unconfirmed,
  open,
  onToggle,
  onAsk,
  onEdit,
}: {
  product: Product;
  hts: string | null;
  origin: string;
  result?: LiveCheckResult["rows"][number];
  change?: NonNullable<LiveCheckResult["comparison"]>["rows"][number];
  legal: boolean;
  review: boolean;
  stale: boolean;
  unconfirmed: boolean;
  open: boolean;
  onToggle: () => void;
  onAsk: () => void;
  onEdit: () => void;
}) {
  const issue = !hts
    ? "Add one exact HTS code"
    : !origin
      ? "Add country of origin"
      : stale
        ? "Product facts changed — refresh needed"
        : (result?.error ??
          result?.stack?.unresolvedMeasures[0] ??
          (!result
            ? "Run a check to see current duties"
            : unconfirmed
              ? "HTS classification needs confirmation"
              : null));
  return (
    <>
      <tr className={open ? "is-open" : ""}>
        <td>
          <button
            className="workspace-product-name"
            aria-expanded={open}
            onClick={onToggle}
          >
            {p.name}
          </button>
          <small>{p.sku}</small>
          {(p.tariffInputs?.fictional || result?.product.fictional) && (
            <small className="workspace-inline-note">
              Fictional test input
            </small>
          )}
        </td>
        <td>
          {hts ?? "HTS needed"}
          <small>{origin || "Origin needed"}</small>
        </td>
        <td>{!stale && result ? rate(result.stack?.totalRatePercent) : "—"}</td>
        <td>
          {!stale && result ? money(result.stack?.totalAmount) : "—"}
          <small>
            {!stale && change?.difference != null
              ? `${change.difference > 0 ? "+" : ""}${money(change.difference)} vs prior check`
              : p.tariffInputs?.valueBasis === "annual"
                ? "At saved annual value"
                : p.tariffInputs?.valueBasis === "historical"
                  ? "At saved historical value"
                  : "Customs value needed"}
          </small>
        </td>
        <td>
          <span
            className={`workspace-status${review || legal ? " needs-review" : ""}`}
          >
            {stale
              ? "Refresh needed"
              : change?.status === "changed"
                ? "Cost changed"
                : change?.status === "rate_changed"
                  ? "Rate changed"
                  : legal
                    ? "Rule change to review"
                    : review
                      ? "Needs attention"
                      : "Calculated"}
          </span>
        </td>
        <td>
          <button
            className="btn-icon"
            aria-label={`${open ? "Hide" : "Show"} details for ${p.sku}`}
            aria-expanded={open}
            onClick={onToggle}
          >
            <ChevronDown size={16} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="workspace-detail-row">
          <td colSpan={6}>
            <div className="workspace-product-detail">
              <div>
                <h3>{p.name}</h3>
                {issue && <p className="workspace-inline-note">{issue}</p>}
                {unconfirmed && (
                  <p className="muted">
                    HTS supplied by the workspace; classification is not
                    independently confirmed.
                  </p>
                )}
                {stale ? (
                  <p>
                    Run “Check for changes” to recalculate this product using
                    its saved facts.
                  </p>
                ) : (
                  result?.stack?.components.map((c, i) => (
                    <div className="workspace-duty-line" key={i}>
                      <strong>{c.label}</strong>
                      <span>{money(c.amount)}</span>
                      <p>{c.explanation}</p>
                      {c.citation.map((citation, j) => (
                        <small key={j}>{citation}</small>
                      ))}
                    </div>
                  ))
                )}
                {!stale && result?.stack?.unresolvedMeasures.length ? (
                  <ul>
                    {result.stack.unresolvedMeasures.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                ) : null}
                {change && (
                  <p>
                    {change.rateDifference != null
                      ? `Duty rate: ${rate(change.rateBefore)} → ${rate(change.rateAfter)}. `
                      : ""}
                    {change.reason}
                  </p>
                )}
                {hts && (
                  <a
                    href={`https://hts.usitc.gov/search?query=${encodeURIComponent(hts)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official HTS evidence ↗
                  </a>
                )}
              </div>
              <div className="workspace-detail-actions">
                <button className="btn" onClick={onAsk}>
                  <MessageSquare size={15} />
                  Ask about this product
                </button>
                <button className="tariff-text-button" onClick={onEdit}>
                  Edit saved facts
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
