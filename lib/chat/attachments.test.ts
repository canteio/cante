import assert from "node:assert/strict";
import test from "node:test";
import {
  extractStatedCodes,
  looksLikeCatalogue,
  renderAttachmentOutcomes,
  type AttachmentOutcome,
} from "@/lib/chat/attachments";

/**
 * The failure these guard against is a real one, seen in a live chat: the
 * customer uploaded their own KBLI and HS codes and was told the monitor could
 * not confirm them. A customer is the authority on their own registration.
 */

function outcome(overrides: Partial<AttachmentOutcome> = {}): AttachmentOutcome {
  return {
    filename: "kbli.xlsx",
    actions: ["Saved to Memory as confirmed customer facts: KBLI 22292."],
    caveats: [],
    ...overrides,
  };
}

test("the prompt block states the actions are already done, not a plan", () => {
  const rendered = renderAttachmentOutcomes([outcome()]);
  assert.match(rendered, /ALREADY been carried out/);
  assert.match(rendered, /Report it as done/);
});

test("the model is forbidden from re-describing a confirmed fact as a lead", () => {
  // This is the exact sentence a live run produced and must not produce again.
  const rendered = renderAttachmentOutcomes([outcome()]);
  assert.match(rendered, /Do not contradict it/);
  assert.match(rendered, /never tell the customer it was 'logged as a lead'/);
});

test("the customs-grade distinction survives, because it is the one that is real", () => {
  // Confirmed customer fact != evidence behind a customs declaration. Losing
  // this would be the opposite failure: laundering a spreadsheet into paperwork.
  const rendered = renderAttachmentOutcomes([outcome()]);
  assert.match(rendered, /customs-grade/);
  assert.match(rendered, /PEB or invoice carrying a document number/);
});

test("a document-tier caveat is scoped so it cannot be read as applying to everything", () => {
  // The live failure: promoteCodesFromDocument()'s "no number or date, codes
  // were not promoted" caveat was read as though it undid the memory save.
  const rendered = renderAttachmentOutcomes([
    outcome({
      caveats: ["The document has no readable number or date, so it cannot be cited as evidence."],
    }),
  ]);
  assert.match(rendered, /true only of customs-grade evidence/);
});

test("conflicting codes are surfaced as a question, not as a demand to re-confirm", () => {
  const rendered = renderAttachmentOutcomes([outcome()]);
  assert.match(rendered, /ask which is\s+current/);
  assert.match(rendered, /unlike asking them to re-confirm/);
});

test("a file that could not be filed says so rather than going quiet", () => {
  const rendered = renderAttachmentOutcomes([outcome({ actions: [] })]);
  assert.match(rendered, /Nothing could be filed from this file/);
});

test("no attachments renders nothing at all", () => {
  assert.equal(renderAttachmentOutcomes([]), "");
});

/**
 * The fork these two functions drive (catalogue import vs. document filing,
 * and which codes get written to Memory as confirmed facts) previously had no
 * direct coverage — only the exported entry point above was tested, and that
 * only through `renderAttachmentOutcomes`. Both are plain, DB-free functions,
 * so they're covered here directly rather than only through the DB-backed
 * `fileAttachments` (which this test file can't exercise without sqlite).
 */

test("looksLikeCatalogue recognises a SKU header with commas", () => {
  assert.equal(looksLikeCatalogue("sku,name,hs_code\nA-1,Widget,1234.56\n"), true);
  assert.equal(looksLikeCatalogue("product_code,description\nA-1,Widget\n"), true);
});

test("looksLikeCatalogue rejects prose and headers with no comma", () => {
  assert.equal(looksLikeCatalogue("Invoice No. 12345\nDate: 2026-01-01\n"), false);
  assert.equal(looksLikeCatalogue("sku name hs_code\n"), false);
});

test("looksLikeCatalogue only looks at the first line", () => {
  const text = "Bill of lading\nsku,name\nA-1,Widget\n";
  assert.equal(looksLikeCatalogue(text), false, "a catalogue header two lines down doesn't count");
});

test("extractStatedCodes finds a labelled KBLI code", () => {
  const { kbli, hs } = extractStatedCodes("Our KBLI code is 46209 for this line of business.");
  assert.deepEqual(kbli, ["46209"]);
  assert.deepEqual(hs, []);
});

test("extractStatedCodes finds labelled HS codes in dotted and undotted form", () => {
  const { hs } = extractStatedCodes("HS 6306.12.00 for the tarp, and HS code 62034200 for the jacket.");
  assert.deepEqual(hs, ["6306.12.00", "62034200"]);
});

test("extractStatedCodes ignores unlabelled numbers", () => {
  // An invoice number or quantity must never be mistaken for a tariff code.
  const { kbli, hs } = extractStatedCodes("Invoice 12345678, qty 4620900, total 46209.00 USD.");
  assert.deepEqual(kbli, []);
  assert.deepEqual(hs, []);
});

test("extractStatedCodes de-duplicates repeated mentions of the same code", () => {
  const { hs } = extractStatedCodes("HS 6306.12.00 appears here and again as HS code 6306.12.00.");
  assert.deepEqual(hs, ["6306.12.00"]);
});
