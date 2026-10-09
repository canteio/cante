import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const dir = mkdtempSync(`${tmpdir()}/cante-232-coverage-`);
writeFileSync(`${dir}/server.cjs`, "exports.createClient = async () => globalThis.section232CoverageClient;");
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/supabase/server") return { url: pathToFileURL(`${dir}/server.cjs`).href, shortCircuit: true };
  return next(specifier, context);
} });
let section232TargetDate: typeof import("./section232-live").section232TargetDate;
let lookup: typeof import("./section232-live").lookupSection232Live;
let rpcCalls = 0;
let accepted: unknown[] = [], reviews: unknown[] = [], matches: unknown[] = [];
const query = (data: unknown[]) => {
  const q = { select() { return q; }, in() { return q; }, lte() { return q; }, order() { return q; }, eq() { return q; }, gte() { return q; }, limit() { return q; },
    then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data, error: null }).then(resolve); } };
  return q;
};
(globalThis as unknown as { section232CoverageClient: unknown }).section232CoverageClient = {
  from(table: string) { return query(table === "section232_tariff_rows" ? accepted : reviews); },
  rpc() { rpcCalls++; return query(matches); },
};
test.before(async () => { ({ lookupSection232Live: lookup, section232TargetDate } = await import("./section232-live")); hooks.deregister(); });
test.after(() => rmSync(dir, { recursive: true, force: true }));
test.beforeEach(() => { accepted = []; reviews = []; matches = []; rpcCalls = 0; });
test("missing, outdated, or unreviewed amendment coverage cannot prove zero duty", async () => {
  await assert.rejects(lookup("3916.90.30.00", undefined, "2026-09-15"), /coverage ledger/);
  accepted = [{ source_document_number: "April", effective_date: "2026-04-06" }];
  await assert.rejects(lookup("3916.90.30.00", undefined, "2026-09-15"), /June 8/);
  accepted = [{ source_document_number: "June", effective_date: "2026-06-08" }];
  await assert.rejects(lookup("3916.90.30.00", undefined, "2026-09-15"), /consolidated/);
  assert.equal(rpcCalls, 0);
});
test("reviewed consolidated coverage permits a genuine negative result and rejects corrupt rates", async () => {
  accepted = [{ source_document_number: "June", effective_date: "2026-06-08" }]; reviews = [{ source_document_number: "June" }];
  assert.equal(await lookup("3916.90.30.00", undefined, "2026-09-15"), null);
  matches = [{ effective_date: "2026-06-08", rate_percent: "NaN", uk_rate_percent: null, us_content_rate_percent: null }];
  await assert.rejects(lookup("7208", undefined, "2026-09-15"), /invalid rate/);
});

test("Section 232 defaults to the U.S. Eastern legal day around UTC midnight", () => {
  assert.equal(section232TargetDate(undefined, new Date("2026-10-07T03:59:59Z")), "2026-10-06");
  assert.equal(section232TargetDate(undefined, new Date("2026-10-07T04:00:00Z")), "2026-10-07");
});
test("Section 232 preserves an explicitly supplied effective date", () => {
  assert.equal(section232TargetDate("2026-04-06", new Date("2026-10-07T03:59:59Z")), "2026-04-06");
});
