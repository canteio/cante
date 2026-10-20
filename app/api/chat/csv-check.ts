import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { beginLiveCheckArchive, finishLiveCheckArchive, failLiveCheckArchive, readLiveCheckArchive } from "@/lib/tariff/business-impact-store";
import { LIVE_MAX_BYTES, parseLiveProducts, runLiveCheck, type LiveCheckResult, type LiveSource } from "@/app/api/tariff/live-check/check";
import remedyContract from "@/config/tariff-remedy-contract.json";
import { parseCsv } from "@/lib/catalogue/csv";
import { easternIsoDate } from "@/lib/tariff/date";

export type CsvAttachment = { filename: string; format: string; text: string; originalCsv?: string };
export const isCsvAttachment = (file: CsvAttachment) => file.format === "csv" || /\.csv$/i.test(file.filename);
type Progress = (message: string) => void;
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
type SavedCheck = NonNullable<Awaited<ReturnType<typeof readLiveCheckArchive>>>;
type ChatRecheck = ReturnType<typeof compareSavedChecks> & { sourceCheckId: string; checkedDay: string; todayNotices: LiveCheckResult["notices"]; todayNoticesOmitted: number };
type ChatResult = LiveCheckResult & { chatRecheck?: ChatRecheck };

/** A numerical comparison, not a conclusion that every relevant law is unchanged. */
export function compareSavedChecks(previous: LiveCheckResult | null, current: LiveCheckResult) {
  const unavailable = { status: "unavailable" as "compared" | "unavailable", reason: "No completed previous check is available for comparison.", beforeCheckedAt: previous?.checkedAt ?? null, changedProducts: null as number | null, fullDutyDifference: null as number | null, baseDutyDifference: null as number | null, topChanges: [] as { sku: string; hts: string; origin: string; before: number; after: number; difference: number }[] };
  if (!previous || !Array.isArray(previous.rows) || previous.rows.some(row => !row?.product || typeof row.product.sku !== "string" || typeof row.product.hts !== "string" || typeof row.product.origin !== "string")) return unavailable;
  if (!previous.consistentRevision || !current.consistentRevision) return { ...unavailable, reason: "A stable government revision was not established for both checks." };
  if (previous.basis !== current.basis || previous.rows.length !== current.rows.length) return { ...unavailable, reason: "The checks do not have the same calculation basis or product groups." };
  const key = (row: LiveCheckResult["rows"][number]) => JSON.stringify([row.product.sku, row.product.hts, row.product.origin]);
  const old = new Map(previous.rows.map(row => [key(row), row]));
  const identity = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  if (old.size !== previous.rows.length || new Set(current.rows.map(key)).size !== current.rows.length || current.rows.some(row => identity(old.get(key(row))?.product) !== identity(row.product))) {
    return { ...unavailable, reason: "Uploaded values, products or qualification facts differ; no duty difference is claimed." };
  }
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  let full = valid(previous.totalDuty) && valid(current.totalDuty); let base = true; let baseCents = 0;
  const changes: typeof unavailable.topChanges = [];
  for (const row of current.rows) {
    const before = old.get(key(row))!;
    const a = before.stack?.totalAmount, b = row.stack?.totalAmount;
    if (!valid(a) || !valid(b) || before.error || row.error || before.verification?.status === "failed" || row.verification?.status === "failed") full = false;
    else if (Math.round(a * 100) !== Math.round(b * 100)) changes.push({ sku: row.product.sku, hts: row.product.hts, origin: row.product.origin, before: a, after: b, difference: (Math.round(b * 100) - Math.round(a * 100)) / 100 });
    const oldBase = before.quote?.computation.amount, newBase = row.quote?.computation.amount;
    if (!valid(oldBase) || !valid(newBase) || before.quote?.column !== row.quote?.column || before.verification?.status === "failed" || row.verification?.status === "failed") base = false;
    else baseCents += Math.round(newBase * 100) - Math.round(oldBase * 100);
  }
  return { ...unavailable, status: "compared" as const, reason: full ? "Same inputs and qualification facts; numerical duty differences are not an independent legal-applicability decision." : "Full duty difference is unresolved; incomplete amounts are never treated as zero.", changedProducts: full ? changes.length : null, fullDutyDifference: full ? (Math.round(current.totalDuty! * 100) - Math.round(previous.totalDuty! * 100)) / 100 : null, baseDutyDifference: base ? baseCents / 100 : null, topChanges: full ? changes.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.sku.localeCompare(b.sku)).slice(0, 5) : [] };
}

function noticeDay(value: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed) : null;
}

/** Every row remains available in the archive; prompts use a bounded structured view. */
export function summarizeChatCheck(result: ChatResult) {
  return {
    checkedAt: result.checkedAt, basis: result.basis, products: result.products,
    totalDuty: result.totalDuty, unresolvedProducts: result.unresolvedProducts,
    consistentRevision: result.consistentRevision, revision: result.revisionAfter,
    coverageNotes: result.coverageNotes,
    chatRecheck: result.chatRecheck,
    rows: result.rows.map(row => ({
      sku: row.product.sku, hts: row.product.hts, origin: row.product.origin,
      customsValue: row.product.customsValue, quantity: row.product.quantity, unit: row.product.unit,
      fictional: row.product.fictional, remedyFacts: row.product.remedyFacts,
      history: row.product.history ? { entries: row.product.history.entries.length, startDate: row.product.history.startDate, endDate: row.product.history.endDate, paidDuty: row.product.history.paidDuty } : null,
      totalDuty: row.stack?.totalAmount ?? null,
      components: row.stack?.components.map(c => ({ measure: c.measureId, rate: c.ratePercent, amount: c.amount, citation: c.citation?.slice(0, 500) })),
      missingFacts: row.stack?.unresolvedMeasures.map(text => text.slice(0, 500)), error: row.error,
    })),
    previousRules: { status: result.historicalComparison.status, issues: result.historicalComparison.issues, candidateSkus: result.historicalComparison.candidateSkus, scope: result.historicalComparison.scope, changes: result.historicalComparison.legalChanges.slice(0, 5).map(change => ({ ...change, before: change.before?.slice(0, 1000), after: change.after?.slice(0, 1000) })), changesOmitted: Math.max(0, result.historicalComparison.legalChanges.length - 5), modifyingDocuments: result.historicalComparison.modifyingDocuments },
    sources: result.sources.map(s => ({ url: s.url, status: s.status, error: s.error })),
    notices: result.notices.slice(0, 10), noticesOmitted: Math.max(0, result.notices.length - 10),
  };
}

export async function checkChatCsv(customerId: string, file: CsvAttachment, signal: AbortSignal, progress: Progress, baseline?: SavedCheck) {
  const workspace = await getAuthenticatedWorkspace(customerId);
  if (!workspace || workspace.customerId !== customerId) throw Error("No workspace access.");
  if (workspace.role === "viewer") return { checkId: null, markdown: "This account has read-only access. Ask a workspace member to upload and check this CSV.", context: null };
  if (typeof file.originalCsv !== "string") return { checkId: null, markdown: "Please attach this CSV again. Its complete original file was not supplied, so I have not saved or checked a truncated preview.", context: null };
  const raw = file.originalCsv;
  if (!raw.trim() || Buffer.byteLength(raw) > LIVE_MAX_BYTES || Buffer.from(raw).toString("utf8") !== raw) return { checkId: null, markdown: "Upload a nonempty UTF-8 CSV under 1 MB. This file was not saved or checked.", context: null };
  const db = await createRequestClient();
  let checkId: string;
  try {
    progress("Saving your original CSV…");
    checkId = await beginLiveCheckArchive(db, customerId, raw, file.filename, baseline?.record.confirmations ?? {}, {
      contract: remedyContract, workflow: baseline ? "chat-csv-recheck-v1" : "chat-csv-check-v1",
      ...(baseline ? { sourceCheckId: baseline.record.id } : {}),
      build: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CANTE_BUILD_REVISION ?? "unversioned-working-tree",
    });
  } catch {
    return { checkId: null, markdown: "I couldn’t save your original CSV. No tariff check ran; please try again.", context: null };
  }
  const link = `[Saved CSV and check](/tariff/history?check=${checkId})`;
  let sources: LiveSource[] = [];
  try {
    // Importer declarations come only from the CSV, never from a model guess.
    const products = parseLiveProducts(raw).map(product => ({ ...product, remedyFacts: {
      ...(baseline?.record.confirmations?.standardCommercial === true ? { standardCommercial: true } : {}),
      ...(baseline?.record.confirmations?.noOther232 === true ? { other232Heading: "none" } : {}),
      ...product.remedyFacts,
    } }));
    // Preserve absence rather than adding an empty object to the product identity.
    for (const product of products) if (!Object.keys(product.remedyFacts).length) delete (product as { remedyFacts?: unknown }).remedyFacts;
    const result: ChatResult = await runLiveCheck(products, signal, progress, captured => { sources = captured; });
    signal.throwIfAborted();
    if (baseline) {
      const today = easternIsoDate();
      const todayNotices = result.notices.filter(notice => noticeDay(notice.date) === today);
      result.chatRecheck = { ...compareSavedChecks(baseline.result, result), sourceCheckId: baseline.record.id, checkedDay: today, todayNotices: todayNotices.slice(0, 10), todayNoticesOmitted: Math.max(0, todayNotices.length - 10) };
    }
    progress("Saving the government evidence and results…");
    await finishLiveCheckArchive(db, customerId, checkId, result);
    const amount = result.totalDuty === null ? "A complete duty total is unavailable." : `${result.basis === "annual" ? "Annual duty at today’s rules" : "Duty at today’s rules on the uploaded historical values"}: **${money(result.totalDuty)}**.`;
    const changes = result.historicalComparison.status === "compared"
      ? `${result.historicalComparison.candidateSkus.length} product groups flagged by the previous/current rule comparison for review.`
      : "The previous/current rule comparison is unavailable; no no-change conclusion is claimed.";
    const first = result.rows.find(row => row.error || !row.stack || row.stack.totalAmount === null);
    const reason = first?.error ?? first?.stack?.unresolvedMeasures[0];
    const next = first && reason ? `\n\nNext: **${first.product.sku}** — ${reason.slice(0, 240)}` : "";
    const inputLabel = result.rows.some(row => row.product.fictional) ? "**Fictional/demo inputs.** Government sources are live; product facts are test assumptions.\n\n" : "";
    let markdown = `${inputLabel}Saved your original CSV and checked **${result.products} product group${result.products === 1 ? "" : "s"}** against official tariff sources.\n\n${amount} **${result.unresolvedProducts} ${result.unresolvedProducts === 1 ? "needs" : "need"} review.** ${changes}${next}\n\n${link}\n\nThese are on-demand checks with partial legal coverage, not automatic ongoing monitoring or confirmation that your classifications are correct.`;
    if (result.chatRecheck) {
      const comparison = result.chatRecheck;
      const difference = comparison.fullDutyDifference === null ? "A complete duty difference from your last check is unavailable." : `Duty difference from your last check: **${money(comparison.fullDutyDifference)}${result.basis === "annual" ? "/year" : " on the same historical values"}** across **${comparison.changedProducts} changed product groups**.`;
      const base = comparison.baseDutyDifference === null ? "" : ` Base-duty difference alone: ${money(comparison.baseDutyDifference)}.`;
      const headlines = comparison.todayNotices.slice(0, 3).map(notice => `- [${notice.title.replace(/[\[\]\\\r\n]/g, " ")}](${notice.url})`).join("\n");
      const news = headlines ? `Today’s captured tariff publications — applicability to your products is not confirmed:\n${headlines}` : "No publications dated today appeared in the captured feeds. This is bounded feed coverage, not proof that nothing changed.";
      const failures = result.sources.filter(source => source.status === "failed").length;
      markdown = `${inputLabel}Refreshed **${result.products} product groups** from **${baseline!.record.filename}** using current official tariff sources.\n\n${difference}${base} **${result.unresolvedProducts} need review.**${next}\n\n${news}${failures ? `\n\n${failures} source fetches failed; coverage is incomplete.` : ""}\n\n${link}\n\nSaved qualification declarations were reused; correct any changed facts before relying on this. Classifications and legal scope still need review. This tariff check does not establish that all compliance rules are unchanged.`;
    }
    return { checkId, markdown, context: summarizeChatCheck(result) };
  } catch (failure) {
    const reason = signal.aborted ? "The check was interrupted." : failure instanceof Error ? failure.message : "The check failed.";
    let status = "The failure was recorded.";
    try { await failLiveCheckArchive(db, customerId, checkId, reason, sources); }
    catch { status = "The final status could not be saved; the check remains incomplete."; }
    return { checkId, markdown: `Your original CSV is saved, but the check could not finish: ${reason}\n\n${status} No complete result is claimed. ${link}\n\n[CSV template](/examples/live-check-template.csv)`, context: { error: reason } };
  }
}

/** Latest workspace CSV, including an invalid/incomplete latest upload: never silently use an older one. */
export async function recheckLatestChatCsv(customerId: string, signal: AbortSignal, progress: Progress) {
  const workspace = await getAuthenticatedWorkspace(customerId);
  if (!workspace || workspace.customerId !== customerId) throw Error("No workspace access.");
  if (workspace.role === "viewer") return { checkId: null, markdown: "This account has read-only access. Ask a workspace member to run a fresh tariff check.", context: null };
  let saved: SavedCheck;
  try {
    const db = await createRequestClient();
    progress("Finding your latest saved CSV…");
    const { data, error } = await db.from("tariff_check_records").select("id").eq("customer_id", customerId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
    if (error) throw error;
    if (!data?.length) return { checkId: null, markdown: "Upload your product or import CSV first so I can check current tariff rules against your own products. Include SKU, 10-digit HTS, origin and customs value. [CSV template](/examples/live-check-template.csv)", context: null };
    const archive = await readLiveCheckArchive(db, customerId, data[0].id);
    if (!archive) throw Error("Saved CSV unavailable.");
    saved = archive;
  } catch {
    return { checkId: null, markdown: "I couldn’t read or verify your saved CSV. No fresh tariff check ran; please try again. I have not substituted general news or a sample dataset.", context: null };
  }
  return checkChatCsv(customerId, { filename: saved.record.filename, format: "csv", text: "", originalCsv: saved.record.input_csv }, signal, progress, saved);
}

/** Read saved checks in new conversations too, with tenant scoping and honest limits. */
export async function readChatCsvContext(customerId: string, question = "") {
  try {
    const db = await createRequestClient();
    const { data, error } = await db.from("tariff_check_records").select("id,filename,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(4);
    if (error) throw error;
    const checks = [];
    for (const record of (data ?? []).slice(0, 3)) {
      try {
        const saved = await readLiveCheckArchive(db, customerId, record.id);
        if (!saved) throw Error("Check unavailable.");
        let uploadedFields: unknown;
        try {
          const table = parseCsv(saved.record.input_csv, { columns: 30, rawRows: 6002, cellCharacters: 500 }, true);
          const asked = question.toLowerCase();
          const matches = table.rows.filter(row => [row.sku, row.entry_id].some(value => value && asked.includes(value.toLowerCase())));
          const selected = matches.length ? matches : table.rows;
          const excerpt: Record<string, string>[] = []; let bytes = 0;
          for (const row of selected.slice(0, 20)) {
            const preview = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value.slice(0, 200)]));
            bytes += JSON.stringify(preview).length; if (bytes > 6000) break;
            excerpt.push(preview);
          }
          uploadedFields = { rows: excerpt, shown: excerpt.length, totalRows: table.rows.length, omittedRows: table.rows.length - excerpt.length, excerptLimits: "At most twenty rows and 6,000 characters; individual fields capped at 200 characters. Complete original is saved in Check history.", selection: matches.length ? "SKU/entry identifiers mentioned in the question" : "First original rows" };
        } catch { uploadedFields = { preview: saved.record.input_csv.slice(0, 6000), truncated: saved.record.input_csv.length > 6000, error: "Could not parse original fields within chat limits." }; }
        let data: unknown = saved.result ? summarizeChatCheck(saved.result) : { status: saved.events.some(e => e.kind === "failed") ? "failed" : "incomplete", decisions: saved.events.filter(e => e.kind === "failed").map(e => JSON.parse(e.payload_text).report) };
        if (saved.result && JSON.stringify(data).length > 30_000) {
      data = { checkedAt: saved.result.checkedAt, basis: saved.result.basis, totalDuty: saved.result.totalDuty, consistentRevision: saved.result.consistentRevision, unresolvedProducts: saved.result.unresolvedProducts, coverageNotes: saved.result.coverageNotes, chatRecheck: (saved.result as ChatResult).chatRecheck, rows: saved.result.rows.map(row => ({ sku: row.product.sku, hts: row.product.hts, origin: row.product.origin, customsValue: row.product.customsValue, totalDuty: row.stack?.totalAmount ?? null, missingFact: row.stack?.unresolvedMeasures[0]?.slice(0, 120), error: row.error })), detailLimit: "Detailed rule/source context exceeds the chat budget. All product groups are listed; full rule evidence remains in the saved check." };
        }
        checks.push({ id: record.id, filename: record.filename, createdAt: record.created_at, link: `/tariff/history?check=${record.id}`, uploadedFields, data });
      } catch { checks.push({ id: record.id, status: "unavailable", error: "Could not read or verify this saved check." }); }
    }
    return { status: "loaded", checks, olderChecksOmitted: (data?.length ?? 0) > 3, scope: "Latest three workspace checks, not every uploaded file. Original CSVs and full evidence remain in Check history. Saved checks describe their capture time, not a fresh lookup." };
  } catch { return { status: "unavailable", checks: [], error: "Saved CSV/check context could not be read; do not assume no uploads exist." }; }
}
