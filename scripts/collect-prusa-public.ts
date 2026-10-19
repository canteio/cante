/** Public source research only: no tenant writes, LLM calls or inferred origins/values. */
import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { parseStackRequestRows } from "../lib/tariff/bulk";

const out = "scripts/test-fixtures/prusa-public";
const raw = "raw/prusa-public";
const source = "https://help.prusa3d.com/article/vat-value-added-tax-customs-fees_1505";
const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
async function fetchText(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw Error(`Source HTTP ${response.status}: ${url}`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 3_000_000) throw Error(`Source exceeds bound: ${url}`);
  return body;
}
async function main() {
  await mkdir(out, { recursive: true }); await mkdir(raw, { recursive: true });
  const body = await fetchText(source); const retrievedAt = new Date().toISOString();
  await writeFile(`${raw}/published-customs-page.html`, body);
  const $ = load(body);
  const published: { category: string; publishedCode: string }[] = [];
  $("table").each((_, table) => {
    if (!/Product Type/.test($(table).text()) || !/HS code/.test($(table).text())) return;
    $(table).find("tr").each((_, tr) => {
      const values = $(tr).find("td").map((_, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
      if (values.length === 2 && /^\d{6,10}$/.test(values[1])) published.push({ category: values[0], publishedCode: values[1] });
    });
  });
  assert.ok(published.length > 0, "Published code table missing; never substitute examples");
  const candidates: Record<string, unknown>[] = [];
  for (const item of published) {
    // Eight-digit published national codes are not silently padded to U.S. codes.
    const prefix = item.publishedCode.slice(0, 6);
    const url = `https://hts.usitc.gov/reststop/search?keyword=${prefix}`;
    try {
      const text = await fetchText(url); const rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw Error("Unexpected USITC response shape");
      await writeFile(`${raw}/usitc-${prefix}.json`, text);
      const exact = rows.filter(r => String(r.htsno ?? "").replace(/\D/g, "") === item.publishedCode && item.publishedCode.length === 10);
      const statistical = rows.filter(r => { const code = String(r.htsno ?? "").replace(/\D/g, ""); return code.length === 10 && code.startsWith(prefix); });
      candidates.push({ ...item, source, retrievedAt, lookupUrl: url, lookedUpAt: new Date().toISOString(), status: exact.length ? "exact_code_exists_in_us_schedule_not_classification_approval" : "requires_us_classification_review", exactPublishedCodeMatches: exact, usStatisticalCandidates: statistical, origin: null, customsValue: null, dutyPaid: null });
    } catch (e) {
      candidates.push({ ...item, source, retrievedAt, lookupUrl: url, status: "us_schedule_fetch_failed", error: e instanceof Error ? e.message : String(e), origin: null, customsValue: null, dutyPaid: null });
    }
  }
  const csv = ["product_category,published_hs_code,hts_code,country_of_origin,import_date,value,paid_duty,source_url,retrieved_at", ...published.map(item => [item.category, item.publishedCode, "", "", "", "", "", source, retrievedAt].map(cell).join(","))].join("\r\n") + "\r\n";
  await writeFile(`${out}/published-codes.csv`, csv);
  await writeFile(`${out}/us-schedule-candidates.json`, JSON.stringify(candidates, null, 2));
  const parsed = parseStackRequestRows(csv);
  assert.equal(parsed.rows.length, 0); assert.equal(parsed.errors.length, published.length);
  const report = { source, retrievedAt, sha256: createHash("sha256").update(body).digest("hex"), publishedCategories: published.length, successfulUsScheduleLookups: candidates.filter(c => c.status !== "us_schedule_fetch_failed").length, exactPublishedTenDigitUsMatches: candidates.filter(c => c.status === "exact_code_exists_in_us_schedule_not_classification_approval").length, incompleteRowsRejected: parsed.errors.length, tariffAccuracyVerified: false, tenantWrites: 0, llmCalls: 0, limitations: ["Category codes, not SKU-level company import entries", "USITC candidates are not approved product classifications", "Origin, legal entry date, customs value and paid duty were not supplied", "No company-level historical audit can be validated from this source"] };
  await writeFile(`${out}/verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
