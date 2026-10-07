import assert from "node:assert/strict";
import test from "node:test";
import { getProvider, type CompletionRequest } from "@/lib/llm";
import { applyColumnMapping, canonicalFields, proposeColumnMapping, type ColumnMapping } from "./column-mapping";
import { parseImpactTable, parseMappedBusinessImpact } from "./business-impact";

const empty = () => Object.fromEntries(canonicalFields.map(field => [field, null])) as ColumnMapping["mapping"];

test("mapping preserves exact Unicode headers, never guesses aliases, and retains original evidence", () => {
  const table = parseImpactTable('Item Name,品目,Country of manufacture,Vendor,Spend,Percent,sku,qty\nA,0101,CA,Acme,1000,5,wrong,0', true);
  const mapping = { ...empty(), sku: "Item Name", hts: "品目", origin: "Country of manufacture", supplier: "Vendor", annual_import_value_usd: "Spend", current_duty_rate: "Percent", quantity: "qty" };
  const before = JSON.stringify(table);
  const rows = applyColumnMapping(table, mapping);
  const [row] = parseMappedBusinessImpact(rows, table.rows);
  assert.equal(row.input_valid, true);
  assert.equal(row.sku, "A"); assert.equal(row.quantity, 0); assert.equal(row.current_duty_rate, .05);
  assert.equal(row.raw_input["Item Name"], "A"); assert.equal(row.raw_input.sku, "wrong");
  assert.equal(JSON.stringify(table), before);
  assert.equal(applyColumnMapping(table, empty())[0].sku, "");
  assert.throws(() => applyColumnMapping(table, { ...mapping, sku: "invented" }));
  assert.throws(() => applyColumnMapping(table, {} as ColumnMapping["mapping"]));
  assert.throws(() => parseImpactTable("A,A\n1,2", true));
  const unusual = parseImpactTable("__proto__,constructor\nitem,0101", true);
  assert.equal(applyColumnMapping(unusual, { ...empty(), sku: "__proto__" })[0].sku, "item");
});

test("AI sees only five samples, uses existing JSON seam, and cannot invent a header", async t => {
  const headers = ["Item Name"];
  const mapping = { ...empty(), sku: "Item Name" };
  const confidence = Object.fromEntries(canonicalFields.map(field => [field, .5]));
  let response = { mapping, confidence };
  const prototype = Object.getPrototypeOf(getProvider());
  t.mock.method(prototype, "complete", async (req: CompletionRequest) => {
    assert.deepEqual(req.tools, []);
    assert.match(req.system, /pick only from the given header names, do not calculate anything, do not infer values/);
    assert.equal(JSON.parse(req.prompt).sampleRows.length, 5);
    assert.ok(!req.prompt.includes("SIXTH_ROW_SECRET"));
    assert.ok(!req.prompt.includes("NON_HEADER_SECRET"));
    return { text: JSON.stringify(response), provider: "test", durationMs: 1 };
  });
  const samples = Array.from({ length: 6 }, (_, i) => ({ "Item Name": i === 5 ? "SIXTH_ROW_SECRET" : "A", extra: "NON_HEADER_SECRET" }));
  assert.deepEqual((await proposeColumnMapping(headers, samples)).mapping, mapping);
  response = { ...response, mapping: { ...mapping, sku: "invented" } };
  await assert.rejects(proposeColumnMapping(headers, samples));
});
