import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateDemo, catalogueCsv, exampleProducts, historyCsv, parseDemoCatalogue, parseDemoHistory, DEMO_LABEL, demoResultCsv, demoChatContext, dutyCents } from "../components/tariff/demo-scenario";
const input = { catalogueCsv: catalogueCsv(), historyCsv: historyCsv(), regulationId: "sim-cn-25" };

test("50 distinct synthetic products and 600 identifiable import lines reconcile independently", () => {
  const products = parseDemoCatalogue(input.catalogueCsv), history = parseDemoHistory(input.historyCsv, products);
  assert.equal(products.length, 50); assert.equal(new Set(products.map(p => p.sku)).size, 50); assert.equal(history.length, 600);
  for (const p of products) {
    const entries = history.filter(h => h.sku === p.sku);
    assert.equal(entries.length, 12);
    assert.equal(entries.reduce((n, h) => n + h.units, 0), p.annualUnits);
    assert.equal(entries.reduce((n, h) => n + h.customsValueCents, 0), p.unitValueCents * p.annualUnits);
    assert.equal(new Set(entries.map(h => `${h.entryId}/${h.line}`)).size, 12);
  }
  assert.equal(history[0].date, "2025-10-15"); assert.equal(history[11].date, "2026-09-15");
});
test("known 25-point China scenario produces hand-reconciled impact, deterministic ranks and exact exports", () => {
  const r = calculateDemo(input);
  assert.equal(r.affectedCount, 18); assert.equal(r.totalExtraCents, 881730000);
  assert.equal(r.monthlyEquivalentCents, 73477500);
  assert.equal(r.afterCents - r.beforeCents, r.totalExtraCents);
  assert.equal(r.rows.reduce((n, row) => n + row.extraCents, 0), r.totalExtraCents);
  assert.deepEqual(r.topFive.map(row => [row.sku, row.extraCents]), [["DEMO-MOW-005",164280000],["DEMO-DEK-005",91168000],["DEMO-MOW-002",89355000],["DEMO-ENG-005",81696000],["DEMO-MOW-001",69375000]]);
  assert.deepEqual(calculateDemo(input), r);
});
test("only origin AND HTS scope match, not all China imports or all similarly coded products", () => {
  const r = calculateDemo(input);
  assert(r.rows.filter(row => row.origin !== "CN").every(row => !row.affected));
  assert.equal(r.rows.find(row => row.sku === "DEMO-PMP-001")?.extraCents, 0);
  assert.equal(r.rows.find(row => row.sku === "DEMO-MOW-003")?.extraCents, 0);
  assert.equal(r.rows.find(row => row.sku === "DEMO-MOW-001")?.extraCents, 69375000);
});
test("no-change scenario is zero and import history never drives annual forecasts or gets rewritten", () => {
  const before = calculateDemo(input), control = calculateDemo({ ...input, regulationId: "sim-control" });
  assert.equal(control.affectedCount, 0); assert.equal(control.totalExtraCents, 0); assert.deepEqual(control.topFive, []);
  assert.deepEqual(control.history, before.history);
  assert.equal(calculateDemo({ ...input, historyCsv: "" }).totalExtraCents, before.totalExtraCents);
  const products = exampleProducts(); products[0].annualUnits *= 2;
  assert.equal(calculateDemo({ ...input, catalogueCsv: catalogueCsv(products) }).totalExtraCents, before.totalExtraCents + 69375000);
});
test("percentage points are additive and half-cent rounding reconciles rounded before/after", () => {
  const p = { ...exampleProducts()[0], unitValueCents: 101, annualUnits: 1, baselineBps: 400 };
  const r = calculateDemo({ catalogueCsv: catalogueCsv([p]), historyCsv: "", regulationId: "sim-cn-25" });
  assert.equal(r.beforeCents, 4); assert.equal(r.afterCents, 29); assert.equal(r.totalExtraCents, 25);
  assert.equal(dutyCents(1, 5000), 1);
});
test("malformed, duplicate, unlabelled, incomplete and unsafe numerical inputs fail visibly", () => {
  assert.throws(() => calculateDemo({ ...input, regulationId: "made-up" }), /known simulated/);
  assert.throws(() => parseDemoCatalogue(input.catalogueCsv.replaceAll(DEMO_LABEL, "real data")), /labelled fictional/);
  assert.throws(() => parseDemoCatalogue(catalogueCsv([exampleProducts()[0], exampleProducts()[0]])), /unique DEMO/);
  assert.throws(() => parseDemoCatalogue(input.catalogueCsv.replace("8433.11.00.10", "8433")), /10 digits/);
  assert.throws(() => parseDemoCatalogue(input.catalogueCsv.replace("1850.00", "")), /decimal/);
  assert.throws(() => parseDemoCatalogue(input.catalogueCsv.replace("1500", "1.5")), /whole number/);
  const unsafe = input.catalogueCsv.replace("1850.00", "9999999999.99").replace("1500", "99999999");
  assert.throws(() => calculateDemo({ ...input, catalogueCsv: unsafe, historyCsv: "" }), /integer range/);
  assert.throws(() => parseDemoHistory(input.historyCsv.replace("2025-10-15", "2025-02-30"), exampleProducts()), /invalid date/);
  assert.throws(() => parseDemoHistory(input.historyCsv.replace("DEMO-MOW-001", "DEMO-UNKNOWN"), exampleProducts()), /unknown SKU/);
});
test("downloaded fixtures match the generator, reports contain all rows and chat carries formatted figures", () => {
  assert.equal(readFileSync("public/examples/equipment-demo/products.csv", "utf8"), input.catalogueCsv);
  assert.equal(readFileSync("public/examples/equipment-demo/imports.csv", "utf8"), input.historyCsv);
  const r = calculateDemo(input); const context = demoChatContext(r);
  assert.match(context, /\$8,817,300\.00/); assert.match(context, /\$734,775\.00/);
  assert.match(context, /DEMO-WHL-005/); assert.match(context, /FICTIONAL|Fictional/);
  assert.equal(demoResultCsv(r).trim().split("\r\n").length, 51);
});

test("chat receives deterministic monthly and per-SKU history, with bounded matching entry details", () => {
  const r = calculateDemo(input); const context = demoChatContext(r, "Show DEMO-MOW-001 imports in September");
  assert.match(context, /"month":"2026-09"/);
  assert.match(context, /"historicalImports"/);
  assert.match(context, /"matchingEntryCount":1/);
  assert.match(context, /DEMO-ENTRY-202609-MOW-001/);
  assert.doesNotMatch(context, /DEMO-ENTRY-202608-MOW-001/);
});
