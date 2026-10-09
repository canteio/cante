import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { extractTextFromFile, FileExtractionError } from "@/lib/documents/extract-file";

/**
 * The whole point of this layer is that an unreadable file is refused rather
 * than turned into empty-but-clean output, so most of these tests assert a
 * refusal.
 */

function xlsx(sheets: string[], sharedStrings?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8("<workbook/>"),
  };
  if (sharedStrings) files["xl/sharedStrings.xml"] = strToU8(sharedStrings);
  sheets.forEach((xml, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(xml);
  });
  return zipSync(files);
}

test("an .xlsx resolves shared strings into real cell text", async () => {
  // Excel stores text once and references it by index. Reading the sheet alone
  // yields "0,1" — the indexes — which would import as garbage SKUs.
  const shared =
    '<sst><si><t>sku</t></si><si><t>hs_code</t></si><si><t>PVC-100</t></si><si><t>6306.12.00</t></si></sst>';
  const sheet =
    '<worksheet><sheetData>' +
    '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>' +
    '<row><c t="s"><v>2</v></c><c t="s"><v>3</v></c></row>' +
    "</sheetData></worksheet>";

  const result = await extractTextFromFile("catalogue.xlsx", xlsx([sheet], shared));
  assert.equal(result.format, "xlsx");
  assert.equal(result.text, "sku,hs_code\nPVC-100,6306.12.00");
});

test("a multi-sheet workbook reads every sheet and says that it did", async () => {
  const sheet = (v: string) =>
    `<worksheet><sheetData><row><c t="inlineStr"><t>${v}</t></c></row></sheetData></worksheet>`;
  const result = await extractTextFromFile("book.xlsx", xlsx([sheet("one"), sheet("two")]));

  assert.equal(result.text, "one\ntwo");
  assert.ok(
    result.warnings.some((w) => w.includes("2 sheets")),
    "silently flattening sheets is how the wrong rows come to look right",
  );
});

test("an empty spreadsheet is refused, not imported as nothing", async () => {
  const empty = "<worksheet><sheetData></sheetData></worksheet>";
  await assert.rejects(
    () => extractTextFromFile("empty.xlsx", xlsx([empty])),
    (error: Error) => error instanceof FileExtractionError && /every cell was empty/.test(error.message),
  );
});

test("a .docx joins runs within a paragraph but keeps paragraphs apart", async () => {
  // Word splits a line into runs wherever formatting changes, so "Tanggal: " and
  // the date are separate <w:t> nodes in one paragraph.
  const document =
    "<w:document><w:body>" +
    "<w:p><w:r><w:t>Nomor: 000123</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Tanggal: </w:t></w:r><w:r><w:t>12/08/2026</w:t></w:r></w:p>" +
    "</w:body></w:document>";
  const file = zipSync({ "word/document.xml": strToU8(document) });

  const result = await extractTextFromFile("peb.docx", file);
  assert.equal(result.text, "Nomor: 000123\nTanggal: 12/08/2026");
});

test("a Word file with no text is refused rather than audited as clean", async () => {
  const file = zipSync({ "word/document.xml": strToU8("<w:document><w:body/></w:document>") });
  await assert.rejects(
    () => extractTextFromFile("scan.docx", file),
    (error: Error) => error instanceof FileExtractionError && /OCR is not supported/.test(error.message),
  );
});

test("csv and txt pass through untouched", async () => {
  const csv = await extractTextFromFile("p.csv", strToU8("sku,name\nA,B"));
  assert.equal(csv.format, "csv");
  assert.equal(csv.text, "sku,name\nA,B");

  const txt = await extractTextFromFile("notes.txt", strToU8("hello"));
  assert.equal(txt.format, "text");
});

test("legacy Office formats are refused with the fix, not silently mangled", async () => {
  await assert.rejects(
    () => extractTextFromFile("old.xls", strToU8("anything")),
    (error: Error) => /save as \.xlsx or CSV/.test(error.message),
  );
  await assert.rejects(
    () => extractTextFromFile("old.doc", strToU8("anything")),
    (error: Error) => /save as \.docx/.test(error.message),
  );
});

test("an unknown or extensionless file is refused", async () => {
  await assert.rejects(
    () => extractTextFromFile("photo.jpg", strToU8("x")),
    (error: Error) => /not supported/.test(error.message),
  );
  await assert.rejects(
    () => extractTextFromFile("noext", strToU8("x")),
    (error: Error) => /no extension/.test(error.message),
  );
});

test("an empty file is refused", async () => {
  await assert.rejects(
    () => extractTextFromFile("empty.csv", new Uint8Array()),
    (error: Error) => /empty/.test(error.message),
  );
});

test("an oversized file is refused before it is parsed", async () => {
  await assert.rejects(
    () => extractTextFromFile("huge.pdf", new Uint8Array(16 * 1024 * 1024)),
    (error: Error) => /over the 15MB limit/.test(error.message),
  );
});

test("a corrupt archive is refused with a recoverable suggestion", async () => {
  await assert.rejects(
    () => extractTextFromFile("broken.xlsx", strToU8("this is not a zip")),
    (error: Error) => /could not be opened/.test(error.message),
  );
});

test("Office archives reject excessive expanded data before XML parsing", async () => {
  const { zipSync } = await import("fflate");
  const compressed = zipSync({ "word/document.xml": new Uint8Array(33 * 1024 * 1024) });
  await assert.rejects(extractTextFromFile("large.docx", compressed), /expanded-size/);
});
