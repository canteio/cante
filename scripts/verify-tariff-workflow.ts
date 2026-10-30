/** Read-only official-source check of labelled public fixtures. No models,
 * delivery, schedules, or customer/database writes. Raw evidence stays ignored. */
import "./load-env";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseLiveProducts, runLiveCheck } from "../app/api/tariff/live-check/check";
async function main() {
  const products = parseLiveProducts(await readFile("public/examples/tariff-workflow-test.csv", "utf8"));
  assert(products.every(p => p.fictional));
  const realFetch = globalThis.fetch; let officialFetches = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (["hts.usitc.gov", "www.usitc.gov", "www.federalregister.gov", "www.govinfo.gov", "content.govdelivery.com", "www.whitehouse.gov"].includes(url.hostname) && ["GET", "HEAD"].includes(method)) officialFetches++;
    else if (!(url.hostname.endsWith(".supabase.co") && ["GET", "HEAD"].includes(method))) throw Error(`Verification forbids ${method} ${url.hostname}${url.pathname}`);
    return realFetch(input, init);
  };
  try {
    const result = await runLiveCheck(products, AbortSignal.timeout(240000), message => console.log(message));
    // Preserve failures too; a failed source or unknown rule is never a passing check.
    await mkdir("raw/tariff-workflow", { recursive: true });
    const file = `raw/tariff-workflow/live-${Date.now()}.json`;
    await writeFile(file, JSON.stringify({ disclosure: "Fictional values and explicit qualification assumptions. Official sources fetched live. No workspace writes or customer claim.", result }, null, 2));
    for (const source of result.sources) if (source.status === "fetched" && source.body !== null) assert.equal(createHash("sha256").update(source.bodyEncoding === "base64" ? Buffer.from(source.body, "base64") : Buffer.from(source.body)).digest("hex"), source.sha256);
    for (const row of result.rows) if (row.stack?.totalAmount !== null && row.stack?.totalAmount !== undefined) {
      assert.equal(row.stack.unresolvedMeasures.length, 0);
      assert.equal(Math.round(row.stack.totalAmount * 100), row.stack.components.reduce((sum,c) => { assert.equal(typeof c.amount, "number"); return sum + Math.round(c.amount! * 100); },0));
    }
    assert.equal(result.totalDuty, null, "The deliberately missing weight must withhold the portfolio total.");
    assert.equal(result.rows.at(-1)?.stack?.totalAmount, null);
    console.log(JSON.stringify({ file, officialFetches, revision: result.revisionAfter, consistentRevision: result.consistentRevision, historicalComparison: result.historicalComparison.status, candidateSkus: result.historicalComparison.candidateSkus, sourcesFailed: result.sources.filter(s => s.status === "failed").map(s => ({ name:s.name,error:s.error })), rows: result.rows.map(r => ({ sku:r.product.sku, duty:r.stack?.totalAmount??null, unresolved:r.stack?.unresolvedMeasures??[], error:r.error })), databaseWrites:0, modelCalls:0 },null,2));
    assert(result.consistentRevision, "A consistent official tariff release was not established.");
    assert.equal(result.rows.slice(0,4).filter(r => r.stack?.totalAmount !== null && r.stack?.totalAmount !== undefined && !r.error).length,4,"The four fully specified test products did not all calculate.");
  } finally { globalThis.fetch = realFetch; }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode=1; });
