import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLeads, parseShipmentExport, type MonitorState } from "./model";
import { fetchMonitorRecalls, loadShipmentExport, parseMonitorRecalls, ShipmentSourceBlocked } from "./sources";
import { refreshMonitor, type MonitorStore } from "./refresh";
import { searchMonitor } from "./query";
import { loadRawManifestText } from "../fetch/fetch-manifests";

const now = "2026-09-14T12:00:00.000Z";
function delivery(overrides = {}) {
  return { sourceType: "authorized_export", sourceRef: "test-only-source", observedAt: now,
    shipments: [{ billOfLading: "TEST-BOL", dataRedacted: false,
      cargoDescription: "baby stroller", shipperCountryCode: "CN", hsChapter: "87",
      consigneeName: "Example Toys, Inc.", consigneeAddress: "123 Example St, USA",
      manifestFiledDate: "2026-09-01", ...overrides }] };
}
function rows(overrides = {}) { return parseShipmentExport(JSON.stringify(delivery(overrides)), now).rows; }
function rawRecall(overrides = {}) {
  return { RecallID: 1, RecallNumber: "26-test", RecallDate: "2026-09-01T00:00:00",
    Title: "Baby stroller recalled", Description: "Stroller brakes fail",
    URL: "https://www.cpsc.gov/Recalls/test-only", Importers: [{ Name: "EXAMPLE TOYS INC" }], ...overrides };
}
function recalls() { return parseMonitorRecalls([rawRecall()]); }
function memoryStore(): MonitorStore {
  const states = new Map<string, MonitorState>();
  return { async read(id) { return states.has(id) ? structuredClone(states.get(id)!) : null; },
    async save(id, state, revision) {
      if ((states.get(id)?.revision ?? 0) !== revision) throw new Error("Concurrent refresh");
      states.set(id, structuredClone(state));
    } };
}
const inputs = { now, shipments: async () => ({ rows: rows(), observedAt: now, sample: false }), recalls: async () => recalls() };

test("normalized delivery validates identity, date, source and redaction instead of fabricating fields", () => {
  assert.equal(rows()[0].vesselName, null);
  assert.equal(rows()[0].id, rows()[0].id);
  assert.throws(() => rows({ manifestFiledDate: "2026-02-30" }), /Invalid calendar date/);
  assert.throws(() => rows({ dataRedacted: "false" }));
  const duplicate = delivery(); duplicate.shipments.push(duplicate.shipments[0]);
  assert.throws(() => parseShipmentExport(JSON.stringify(duplicate), now), /Duplicate/);
  assert.throws(() => parseShipmentExport(JSON.stringify({ ...delivery(), sourceType: "live" }), now));
  assert.throws(() => parseShipmentExport(JSON.stringify({ ...delivery(), observedAt: "2027-01-01T00:00:00.000Z" }), now), /future/);
});

test("file loaders read explicit exports and CAMIR samples; missing feed stays blocked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cante-import-test-"));
  try {
    await assert.rejects(loadShipmentExport(undefined, now), ShipmentSourceBlocked);
    const file = join(dir, "export.json");
    await writeFile(file, JSON.stringify(delivery()));
    assert.equal((await loadShipmentExport(file, now)).rows.length, 1);
    const camir = join(dir, "sample.cam");
    await writeFile(camir, "M01MAEU11DKTEST VESSEL\n");
    assert.match(await loadRawManifestText(camir), /^M01/);
    await writeFile(camir, "");
    await assert.rejects(loadRawManifestText(camir), /empty/);
    await assert.rejects(loadShipmentExport(join(dir, "missing"), now));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("recall adapter keeps all rows beyond legacy 30-row cap and validates malformed evidence", () => {
  assert.equal(parseMonitorRecalls(Array.from({ length: 45 }, (_, i) => rawRecall({ RecallID: i }))).length, 45);
  assert.throws(() => parseMonitorRecalls({ message: "outage" }));
  assert.throws(() => parseMonitorRecalls([rawRecall({ RecallDate: "not-a-date" })]));
  assert.throws(() => parseMonitorRecalls([rawRecall({ URL: "https://example.com" })]), /Unexpected/);
  assert.deepEqual(parseMonitorRecalls([]), []);
});

test("network adapter uses official bounded date request and rejects HTTP errors", async () => {
  let requested = "";
  const good = (async (url: URL | RequestInfo) => { requested = String(url); return Response.json([rawRecall()]); }) as typeof fetch;
  assert.equal((await fetchMonitorRecalls(now, good)).length, 1);
  assert.match(requested, /^https:\/\/www.saferproducts.gov\/RestWebServices\/Recall/);
  assert.match(requested, /RecallDateStart=2026-03-18/);
  assert.match(requested, /RecallDateEnd=2026-09-14/);
  await assert.rejects(fetchMonitorRecalls(now, (async () => new Response("outage", { status: 503 })) as typeof fetch), /HTTP 503/);
});

test("commodity overlap cannot assert that a different importer was recalled", () => {
  assert.equal(buildLeads(rows(), recalls(), now)[0].kind, "named_importer");
  assert.equal(buildLeads(rows({ consigneeName: "Other Company" }), recalls(), now)[0].kind, "commodity_candidate");
  assert.equal(buildLeads(rows({ cargoDescription: "steel fasteners" }), recalls(), now).length, 0);
});

test("samples, redactions, non-US/unknown parties and old/future/unknown activity never become active leads", () => {
  for (const override of [{ dataRedacted: true }, { consigneeName: null }, { consigneeName: "..." },
    { consigneeAddress: "London, UK" }, { consigneeAddress: null },
    { manifestFiledDate: null }, { manifestFiledDate: "2020-01-01" }, { manifestFiledDate: "2027-01-01" }]) {
    assert.equal(buildLeads(rows(override), recalls(), now).length, 0);
  }
  assert.equal(buildLeads(rows().map(r => ({ ...r, sourceType: "sample_fixture" })), recalls(), now).length, 0);
  assert.equal(buildLeads(rows(), parseMonitorRecalls([rawRecall({ RecallDate: "2020-01-01" })]), now).length, 0);
});

test("refresh persists new discovery once, and does not announce a second B/L as a new importer", async () => {
  const store = memoryStore();
  const first = await refreshMonitor("a", store, inputs);
  assert.equal(first.healthy, true); assert.equal(first.state.newLeadIds.length, 1);
  const second = await refreshMonitor("a", store, inputs);
  assert.equal(second.state.revision, 2); assert.equal(second.state.newLeadIds.length, 0);
  const third = await refreshMonitor("a", store, { ...inputs,
    shipments: async () => ({ rows: rows({ billOfLading: "ANOTHER-BOL" }), observedAt: now, sample: false }) });
  assert.equal(third.state.newLeadIds.length, 0);
  assert.equal(third.state.leads[0].firstSeenAt, now);
  assert.equal(await store.read("b"), null);
});

test("blocked first run still refreshes and persists real recall records", async () => {
  const store = memoryStore();
  const result = await refreshMonitor("a", store, { now, recalls: inputs.recalls });
  assert.equal(result.healthy, false);
  assert.equal(result.state.sources.shipments.status, "blocked");
  assert.match(result.state.sources.shipments.nextAction ?? "", /CANTE_IMPORT_SHIPMENTS_FILE/);
  assert.match(result.state.sources.shipments.nextAction ?? "", /npm run imports:refresh/);
  assert.equal(result.state.sources.recalls.status, "ok");
  assert.equal((await store.read("a"))?.recalls.length, 1);
  assert.equal(result.state.newLeadIds.length, 0);
});

test("configured shipment failures identify the safe setting to repair without leaking its path", async () => {
  const privatePath = "/private/customer/acme-shipments.json";
  const result = await refreshMonitor("a", memoryStore(), { ...inputs,
    shipments: async () => { throw new Error(`ENOENT: ${privatePath}`); } });
  const source = result.state.sources.shipments;
  assert.equal(source.status, "error");
  assert.match(source.nextAction ?? "", /CANTE_IMPORT_SHIPMENTS_FILE/);
  assert.match(source.nextAction ?? "", /readable normalized JSON snapshot/);
  assert.doesNotMatch(`${source.message} ${source.nextAction}`, /acme-shipments/);
});

test("outages retain previous evidence and timestamps without claiming a successful empty refresh", async () => {
  const store = memoryStore();
  await refreshMonitor("a", store, inputs);
  const fail = async () => { throw new Error("network unavailable"); };
  const result = await refreshMonitor("a", store, { now: "2026-09-15T12:00:00.000Z", shipments: fail, recalls: fail });
  assert.equal(result.healthy, false);
  assert.equal(result.state.shipments.length, 1); assert.equal(result.state.recalls.length, 1);
  assert.equal(result.state.sources.recalls.dataAsOf, now);
  assert.equal(result.state.sources.recalls.status, "error");
  assert.equal(result.state.newLeadIds.length, 0);
  assert.equal(searchMonitor(result.state, {}, "2026-09-15T12:00:00.000Z").status, "incomplete");
});

test("successful empty refresh replaces old rows; stale files and samples never announce discoveries", async () => {
  const store = memoryStore();
  await refreshMonitor("a", store, inputs);
  const empty = await refreshMonitor("a", store, { ...inputs, recalls: async () => [] });
  assert.equal(empty.state.recalls.length, 0); assert.equal(empty.state.leads.length, 0);
  assert.equal(empty.state.sources.recalls.status, "ok");
  const stale = await refreshMonitor("b", store, { ...inputs, shipments: async () => ({ rows: rows(), observedAt: "2026-08-01T00:00:00.000Z", sample: false }) });
  assert.equal(stale.healthy, false); assert.equal(stale.state.newLeadIds.length, 0);
  const sample = await refreshMonitor("c", store, { ...inputs, shipments: async () => ({ rows: rows().map(r => ({ ...r, sourceType: "sample_fixture" })), observedAt: now, sample: true }) });
  assert.equal(sample.healthy, false); assert.equal(sample.state.leads.length, 0);
});

test("search combines filters, validates pagination, and expires active evidence even if worker stops", async () => {
  const { state } = await refreshMonitor("a", memoryStore(), inputs);
  // params doc must be echoed on real "current"/"incomplete" 200 results too,
  // not just the never_run/error paths — see query.ts comment. Regression
  // guard for an agent that queries a live workspace and needs the field
  // contract from the response body itself.
  assert.ok(searchMonitor(state, {}, now).params);
  assert.equal(searchMonitor(state, { cargo: "BABY", country: "CN", importer: "example", hsChapter: "87" }, now).total, 1);
  assert.equal(searchMonitor(state, { country: "ID" }, now).total, 0);
  assert.equal(searchMonitor(state, { offset: 1 }, now).results.length, 0);
  assert.throws(() => searchMonitor(state, { limit: "nope" }, now));
  assert.throws(() => searchMonitor(state, { country: "China" }, now));
  assert.equal(searchMonitor(state, {}, "2027-09-14T00:00:00.000Z").total, 0);
  assert.equal(searchMonitor(null, {}, now).status, "never_run");
});

test("concurrent snapshot writes cannot both commit the same revision", async () => {
  const store = memoryStore();
  const results = await Promise.allSettled([refreshMonitor("a", store, inputs), refreshMonitor("a", store, inputs)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
});

test("a storage failure propagates so cron cannot report success without persistence", async () => {
  const store: MonitorStore = { read: async () => null, save: async () => { throw new Error("DB offline"); } };
  await assert.rejects(refreshMonitor("a", store, inputs), /DB offline/);
});
