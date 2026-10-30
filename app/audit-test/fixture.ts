import { readFileSync } from "node:fs";
import { z } from "zod";
import { auditTable, parseAudit, suggestMapping, validateMapping } from "@/app/api/audits/input";
import { defaultOptions, factDecisionSchema, optionsSchema, type FactDecision, type RuleBundle } from "@/app/api/audits/model";
import { evaluateAuditEntry, summarizeAudit } from "@/app/api/audits/engine";
import { isStrictIsoDate } from "@/lib/tariff/date";
import { exportAudit } from "@/app/api/audits/store";

// Development-only, stateless fixtures. This module is never imported by an audit
// worker or workspace API. No draft is approved or inserted into the database.
const directory = "scripts/test-fixtures/historical-audits/";
export const sampleCsv = () => readFileSync(directory + "entries.csv", "utf8");
const fixtureOptions = { ...defaultOptions, currencyUsd: true, dutiesOnly: true, ordinaryConsumption: true };
const requestSchema = z.object({
  action: z.enum(["preview", "run"]), csv: z.string().max(2 * 1024 * 1024),
  filename: z.string().min(1).max(200), mapping: z.unknown().optional(), options: optionsSchema,
  reviews: z.array(factDecisionSchema).max(100).default([]),
}).strict();
export function localAuditTestAvailable(env:Readonly<{NODE_ENV?:string;VERCEL?:string}>=process.env) {
  return env.NODE_ENV === "development" && !env.VERCEL;
}
export function runAuditFixture(input: unknown) {
  const request = requestSchema.parse(input);
  if (Buffer.byteLength(request.csv) > 2 * 1024 * 1024) throw Error("Use a CSV up to 2 MiB.");
  const table = auditTable(request.csv);
  const mapping = request.mapping === undefined ? suggestMapping(table.headers) : validateMapping(table.headers, request.mapping);
  const entries = parseAudit(request.csv, mapping, request.options);
  const original = sampleCsv();
  const fixtureEntries = parseAudit(original, suggestMapping(auditTable(original).headers), fixtureOptions);
  const products = [...new Set(fixtureEntries.map(e => e.sku))].map(sku => ({ id: `synthetic:${sku}`, sku, name: "Fictional test product" }));
  const productFor = (sku:string) => products.find(p => p.sku === sku)?.id ?? null;
  const preview = { headers: table.headers, filename: request.filename, mapping, entries: entries.map(e => ({ ...e, productId: productFor(e.sku) })), valid: entries.filter(e => !e.errors.length).length };
  if (request.action === "preview") return { preview, products };

  const bundle = JSON.parse(readFileSync(directory + "rules.json", "utf8")) as RuleBundle;
  // Explicitly remove the fixture's simulated approval. Only the engine's
  // synthetic-test branch may execute this draft; the production branch rejects it.
  bundle.status = "draft"; bundle.approved_by = null; bundle.approved_at = null;
  if (bundle.definition.synthetic !== true) throw Error("Only fictional rules can run here.");
  const fixtureDecisions = JSON.parse(readFileSync(directory + "decisions.json", "utf8")) as FactDecision[];
  const decisions:FactDecision[] = [];
  for (const entry of entries) {
    // Test qualification facts belong only to an unchanged known fixture row.
    // A row number or SKU alone must never invent evidence for an arbitrary upload.
    const match = fixtureEntries.find(e => JSON.stringify(e.raw) === JSON.stringify(entry.raw));
    if (match) for (const decision of fixtureDecisions.filter(d => d.row === match.row)) decisions.push({ ...decision, row: entry.row, revision: 0 });
  }
  let revision = 0;
  const linkedProduct = (entry:typeof entries[number]) => {
    const selected = decisions.filter(d => d.row === entry.row && d.kind === "confirm_facts" && d.productId && d.validFrom! <= entry.date && entry.date < d.validBefore!).at(-1);
    return selected?.productId ?? productFor(entry.sku);
  };
  for (const decision of request.reviews) {
    const entry = entries.find(e => e.row === decision.row);
    if (!entry || decision.kind === "rules_updated") throw Error("Select a line in this test audit.");
    if (decision.productId && !products.some(p => p.id === decision.productId)) throw Error("Select a fictional test product.");
    if (decision.kind === "confirm_facts") {
      if (!decision.evidence.length || !decision.validFrom || !decision.validBefore || !isStrictIsoDate(decision.validFrom) || !isStrictIsoDate(decision.validBefore) || decision.validBefore <= decision.validFrom) throw Error("Supply evidence references and a valid date interval.");
      revision++;
    }
    if (decision.kind === "resolved" && evaluateAuditEntry(entry, [bundle], linkedProduct(entry), decisions, true).expected === null) throw Error("An unresolved calculation cannot be marked resolved.");
    decisions.push({ ...decision, id: `test-review-${decisions.length + 1}`, revision });
  }
  const rows = entries.map(entry => ({ entry, result: evaluateAuditEntry(entry, [bundle], linkedProduct(entry), decisions, true) }));
  // Keep even explanations explicit about the fictional, unapproved basis.
  for (const { result } of rows) {
    for (const finding of result.findings) finding.reason = finding.reason.replace(/human-approved|approved historical|approved snapshot/g, "fictional test");
    for (const component of result.components) component.explanation = "SYNTHETIC, UNAPPROVED TEST RULE. " + component.explanation.replace("Approved historical rate", "Fictional historical rate");
  }
  const summary = summarizeAudit(rows.map(r => r.result));
  const detail = {
    mode: "synthetic_test" as const,
    batch: { id: "test-session", filename: request.filename, created_at: new Date().toISOString(), status: "completed", revision, progress: entries.length, summary },
    rows, decisions, history: [], verified: true, stale: false, resultRevision: revision, summary, canWrite: true,
  };
  // Reuse the real report writer; no reader/worker proof or customer storage is
  // implied by this ephemeral screen's render-ready `verified` flag.
  const csv = exportAudit(detail)
    .replaceAll("Potential duty discrepancies, not guaranteed refunds or legal conclusions. Unsupported scope remains unresolved.", "SYNTHETIC TEST ONLY. Fictional, unapproved rules; not customer findings or refund entitlements.");
  return { preview, products, detail, csv };
}
