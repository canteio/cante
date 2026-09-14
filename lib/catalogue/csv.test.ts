import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "@/lib/catalogue/csv";

test("parseCsv returns empty table for blank input", () => {
  const table = parseCsv("");
  assert.deepEqual(table.headers, []);
  assert.deepEqual(table.rows, []);
});

test("parseCsv returns empty table for whitespace-only input", () => {
  const table = parseCsv("\n\r\n   \n");
  assert.deepEqual(table.headers, []);
  assert.deepEqual(table.rows, []);
});

test("parseCsv handles a file with no trailing newline", () => {
  const table = parseCsv("sku,name\nA-1,Widget");
  assert.deepEqual(table.headers, ["sku", "name"]);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].sku, "A-1");
  assert.equal(table.rows[0].name, "Widget");
});

test("parseCsv normalizes headers to snake_case lowercase", () => {
  const table = parseCsv("SKU, Product Name ,HS Code\nA-1,Widget,1234.56\n");
  assert.deepEqual(table.headers, ["sku", "product_name", "hs_code"]);
});

test("parseCsv fills missing trailing columns as empty strings", () => {
  const table = parseCsv("sku,name,hs_code\nA-1,Widget\n");
  assert.equal(table.rows[0].sku, "A-1");
  assert.equal(table.rows[0].name, "Widget");
  assert.equal(table.rows[0].hs_code, "");
});

test("parseCsv drops a leading UTF-8 BOM", () => {
  const table = parseCsv("\uFEFFsku,name\nA-1,Widget\n");
  assert.deepEqual(table.headers, ["sku", "name"]);
  assert.equal(table.rows[0].sku, "A-1");
});

test("parseCsv handles multiple quoted fields with commas in one row", () => {
  const table = parseCsv(
    'sku,name,notes\nA-1,"Acme, Inc.","Ships via ""FastFreight, LLC"""\n',
  );
  assert.equal(table.rows[0].name, "Acme, Inc.");
  assert.equal(table.rows[0].notes, 'Ships via "FastFreight, LLC"');
});

test("parseCsv skips fully blank rows between data rows", () => {
  const table = parseCsv("sku,name\nA-1,Widget\n\nA-2,Gadget\n");
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[1].sku, "A-2");
});
