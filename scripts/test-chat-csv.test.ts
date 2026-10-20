import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { parseLiveProducts } from "../app/api/tariff/live-check/check";
import { POST as extract } from "../app/api/files/extract/route";
import { parseCsv } from "../lib/catalogue/csv";
import { easternIsoDate } from "../lib/tariff/date";
import * as demoScenario from "../components/tariff/demo-scenario";

const id = "12345678-1234-4234-8234-123456789abc";
const csv = "\ufeffsku,hts_code,origin_country,annual_customs_value_usd\r\nQA-CSV,8501314000,CN,1000.00\r\n";
function moduleAt(path: string, deps: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  const exposeIntent = path === "app/api/chat/route.ts" ? "\nexports.isTariffUpdateRequest = isTariffUpdateRequest;" : "";
  runInThisContext(`(function(require,exports){${code}${exposeIntent}\n})`)((key: string) => { if (!(key in deps)) throw Error(`Unexpected dependency: ${key}`); return deps[key]; }, exports);
  return exports;
}
function report() {
  return { checkedAt: "2026-10-19T12:00:00Z", basis: "annual", totalDuty: null, unresolvedProducts: 1, consistentRevision: true, revisionAfter: "fixture", products: 1,
    rows: [{ product: parseLiveProducts(csv)[0], stack: { totalAmount: null, components: [{ measureId: "9903.88.02", amount: 250, ratePercent: 0.25, citation: "https://hts.usitc.gov/" }], unresolvedMeasures: ["Missing importer facts"] }, error: null }],
    historicalComparison: { status: "compared", issues: [], candidateSkus: ["QA-CSV"], scope: ["fixture"], legalChanges: [], modifyingDocuments: [] },
    coverageNotes: ["Partial legal coverage"], notices: [], sources: [{ url: "https://hts.usitc.gov/", status: "fetched", error: null, body: "private source body" }] };
}
function helper(options: { role?: string; denied?: boolean; beginFail?: boolean; runFail?: boolean; finishFail?: boolean; failFail?: boolean; readFail?: boolean; storedCsv?: string; noRecords?: boolean; archiveReadFail?: boolean; confirmations?: Record<string, boolean>; previous?: any } = {}) {
  const calls: any[] = []; const result = report();
  const db = { from(table: string) { calls.push(["from", table]); const chain: any = { select: () => chain, eq: (key: string, value: string) => { calls.push(["eq", key, value]); return chain; }, order: () => chain, limit: () => chain, then: (resolve: Function) => resolve(options.readFail ? { error: "unavailable" } : { data: options.noRecords ? [] : [{ id, filename: "products.csv" }] }) }; return chain; } };
  const api = moduleAt("app/api/chat/csv-check.ts", {
    "@/lib/supabase/server": { createRequestClient: async () => db, getAuthenticatedWorkspace: async (customerId: string) => options.denied ? null : { customerId, role: options.role ?? "member" } },
    "@/config/tariff-remedy-contract.json": {},
    "@/lib/catalogue/csv": { parseCsv },
    "@/lib/tariff/date": { easternIsoDate },
    "@/app/api/tariff/live-check/check": { LIVE_MAX_BYTES: 1_000_000, parseLiveProducts, runLiveCheck: async (products: any, signal: AbortSignal, progress: Function, observe: Function) => { calls.push(["run", products]); observe(result.sources); progress("Fetching fixture official source"); if (options.runFail) throw Error("Source unavailable"); return result; } },
    "@/lib/tariff/business-impact-store": {
      beginLiveCheckArchive: async (...args: any[]) => { calls.push(["begin", args]); if (options.beginFail) throw Error("database unavailable"); return id; },
      finishLiveCheckArchive: async (...args: any[]) => { calls.push(["finish", args]); if (options.finishFail) throw Error("Could not archive result"); },
      failLiveCheckArchive: async (...args: any[]) => { calls.push(["fail", args]); if (options.failFail) throw Error("Cannot save failure"); },
      readLiveCheckArchive: async (_db: any, customerId: string, checkId: string) => { calls.push(["read", customerId, checkId]); if (options.archiveReadFail) throw Error("Archive integrity failed"); return { result: options.previous === undefined ? result : options.previous, events: [], record: { id, filename: "products.csv", confirmations: options.confirmations ?? {}, input_csv: options.storedCsv ?? csv } }; },
    },
  });
  return { api, calls, result, file: { filename: "products.csv", format: "csv", text: "truncated preview", originalCsv: csv } };
}
for (const [label, content] of [["BOM/CRLF/Unicode", "\ufeffsku,name\r\nA,café\r\n"], ["beyond prompt preview", "sku,name\r\n" + "A,long product\r\n".repeat(2000)]]) {
  test(`extraction returns complete original CSV: ${label}`, async () => {
    const form = new FormData(); form.set("file", new File([content], "products.csv"));
    const response = await extract(new Request("https://cante.test/api/files/extract", { method: "POST", body: form }));
    assert.equal(response.status, 200); const data = await response.json();
    assert.equal(data.originalCsv, content); assert(data.text.length <= 20_000);
    if (content.length > 20_000) assert.match(data.warnings.join(" "), /complete original CSV/);
  });
}
test("oversized and non-UTF8 CSVs fail explicitly before a truncated preview can be checked", async () => {
  for (const [bytes, status] of [[new Uint8Array(1_000_001), 413], [new Uint8Array([255, 254, 255]), 400]] as const) {
    const form = new FormData(); form.set("file", new File([bytes], "products.csv"));
    const response = await extract(new Request("https://cante.test/api/files/extract", { method: "POST", body: form })); assert.equal(response.status, status);
  }
});
test("chat archives the original before fetching, preserves missing facts/nulls, and commits before claiming success", async () => {
  const h = helper(); const progress: string[] = [];
  const out = await h.api.checkChatCsv("owned", h.file, new AbortController().signal, (m: string) => progress.push(m));
  assert.deepEqual(h.calls.filter(c => ["begin", "run", "finish"].includes(c[0])).map(c => c[0]), ["begin", "run", "finish"]);
  assert.equal(h.calls.find(c => c[0] === "begin")[1][2], csv);
  assert.equal(h.calls.find(c => c[0] === "run")[1][0].remedyFacts, undefined);
  assert.equal(out.context.totalDuty, null); assert.match(out.markdown, /complete duty total is unavailable/);
  assert.match(out.markdown, new RegExp(id)); assert(progress.some(m => /Fetching/.test(m)));
  assert(!JSON.stringify(out.context).includes("private source body"));
});
for (const options of [{ role: "viewer" }, { beginFail: true }]) {
  test(`no legal fetch when CSV cannot be saved: ${JSON.stringify(options)}`, async () => {
    const h = helper(options); await h.api.checkChatCsv("owned", h.file, new AbortController().signal, () => {});
    assert(!h.calls.some(c => c[0] === "run")); assert(!h.calls.some(c => c[0] === "finish"));
  });
}
test("workspace access must be verified independently of caller-provided ID", async () => {
  const h = helper({ denied: true }); await assert.rejects(h.api.checkChatCsv("other", h.file, new AbortController().signal, () => {}), /workspace access/);
  assert.equal(h.calls.length, 0);
});
test("an old truncated-preview-only client cannot manufacture an original CSV", async () => {
  const h = helper(); const out = await h.api.checkChatCsv("owned", { ...h.file, originalCsv: undefined }, new AbortController().signal, () => {});
  assert.match(out.markdown, /attach this CSV again/); assert.equal(h.calls.length, 0);
});
test("missing fields retain the original CSV and an actionable failed check, with no invented duty", async () => {
  const h = helper(); const out = await h.api.checkChatCsv("owned", { ...h.file, originalCsv: "sku,name\nA,Widget" }, new AbortController().signal, () => {});
  assert(h.calls.some(c => c[0] === "begin")); assert(h.calls.some(c => c[0] === "fail"));
  assert(!h.calls.some(c => c[0] === "run")); assert.match(out.markdown, /10-digit HTS/);
});
for (const options of [{ runFail: true }, { finishFail: true }, { runFail: true, failFail: true }]) {
  test(`failed fetch/persistence cannot become success: ${JSON.stringify(options)}`, async () => {
    const h = helper(options); const out = await h.api.checkChatCsv("owned", h.file, new AbortController().signal, () => {});
    assert.match(out.markdown, /No complete result is claimed/); assert(h.calls.some(c => c[0] === "fail"));
    if (options.failFail) assert.match(out.markdown, /remains incomplete/);
  });
}
test("new chats retrieve saved rows with tenant filters and disclose unavailable storage", async () => {
  const h = helper(); const out = await h.api.readChatCsvContext("owned");
  assert.equal(out.checks[0].data.rows[0].sku, "QA-CSV"); assert.equal(out.checks[0].data.rows[0].totalDuty, null);
  assert(h.calls.some(c => c[0] === "eq" && c[1] === "customer_id" && c[2] === "owned"));
  assert.match(out.scope, /Latest three/); assert.equal((await helper({ readFail: true }).api.readChatCsvContext("owned")).status, "unavailable");
});
test("follow-up identifiers retrieve original fields beyond the first rows, with explicit excerpt limits", async () => {
  const original = "sku,name,description\n" + Array.from({ length: 40 }, (_, i) => `QA-${i},Widget ${i},${"detail ".repeat(60)}`).join("\n");
  const h = helper({ storedCsv: original }); const out = await h.api.readChatCsvContext("owned", "What is QA-39?");
  assert(out.checks[0].uploadedFields.rows.some((row: any) => row.sku === "QA-39"));
  assert(out.checks[0].uploadedFields.omittedRows > 0); assert.match(out.checks[0].uploadedFields.excerptLimits, /200 characters/);
});
test("oversized rule context keeps every product group while disclosing omitted detail", async () => {
  const h = helper(); const row = h.result.rows[0];
  h.result.rows = Array.from({ length: 100 }, (_, i) => ({ ...row, product: { ...row.product, sku: `QA-${i}` }, stack: { ...row.stack, unresolvedMeasures: ["Long source explanation ".repeat(1000)] } }));
  const out = await h.api.readChatCsvContext("owned");
  assert.equal(out.checks[0].data.rows.length, 100); assert.match(out.checks[0].data.detailLimit, /chat budget/);
  assert(JSON.stringify(out).length < 80_000);
});

function chat(h: ReturnType<typeof helper>, available = true) {
  const messages: any[] = []; const prompts: string[] = []; let modelCalls = 0;
  const deps = {
    "@/components/tariff/demo-scenario": demoScenario,
    "@/lib/db/queries": { resolveCustomerId: async () => "owned", getCustomerWithProfile: async () => ({}), getJurisdictionProfile: async () => ({}), getRunHistory: async () => [], listMemories: async () => [], renderMemoryForPrompt: () => "", createConversation: async () => "convo", getConversation: async () => ({ messages: [], conversation: { customerId: "owned", jurisdiction: "United States" } }), appendMessage: async (...args: any[]) => messages.push(args) },
    "@/lib/checks/remember": { extractMemories: async () => {} },
    "@/lib/countries": { normalizeJurisdiction: () => "United States" },
    "@/lib/chat/attachments": { fileAttachments: async () => [], renderAttachmentOutcomes: () => "" },
    "@/lib/supabase/server": { createClient: async () => { throw Error("catalogue unavailable fixture"); }, retrieveCustomerContext: async () => [] },
    "@/lib/llm": { getProvider: () => ({ name: "api", available: async () => ({ ok: available, detail: "offline" }), async *stream(options: any) { modelCalls++; prompts.push(options.prompt); yield { type: "text", text: "Explanation from saved fixture." }; yield { type: "done" }; } }) },
    "./csv-check": h.api,
  };
  return { route: moduleAt("app/api/chat/route.ts", deps), messages, prompts, modelCalls: () => modelCalls };
}
function request(body: object) { return new Request("https://cante.test/api/chat", { method: "POST", body: JSON.stringify(body) }); }
for (const available of [true, false]) {
  test(`actual chat route saves and checks CSV without an LLM call (provider available=${available})`, async () => {
    const h = helper(); const c = chat(h, available);
    const response = await c.route.POST(request({ attachments: [h.file] })); const text = await response.text();
    assert.equal(response.status, 200); assert.match(text, /tool_progress/); assert.match(text, /product group/);
    assert.equal(c.modelCalls(), 0); assert.equal(c.messages.filter(m => m[1] === "agent").length, 1);
    assert.match(c.messages.find(m => m[1] === "agent")[2], /Saved CSV and check/); assert.match(text, /"type":"done"/);
  });
}
test("actual chat route answers from persisted CSV context on a later new conversation", async () => {
  const h = helper(); const c = chat(h);
  const response = await c.route.POST(request({ question: "Which SKU needs review?" })); await response.text();
  assert.equal(c.modelCalls(), 1); assert.match(c.prompts[0], /QA-CSV/); assert.match(c.prompts[0], /Missing importer facts/);
  assert(!h.calls.some(c => c[0] === "run"));
});
test("actual route refuses multiple CSVs instead of starting unbounded government checks", async () => {
  const h = helper(); const c = chat(h);
  const response = await c.route.POST(request({ attachments: [h.file, h.file] })); assert.equal(response.status, 400); assert.equal(h.calls.length, 0);
});

for (const prompt of ["any news today?", "Any updates?", "what’s new?", "has anything changed since yesterday?", "check for changes", "check my tariffs today", "refresh my CSV", "Any tariff news for our products?", "Hi Cante, any news today?", "Have tariffs changed?", "Did my duties change today?"]) {
  test(`fresh-check intent: ${prompt}`, () => assert.equal(chat(helper()).route.isTariffUpdateRequest(prompt), true));
}
for (const prompt of ["Which SKU needs review?", "Explain what changed in this saved tariff report", "Don't check for changes", "Any news about basketball?", "Any weather news today?", "If I ask any news today will you check?", "What does tariff news mean?", "Just summarize my last check", "How to check for tariff changes", "What happens when I say any news today?"]) {
  test(`no accidental fresh-check intent: ${prompt}`, () => assert.equal(chat(helper()).route.isTariffUpdateRequest(prompt), false));
}
for (const available of [true, false]) {
  test(`actual route refreshes news from saved CSV without model routing (available=${available})`, async () => {
    const h = helper(); const c = chat(h, available);
    const response = await c.route.POST(request({ question: "any news today?" })); const text = await response.text();
    assert.equal(response.status, 200); assert(h.calls.some(c => c[0] === "run"));
    assert.match(text, /Refreshed/); assert.match(text, /complete duty difference.*unavailable/);
    assert.match(text, /tool_progress/); assert.equal(c.modelCalls(), 0);
    assert.match(text, /"hostname":"hts\.usitc\.gov"/);
    const begin = h.calls.find(c => c[0] === "begin")[1];
    assert.equal(begin[2], csv); assert.equal(begin[5].sourceCheckId, id);
    assert.match(c.messages.find(m => m[1] === "agent")[2], /bounded feed coverage/);
    const archived = h.calls.find(c => c[0] === "finish")[1][3]; assert.equal(archived.chatRecheck.sourceCheckId, id);
  });
}
for (const options of [{ noRecords: true }, { readFail: true }, { archiveReadFail: true }, { role: "viewer" }]) {
  test(`news request cannot substitute general headlines or fake data when unavailable: ${JSON.stringify(options)}`, async () => {
    const h = helper(options); const c = chat(h); const response = await c.route.POST(request({ question: "any news today?" }));
    const body = await response.text(); assert.equal(c.modelCalls(), 0); assert(!h.calls.some(c => c[0] === "run"));
    assert(!h.calls.some(c => c[0] === "begin")); assert.doesNotMatch(body, /nothing changed|you are compliant/i);
    assert.match(body, options.noRecords ? /Upload your product/ : options.role ? /read-only/ : /couldn’t read or verify/);
  });
}
test("latest invalid CSV remains the selected file; no silent fallback to an older catalogue", async () => {
  const h = helper({ storedCsv: "sku,name\nA,Widget" }); const out = await h.api.recheckLatestChatCsv("owned", new AbortController().signal, () => {});
  assert.match(out.markdown, /10-digit HTS/); assert(h.calls.some(c => c[0] === "fail")); assert(!h.calls.some(c => c[0] === "run"));
  assert.equal(h.calls.find(c => c[0] === "begin")[1][2], "sku,name\nA,Widget");
});
test("rechecks reuse only saved explicit declarations and keep CSV facts authoritative", async () => {
  const h = helper({ confirmations: { standardCommercial: true, noOther232: true } });
  await h.api.recheckLatestChatCsv("owned", new AbortController().signal, () => {});
  assert.deepEqual(h.calls.find(c => c[0] === "run")[1][0].remedyFacts, { standardCommercial: true, other232Heading: "none" });
  const override = helper({ confirmations: { standardCommercial: true }, storedCsv: csv.trimEnd() + ",standard_commercial\n" });
  // Use a valid explicit CSV declaration which overrides the old header declaration.
  const raw = "sku,hts_code,origin_country,annual_customs_value_usd,standard_commercial\nQA-CSV,8501314000,CN,1000,false";
  await override.api.checkChatCsv("owned", { ...override.file, originalCsv: raw }, new AbortController().signal, () => {}, { record: { id, confirmations: { standardCommercial: true } }, result: null });
  assert.equal(override.calls.find(c => c[0] === "run")[1][0].remedyFacts.standardCommercial, false);
});
test("today's captured notices are date-filtered and never called confirmed product impacts", async () => {
  const h = helper(); const today = easternIsoDate();
  h.result.notices = [
    { title: "Today's tariff notice", url: "https://www.federalregister.gov/documents/fixture", date: today, source: "Federal Register" },
    { title: "Old notice must not be today's news", url: "https://www.federalregister.gov/documents/old", date: "2000-01-01", source: "Federal Register" },
    { title: "Undated notice", url: "https://www.federalregister.gov/documents/undated", date: null, source: "Federal Register" },
    { title: "Yesterday in New York", url: "https://content.govdelivery.com/fixture", date: new Date(`${today}T00:30:00Z`).toUTCString(), source: "CBP CSMS" },
  ] as any;
  const out = await h.api.recheckLatestChatCsv("owned", new AbortController().signal, () => {});
  assert.match(out.markdown, /Today’s captured tariff publications/); assert.match(out.markdown, /applicability.*not confirmed/);
  assert.doesNotMatch(out.markdown, /Old notice must|Undated notice|Yesterday in New York/);
  assert.equal(out.context.chatRecheck.todayNotices.length, 1);
});
function completePair() {
  const before: any = report(); before.totalDuty = 250; before.unresolvedProducts = 0;
  before.rows[0].stack.totalAmount = 250; before.rows[0].quote = { column: "general", computation: { amount: 10 } };
  const after = structuredClone(before); after.totalDuty = 275.01; after.rows[0].stack.totalAmount = 275.01; after.rows[0].quote.computation.amount = 12;
  return { before, after };
}
test("same-input comparison uses exact cents and survives JSONB object key ordering", () => {
  const { before, after } = completePair();
  before.rows[0].product = Object.fromEntries(Object.entries(before.rows[0].product).reverse());
  const comparison = helper().api.compareSavedChecks(before, after);
  assert.equal(comparison.fullDutyDifference, 25.01); assert.equal(comparison.baseDutyDifference, 2); assert.equal(comparison.changedProducts, 1);
  assert.equal(comparison.topChanges[0].difference, 25.01);
});
test("fresh-check report persists a calculated difference using an unchanged saved CSV", async () => {
  const { before, after } = completePair(); const h = helper({ previous: before }); Object.assign(h.result, after);
  const out = await h.api.recheckLatestChatCsv("owned", new AbortController().signal, () => {});
  assert.match(out.markdown, /\$25\.01\/year/); assert.match(out.markdown, /products\.csv/);
  const persisted = h.calls.find(c => c[0] === "finish")[1][3]; assert.equal(persisted.chatRecheck.fullDutyDifference, 25.01);
});
test("missing totals never become zero exposure; input/qualification drift blocks comparisons", () => {
  const { before, after } = completePair(); const api = helper().api;
  after.totalDuty = null; after.rows[0].stack.totalAmount = null;
  const partial = api.compareSavedChecks(before, after); assert.equal(partial.fullDutyDifference, null); assert.equal(partial.changedProducts, null); assert.equal(partial.baseDutyDifference, 2);
  after.rows[0].product.customsValue = 2000;
  const mismatched = api.compareSavedChecks(before, after); assert.equal(mismatched.status, "unavailable"); assert.equal(mismatched.baseDutyDifference, null);
});
test("no baseline and unstable government revisions cannot imply no change", () => {
  const { before, after } = completePair(); const api = helper().api;
  assert.equal(api.compareSavedChecks(null, after).fullDutyDifference, null);
  before.consistentRevision = false; assert.equal(api.compareSavedChecks(before, after).status, "unavailable");
});
test("news questions in the fictional playground cannot rerun a real workspace CSV", async () => {
  const h = helper(); const c = chat(h);
  const response = await c.route.POST(request({ question: "any news today?", demoScenario: { catalogueCsv: demoScenario.catalogueCsv(), historyCsv: demoScenario.historyCsv(), regulationId: "sim-cn-25" } }));
  await response.text(); assert.equal(response.status, 200); assert.equal(h.calls.length, 0); assert.equal(c.modelCalls(), 1);
});
test("a fresh government fetch failure is archived rather than returned as no news", async () => {
  const h = helper({ runFail: true }); const c = chat(h);
  const response = await c.route.POST(request({ question: "any news today?" })); const text = await response.text();
  assert(h.calls.some(c => c[0] === "fail")); assert.match(text, /Source unavailable/); assert.match(text, /No complete result is claimed/); assert.equal(c.modelCalls(), 0);
});
test("fictional uploaded facts stay visibly fictional during a government recheck", async () => {
  const h = helper(); h.result.rows[0].product.fictional = true;
  const out = await h.api.recheckLatestChatCsv("owned", new AbortController().signal, () => {});
  assert.match(out.markdown, /Fictional\/demo inputs/); assert.match(out.markdown, /test assumptions/);
});
