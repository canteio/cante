import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb } from "@/lib/test-support/operating-db";

before(async () => {
  await operatingDb();
});

const PEB = `
PEMBERITAHUAN EKSPOR BARANG
Nomor Pendaftaran: 000123
Tanggal: 12/08/2026
Eksportir: PT MA
Negara Tujuan: Netherlands
Currency: USD

1  PVC-100  Blue PVC tarpaulin 12oz  6306.12.00  origin: Indonesia  1200 pcs  48000.00
2  PVC-200  Green PVC tarpaulin      6306.19.90  origin: Indonesia  800 pcs   32000.00
Total Value: 80000.00
`;

test("a document with no readable content fails loudly instead of reading as clean", async () => {
  const { customerId } = await operatingDb();
  const { ingestDocument, DocumentInputError } = await import("@/lib/documents/audit");
  assert.throws(
    () => ingestDocument({ customerId, docType: "peb", filename: "scan.pdf", text: "   " }),
    (error: Error) => error instanceof DocumentInputError && /OCR are not supported/.test(error.message),
  );
});

test("header and line items are extracted, and parse status reflects what was read", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv } = await import("@/lib/catalogue/products");
  const { ingestDocument } = await import("@/lib/documents/audit");

  importProductsCsv(customerId, "sku,name\nPVC-100,Blue tarp\nPVC-200,Green tarp\n");
  const doc = ingestDocument({ customerId, docType: "peb", filename: "peb.txt", text: PEB });

  assert.equal(doc.parseStatus, "parsed");
  assert.equal(doc.documentNumber, "000123");
  assert.equal(doc.documentDate, "2026-08-12");
  assert.equal(doc.extracted?.lines.length, 2);
  assert.equal(doc.extracted?.lines[0].sku, "PVC-100");
  assert.equal(doc.extracted?.lines[0].hsCode, "6306.12.00");
  assert.equal(doc.extracted?.destinationCountry, "Netherlands");
});

test("document/invoice numbers are not mistaken for HS codes", async () => {
  const { extractDocument } = await import("@/lib/documents/audit");

  // "000123" is six digits and was previously read as heading 0001.23, which
  // invented a line item out of the document's own registration number.
  const lines = extractDocument("Nomor Pendaftaran: 000123\nInvoice No: 445566\n").lines;
  assert.equal(lines.length, 0);

  // All three real forms still parse.
  assert.equal(extractDocument("item 6306.12.00 x2").lines[0]?.hsCode, "6306.12.00");
  assert.equal(extractDocument("item 6306 12 00 x2").lines[0]?.hsCode, "63061200");
  assert.equal(extractDocument("item 63061200 x2").lines[0]?.hsCode, "63061200");
  // Chapter 99 is HTSUS Section 301/232 territory and must parse.
  assert.equal(extractDocument("ref 9903.88.15").lines[0]?.hsCode, "9903.88.15");
  assert.equal(extractDocument("ref 0001.23").lines.length, 0, "chapter 00 does not exist");
});

test("a document with lines but no header is `partial`, and says so", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv } = await import("@/lib/catalogue/products");
  const { ingestDocument } = await import("@/lib/documents/audit");

  importProductsCsv(customerId, "sku,name\nPVC-100,Blue tarp\n");
  const doc = ingestDocument({
    customerId,
    docType: "commercial_invoice",
    filename: "inv.txt",
    text: "PVC-100  Blue tarp  6306.12.00  100 pcs  4000.00\n",
  });
  assert.equal(doc.parseStatus, "partial");
  assert.match(doc.parseNote ?? "", /no document number or date/);
});

test("audit reports both sides of a code mismatch and the tier of the expectation", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv, getProductBySku } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { ingestDocument, auditDocument } = await import("@/lib/documents/audit");

  importProductsCsv(customerId, "sku,name\nPVC-100,Blue tarp\nPVC-200,Green tarp\n");
  const product = getProductBySku(customerId, "PVC-100");
  assert.ok(product);
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "3921.90.00",
    tier: "lead",
    basis: "seed guess",
  });

  const doc = ingestDocument({ customerId, docType: "peb", filename: "peb.txt", text: PEB });
  const found = auditDocument(doc.id);

  const mismatch = found.find((f) => f.kind === "code_mismatch");
  assert.ok(mismatch, "the document's 6306.12.00 contradicts the catalogue's 3921.90.00");
  assert.equal(mismatch.documentValue, "6306.12.00");
  assert.equal(mismatch.expectedValue, "3921.90.00");
  assert.equal(mismatch.expectationTier, "lead");
  assert.equal(mismatch.severity, "medium", "a lead-tier expectation is not a high-severity conflict");
});

test("origin mismatch is high severity and names both values", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { ingestDocument, auditDocument } = await import("@/lib/documents/audit");

  upsertProduct(customerId, { sku: "PVC-100", name: "Blue tarp", originCountry: "Vietnam" });
  const doc = ingestDocument({ customerId, docType: "peb", filename: "peb.txt", text: PEB });
  const found = auditDocument(doc.id);

  const origin = found.find((f) => f.kind === "origin_mismatch");
  assert.ok(origin);
  assert.equal(origin.severity, "high");
  assert.equal(origin.documentValue, "Indonesia");
  assert.equal(origin.expectedValue, "Vietnam");
});

test("a document promotes codes to document tier — still proposed, never auto-approved", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv, getProductBySku } = await import("@/lib/catalogue/products");
  const { resolveProductCodes } = await import("@/lib/catalogue/classifications");
  const { ingestDocument, promoteCodesFromDocument } = await import("@/lib/documents/audit");

  importProductsCsv(customerId, "sku,name\nPVC-100,Blue tarp\nPVC-200,Green tarp\n");
  const doc = ingestDocument({ customerId, docType: "peb", filename: "peb.txt", text: PEB });
  const result = promoteCodesFromDocument(doc.id);

  assert.equal(result.promoted.length, 2);
  const product = getProductBySku(customerId, "PVC-100");
  assert.ok(product);
  const resolved = resolveProductCodes(product.id, "hs");
  assert.equal(resolved.documentVerified, true, "this is the only automated path to document tier");
  assert.equal(resolved.document[0].status, "proposed", "a human still approves");
  assert.match(resolved.document[0].basis, /peb 000123 dated 2026-08-12/i);
});

test("an uncitable document promotes nothing", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv } = await import("@/lib/catalogue/products");
  const { ingestDocument, promoteCodesFromDocument } = await import("@/lib/documents/audit");

  importProductsCsv(customerId, "sku,name\nPVC-100,Blue tarp\n");
  const doc = ingestDocument({
    customerId,
    docType: "peb",
    filename: "fragment.txt",
    text: "PVC-100  6306.12.00  100 pcs\n",
  });
  const result = promoteCodesFromDocument(doc.id);
  assert.equal(result.promoted.length, 0);
  assert.match(result.skipped[0], /cannot be cited as evidence/);
});
