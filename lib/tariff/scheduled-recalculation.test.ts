import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const state = { calls: [] as string[], failure: false, missing: false };
const query = (table: string) => {
  let selected = "";
  const result = () => ({ data: table === "tariff_monitor_candidates" ? [{ customer_id: "fixture-tenant" }]
    : table === "tariff_impact_runs" ? selected === "id" ? { id: "fixture-run" } : state.missing ? null : { id: "fixture-run" }
    : [], error: state.failure && table === "tariff_impact_runs" ? { message: "controlled read failure" } : null, count: 0 });
  const q = {
    select(value: string) { selected = value; return q; },
    eq(column: string, value: string | boolean) { if (column === "customer_id") assert.equal(value, "fixture-tenant"); return q; },
    order() { return q; }, limit() { return q; }, abortSignal() { return q; },
    range() { return Promise.resolve(result()); }, maybeSingle() { return Promise.resolve(result()); },
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  };
  return q;
};
Object.assign(globalThis, { scheduledAuditClient: { from(table: string) { state.calls.push(table); return query(table); } } });
const dir = mkdtempSync("/tmp/cante-scheduled-test-");
writeFileSync(`${dir}/service.cjs`, "exports.createServiceClient=()=>global.scheduledAuditClient;");
writeFileSync(`${dir}/server.cjs`, "exports.createClient=async()=>{throw Error('Anonymous request client must not read worker snapshots');};");
const hooks = registerHooks({ resolve(specifier, context, next) {
  const file = specifier === "@/lib/supabase/service" ? "service" : specifier === "@/lib/supabase/server" ? "server" : null;
  return file ? { url: pathToFileURL(`${dir}/${file}.cjs`).href, shortCircuit: true } : next(specifier, context);
} });
let POST: typeof import("@/app/api/internal/tariff-recalculate/route").POST;
const saved = { secret: process.env.TARIFF_RECALC_SHARED_SECRET, vercel: process.env.VERCEL };
test.before(async () => { POST = (await import("@/app/api/internal/tariff-recalculate/route")).POST; hooks.deregister(); });
test.beforeEach(() => { state.calls = []; state.failure = false; state.missing = false; process.env.TARIFF_RECALC_SHARED_SECRET = "fixture-secret"; delete process.env.VERCEL; });
test.after(() => {
  for (const [key, value] of [["TARIFF_RECALC_SHARED_SECRET", saved.secret], ["VERCEL", saved.vercel]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});
const request = (secret = "fixture-secret") => new Request("https://fixture.invalid/api/internal/tariff-recalculate", { method: "POST", headers: { authorization: `Bearer ${secret}` } });
test("cron authentication fails before database access", async () => {
  assert.equal((await POST(request("wrong"))).status, 401);
  delete process.env.TARIFF_RECALC_SHARED_SECRET;
  assert.equal((await POST(request())).status, 401);
  assert.deepEqual(state.calls, []);
});
test("cookie-free worker request keeps the supplied client through the real snapshot read", async () => {
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { customersEvaluated: 1, eventsCreated: 0, failures: 0 });
  assert.ok(state.calls.includes("tariff_impact_rows"));
});
test("missing known run and customer read errors fail the scheduled request", async () => {
  state.missing = true;
  assert.equal((await POST(request())).status, 503);
  state.failure = true;
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).failures, 1);
});
test("hosted app never opens the worker service client", async () => {
  process.env.VERCEL = "1";
  assert.equal((await POST(request())).status, 409);
  assert.deepEqual(state.calls, []);
});
test("Edge wrapper rejects unauthorized calls and preserves failure outcomes", async () => {
  let handler!: (request: Request) => Promise<Response>;
  let calls = 0;
  let upstreamStatus = 200;
  const source = readFileSync("supabase/functions/tariff-impact-recalculate/index.ts", "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    TextEncoder, Response, AbortSignal, console,
    Deno: { serve(fn: typeof handler) { handler = fn; }, env: { get(key: string) { return key === "TARIFF_RECALC_TARGET_URL" ? "https://fixture.invalid" : "fixture-secret"; } } },
    fetch: async () => { calls++; return Response.json({ customersEvaluated: 1, eventsCreated: 0, failures: 1 }, { status: upstreamStatus }); },
  });
  assert.equal((await handler(request("wrong"))).status, 401);
  assert.equal(calls, 0);
  assert.equal((await handler(request())).status, 503); // also catches legacy 200 failure bodies
  upstreamStatus = 409;
  assert.equal((await handler(request())).status, 409);
});
