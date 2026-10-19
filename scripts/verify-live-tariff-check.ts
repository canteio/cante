/** Actual government fetches + actual engine. Refuse customer writes and paid APIs. */
import "./load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parseLiveProducts, runLiveCheck } from "../app/api/tariff/live-check/check";
async function main() {
  const realFetch = globalThis.fetch; let officialRequests = 0, databaseReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (["hts.usitc.gov", "www.federalregister.gov", "content.govdelivery.com"].includes(url.hostname)) officialRequests++;
    else if (url.hostname.endsWith(".supabase.co") && (method === "GET" || method === "HEAD" || (method === "POST" && url.pathname === "/rest/v1/rpc/current_section232_rate"))) databaseReads++;
    else throw Error(`Verification forbids this network operation: ${method} ${url.hostname}${url.pathname}`);
    return realFetch(input, init);
  };
  try {
    const products = parseLiveProducts(await readFile(process.argv[2] ?? "public/examples/equipment-demo/products.csv", "utf8"));
    assert.equal(products.length, 50);
    const report = await runLiveCheck(products, AbortSignal.timeout(270000), message => process.stderr.write(message + "\n"));
    const folder = "raw/live-tariff-check"; await mkdir(folder, { recursive: true });
    const file = `${folder}/${report.checkedAt.replace(/[:.]/g,"-")}.json`;
    await writeFile(file, JSON.stringify(report,null,2));
    const failures = report.rows.filter(r => r.verification?.status === "failed");
    assert.equal(failures.length, 0, `Arithmetic mismatches: ${failures.map(r => r.product.sku)}`);
    assert.equal(report.independentBaseChecks, 50, "Every example base rate must have a successful independent check.");
    assert.equal(report.consistentRevision, true, "USITC revision must be stable.");
    assert.equal(report.sources.some(s => s.status === "failed"), false, "Official source failures are not a successful complete fetch.");
    if (products.some(p => p.history)) { assert.equal(report.basis,"historical"); assert.equal(report.totalAnnualDuty,null); assert.equal(report.importRows,600); }
    assert.equal(report.rows.every(r => r.stack), true, "The actual stack engine must return every product.");
    for (const row of report.rows) if (row.stack?.unresolvedMeasures.length) assert.equal(row.stack.totalAmount, null);
    console.log(JSON.stringify({ file, basis: report.basis, importRows: report.importRows, products: report.products, independentBaseChecks: report.independentBaseChecks, unresolvedProducts: report.unresolvedProducts, totalAnnualDuty: report.totalAnnualDuty, revision: report.revisionAfter, officialRequests, databaseReads, customerWrites: 0, llmCalls: 0, missingCoverage: [...new Set(report.rows.flatMap(r => r.stack?.unresolvedMeasures ?? []))] },null,2));
  } finally { globalThis.fetch = realFetch; }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
