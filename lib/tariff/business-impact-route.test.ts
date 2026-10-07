import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { getProvider } from "@/lib/llm";
import { canonicalFields, type ColumnMapping } from "./column-mapping";

type State = { workspace: { customerId: string; role: string } | null; failure: boolean; calls: unknown[][]; run: unknown; client?: unknown };
const state: State = { workspace: { customerId: "authenticated-tenant", role: "owner" }, failure: false, calls: [], run: null };
Object.assign(globalThis, { impactRouteTestState: state });
const server = `export async function getAuthenticatedWorkspace(...args) { const s=globalThis.impactRouteTestState; s.calls.push(['auth',...args]); if(s.failure) throw Error('secret credentials'); return s.workspace; }
export async function createRequestClient() { return globalThis.impactRouteTestState.client; }`;
const store = `
export async function createImpactRun(...args) { const s=globalThis.impactRouteTestState; s.calls.push(['create',...args]); return {id:'saved',rows:args[3]}; }
export async function listImpactRuns(...args) { globalThis.impactRouteTestState.calls.push(['list',...args]); return []; }
export async function getImpactRun(...args) { const s=globalThis.impactRouteTestState; s.calls.push(['get',...args]); return s.run; }
`;
const fixtureDir = mkdtempSync(`${tmpdir()}/impact-route-test-`);
for (const [name, source] of Object.entries({ server, store })) writeFileSync(`${fixtureDir}/${name}.cjs`, source.replace(/export async function (\w+)/g, "exports.$1 = async function $1"));
test.after(() => rmSync(fixtureDir, { recursive: true, force: true }));
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/supabase/server") return { url: pathToFileURL(`${fixtureDir}/server.cjs`).href, shortCircuit: true };
  if (specifier === "@/lib/tariff/business-impact-store") return { url: pathToFileURL(`${fixtureDir}/store.cjs`).href, shortCircuit: true };
  return next(specifier, context);
} });
let realStore: typeof import("./business-impact-store");
let routes: typeof import("@/app/api/tariff/impact-runs/route");
let proposalRoute: typeof import("@/app/api/tariff/impact-runs/propose-mapping/route");
let detail: typeof import("@/app/api/tariff/impact-runs/[runId]/route");
let download: typeof import("@/app/api/tariff/impact-runs/[runId]/export/route");
test.before(async () => {
routes = await import("@/app/api/tariff/impact-runs/route");
proposalRoute = await import("@/app/api/tariff/impact-runs/propose-mapping/route");
detail = await import("@/app/api/tariff/impact-runs/[runId]/route");
download = await import("@/app/api/tariff/impact-runs/[runId]/export/route");
realStore = await import("./business-impact-store");
hooks.deregister();
});
const request = (body: string, headers: Record<string, string> = {}) => new Request("https://cante.test/api/tariff/impact-runs?customerId=foreign", { method: "POST", headers: { "content-type": "text/csv", "x-customer-id": "foreign", ...headers }, body });
test.beforeEach(() => { state.workspace = { customerId: "authenticated-tenant", role: "owner" }; state.failure = false; state.calls = []; state.run = null; });
test("POST persists input errors, derives workspace only from session", async () => {
  const response = await routes.POST(request("sku\nA")); assert.equal(response.status, 201);
  assert.equal((await response.json()).rows[0].status, "error");
  assert.deepEqual(state.calls[0], ["auth"]); assert.equal(state.calls[1][1], "authenticated-tenant");
});
test("POST rejects structural failures, content type and actual oversized stream without persistence", async () => {
  assert.equal((await routes.POST(request(""))).status, 400);
  assert.equal((await routes.POST(request("sku,SKU\nA,A"))).status, 400);
  assert.equal((await routes.POST(request("{}", { "content-type": "application/json" }))).status, 415);
  assert.equal((await routes.POST(request("x".repeat(2097153), { "content-length": "1" }))).status, 413);
  assert.ok(!state.calls.some(c => c[0] === "create"));
});
test("auth and failures have fixed safe public responses", async () => {
  state.workspace = null; assert.equal((await routes.POST(request("sku\nA"))).status, 401);
  state.workspace = { customerId: "authenticated-tenant", role: "viewer" }; assert.equal((await routes.POST(request("sku\nA"))).status, 403);
  state.failure = true;
  const response = await routes.POST(request("sku\nA")); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: "Unable to create tariff impact run." });
});
test("list and per-run reads are tenant scoped; foreign/missing return same 404; export uses stored rows", async () => {
  assert.equal((await routes.GET()).status, 200);
  for (const runId of ["missing", "foreign"]) {
    const context = { params: Promise.resolve({ runId }) };
    assert.equal((await detail.GET(request(""), context)).status, 404);
    assert.equal((await download.GET(request(""), context)).status, 404);
  }
  for (const call of state.calls.filter(c => ["get", "list"].includes(String(c[0])))) assert.equal(call[1], "authenticated-tenant");
  state.run = { filename: "evil\r\nheader", rows: [] };
  const exported = await download.GET(request(""), { params: Promise.resolve({ runId: "saved" }) });
  assert.equal(exported.status, 200); assert.equal(exported.headers.get("content-disposition"), 'attachment; filename="tariff-impact.csv"');
  assert.match(await exported.text(), /annual_delta_usd/);
});

test("store snapshots exact tenant matches, leaves ambiguous links empty, reads tenant scoped and sanitizes metadata", async () => {
  const { parseBusinessImpact } = await import("./business-impact");
  let savedRun: Record<string, unknown> | null = null;
  let savedRows: Record<string, unknown>[] = [];
  const queries: { table: string; filters: Record<string, unknown> }[] = [];
  state.client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      queries.push({ table, filters });
      const response = () => ({ data: table === "products" ? [{ id: "exact-product" }] : table === "suppliers" ? [{ id: "ambiguous-one" }, { id: "ambiguous-two" }] : table === "tariff_impact_runs" ? (filters.id === savedRun?.id && filters.customer_id === savedRun?.customer_id ? savedRun : null) : savedRows, error: null });
      const query = {
        select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
        limit() { return Promise.resolve(response()); }, maybeSingle() { return Promise.resolve(response()); }, order() { return Promise.resolve(response()); },
      };
      return query;
    },
    async rpc(name: string, args: { target_customer_id: string; run_data: Record<string, unknown>; row_data: Record<string, unknown>[] }) {
      assert.equal(name, "create_tariff_impact_run"); assert.equal(args.target_customer_id, "tenant");
      savedRun = { ...args.run_data, customer_id: args.target_customer_id }; savedRows = args.row_data;
      return { error: null };
    },
  };
  const input = "sku,hts,country,supplier,annual_value,current_rate\nA,0101,CA,Acme,1000,";
  const result = await realStore.createImpactRun("tenant", input, "../../evil\r\n.csv", parseBusinessImpact(input));
  assert.equal(result.rows.length, 1); assert.equal(savedRows[0].product_id, "exact-product"); assert.equal(savedRows[0].supplier_id, null);
  assert.equal((savedRun as unknown as Record<string, unknown>).filename, "evil__.csv");
  assert.match(String((savedRun as unknown as Record<string, unknown>).input_sha256), /^[a-f0-9]{64}$/);
  assert.equal(savedRows[0].status, "error"); assert.equal((savedRows[0].raw_input as Record<string, string>).current_rate, "");
  assert.equal(await realStore.getImpactRun("foreign", String((savedRun as unknown as Record<string, unknown>).id)), null);
  for (const q of queries.slice(0, -1)) assert.equal(q.filters.customer_id, "tenant");
});


test("confirmed mappings bypass aliases and reject nonexistent, partial or malformed mappings", async () => {
  const mapping = Object.fromEntries(canonicalFields.map(field => [field, null])) as ColumnMapping["mapping"];
  mapping.sku = "品目";
  const body = "品目,sku,qty\nSelected,Wrong,7";
  const response = await routes.POST(request(body, { "x-column-mapping": encodeURIComponent(JSON.stringify(mapping)) }));
  assert.equal(response.status, 201);
  const { rows } = await response.json();
  assert.equal(rows[0].sku, "Selected"); assert.equal(rows[0].quantity, null);
  assert.equal(rows[0].raw_input.sku, "Wrong");
  for (const invalid of ["%", "{}", JSON.stringify({ ...mapping, sku: "invented" })]) {
    assert.equal((await routes.POST(request(body, { "x-column-mapping": invalid }))).status, 400);
  }
});

test("mapping proposal keeps auth, content type, upload limits and returns raw preview", async t => {
  state.workspace = null; assert.equal((await proposalRoute.POST(request("sku\nA"))).status, 401);
  state.workspace = { customerId: "authenticated-tenant", role: "viewer" };
  assert.equal((await proposalRoute.POST(request("sku\nA"))).status, 403);
  state.workspace.role = "owner";
  assert.equal((await proposalRoute.POST(request("{}", { "content-type": "application/json" }))).status, 415);
  assert.equal((await proposalRoute.POST(request("x".repeat(2097153), { "content-length": "1" }))).status, 413);
  assert.equal((await proposalRoute.POST(request("sku,sku\nA,B"))).status, 400);
  const mapping = Object.fromEntries(canonicalFields.map(field => [field, field === "sku" ? "Product Label" : null]));
  const confidence = Object.fromEntries(canonicalFields.map(field => [field, .8]));
  const complete = t.mock.method(Object.getPrototypeOf(getProvider()), "complete", async () => ({ text: JSON.stringify({ mapping, confidence }), durationMs: 1, provider: "test" }));
  const response = await proposalRoute.POST(request("Product Label\nA\nB\nC\nD\nE\nF"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.headers, ["Product Label"]);
  assert.deepEqual(result.mapping, mapping); assert.deepEqual(result.confidence, confidence);
  assert.equal(result.sampleRows.length, 5); assert.equal(result.sampleRows[0]["Product Label"], "A");
  assert.ok(!state.calls.some(c => c[0] === "create"));
  complete.mock.mockImplementation(async () => { throw new Error("private model data"); });
  const failed = await proposalRoute.POST(request("sku\nA"));
  assert.equal(failed.status, 500); assert.ok(!JSON.stringify(await failed.json()).includes("private"));
});
