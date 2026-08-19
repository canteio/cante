import assert from "node:assert/strict";
import test from "node:test";
import { renderAttachmentOutcomes, type AttachmentOutcome } from "@/lib/chat/attachments";

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
