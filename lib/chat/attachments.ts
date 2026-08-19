import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { memories } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  auditDocument,
  DocumentInputError,
  ingestDocument,
  promoteCodesFromDocument,
} from "@/lib/documents/audit";
import { importProductsCsv } from "@/lib/catalogue/products";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import type { JurisdictionName } from "@/lib/countries";

/**
 * What actually happens when a customer drops a file into the chat.
 *
 * The first version of chat upload only put the file's text in the prompt. The
 * model then answered questions about it and — correctly by its instructions,
 * uselessly in practice — told the customer their own KBLI and HS codes were
 * "unconfirmed leads". A customer who has just handed over their own
 * registration documents is not asking to be told the monitor does not believe
 * them. That was a design error, and this module is the fix: an attachment is
 * *acted on*, not merely read.
 *
 * ## The tier reasoning, corrected
 *
 * `origin: "chat"` → `confirmed: false` exists because the model *infers* facts
 * from conversation, and an inference is not evidence. An uploaded document is
 * a different act: the customer is asserting their own facts and attaching the
 * paperwork. That is exactly what the `human` tier means in
 * `lib/checks/facts.ts` — "a person asserts it; better than a guess, still not
 * a PEB". So facts extracted from an upload are stored `origin: "upload"`,
 * `confirmed: true`.
 *
 * What this deliberately does **not** do is promote them to `document` tier.
 * That still requires `promoteCodesFromDocument()`, which refuses anything
 * without a readable document number *and* date, and still lands `proposed`
 * for human approval. Uploading a spreadsheet of codes cannot manufacture
 * customs evidence — but it absolutely should stop the monitor from pretending
 * it never saw them.
 */

export interface AttachmentInput {
  filename: string;
  format: string;
  text: string;
}

export interface AttachmentOutcome {
  filename: string;
  /** Everything that changed, in plain language, for the model to report. */
  actions: string[];
  /** Real limits — what still needs a human, and why. */
  caveats: string[];
  documentId?: string;
}

/** A spreadsheet of SKUs is a catalogue; a PEB is a document. Headers tell them apart. */
function looksLikeCatalogue(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  const hasSku = /\b(sku|product_code|item_code|part_number)\b/.test(firstLine);
  return hasSku && firstLine.includes(",");
}

function saveUploadedFact(
  customerId: string,
  jurisdiction: JurisdictionName,
  content: string,
  filename: string,
): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const existing = db
    .select()
    .from(memories)
    .where(and(eq(memories.customerId, customerId), eq(memories.jurisdiction, jurisdiction)))
    .all();
  // Cheap duplicate guard: the same fact re-uploaded should not stack up.
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (existing.some((row) => row.content.toLowerCase().replace(/\s+/g, " ") === normalized)) {
    return false;
  }

  db.insert(memories)
    .values({
      id: randomUUID(),
      customerId,
      jurisdiction,
      content: trimmed,
      // A customer-supplied document is a person asserting a fact, which is the
      // `human` tier — not a model guess from chat, and not paperwork either.
      origin: "upload",
      source: `Uploaded by the customer in chat: ${filename}`,
      confirmed: true,
      createdAt: new Date().toISOString(),
    })
    .run();
  return true;
}

/**
 * Codes stated in an uploaded file, as plain facts worth remembering.
 * Deliberately regex, not a model call: this decides what gets stored as
 * confirmed, and it must be inspectable and unable to invent a code.
 */
function extractStatedCodes(text: string): { kbli: string[]; hs: string[] } {
  const kbli = new Set<string>();
  const hs = new Set<string>();

  // KBLI is a 5-digit code, usually labelled.
  for (const match of text.matchAll(/\bKBLI[^0-9]{0,20}(\d{5})\b/gi)) kbli.add(match[1]);
  // An HS code is 6-10 digits, dotted or not, and must be labelled to count —
  // an unlabelled 8-digit number in a spreadsheet is as likely to be an invoice
  // number as a tariff code.
  for (const match of text.matchAll(
    /\b(?:HS|H\.S\.|pos tarif|tarif)[^0-9]{0,20}(\d{4}[.\s]?\d{2}(?:[.\s]?\d{2})?(?:[.\s]?\d{2})?)\b/gi,
  )) {
    hs.add(match[1].replace(/\s/g, ""));
  }
  return { kbli: [...kbli], hs: [...hs] };
}

/**
 * File every attachment, and report what changed.
 *
 * Never throws: a filing failure must degrade to a caveat the model can read
 * out, not break the conversation the customer is having.
 */
export async function fileAttachments(
  customerId: string,
  jurisdiction: JurisdictionName,
  attachments: AttachmentInput[],
): Promise<AttachmentOutcome[]> {
  const outcomes: AttachmentOutcome[] = [];
  let touchedChecklist = false;

  for (const attachment of attachments) {
    const outcome: AttachmentOutcome = { filename: attachment.filename, actions: [], caveats: [] };

    try {
      if (looksLikeCatalogue(attachment.text)) {
        const summary = importProductsCsv(customerId, attachment.text);
        outcome.actions.push(
          `Imported into the product catalogue: ${summary.created} created, ${summary.updated} updated.`,
        );
        if (summary.caveats?.length) outcome.caveats.push(...summary.caveats);
        outcome.caveats.push(
          "Codes from a spreadsheet are recorded as leads on each SKU. Approving them as the declared code still needs a person on the Catalogue screen.",
        );
      } else {
        const document = ingestDocument({
          customerId,
          docType: "other",
          filename: attachment.filename,
          text: attachment.text,
        });
        outcome.documentId = document.id;
        const findings = auditDocument(document.id);
        outcome.actions.push(
          `Filed on the Documents screen (parse status: ${document.parseStatus}${
            document.documentNumber ? `, number ${document.documentNumber}` : ""
          }${document.documentDate ? `, dated ${document.documentDate}` : ""}).`,
        );
        if (findings.length > 0) {
          outcome.actions.push(`The audit raised ${findings.length} point(s) to look at.`);
        }

        const promotion = promoteCodesFromDocument(document.id);
        if (promotion.promoted.length > 0) {
          outcome.actions.push(
            `Promoted ${promotion.promoted.length} code(s) to document tier, pending approval.`,
          );
        }
        if (promotion.skipped.length > 0) outcome.caveats.push(...promotion.skipped);
      }

      const stated = extractStatedCodes(attachment.text);
      const saved: string[] = [];
      for (const code of stated.kbli) {
        if (saveUploadedFact(customerId, jurisdiction, `KBLI ${code}`, attachment.filename)) {
          saved.push(`KBLI ${code}`);
        }
      }
      for (const code of stated.hs) {
        if (saveUploadedFact(customerId, jurisdiction, `HS code ${code}`, attachment.filename)) {
          saved.push(`HS ${code}`);
        }
      }
      if (saved.length > 0) {
        outcome.actions.push(`Saved to Memory as confirmed customer facts: ${saved.join(", ")}.`);
        touchedChecklist = true;
      }
    } catch (error) {
      const message =
        error instanceof DocumentInputError || error instanceof Error
          ? error.message
          : String(error);
      outcome.caveats.push(`Could not file this file: ${message}`);
    }

    outcomes.push(outcome);
  }

  if (touchedChecklist) {
    try {
      await refreshChecklistForCustomer(customerId, jurisdiction);
    } catch {
      // The checklist refreshing is a convenience; failing it must not lose the
      // facts that were already saved.
    }
  }
  return outcomes;
}

/** Render what was done, for the chat prompt. */
export function renderAttachmentOutcomes(outcomes: AttachmentOutcome[]): string {
  if (outcomes.length === 0) return "";
  const blocks = outcomes.map((outcome) => {
    const actions = outcome.actions.length
      ? outcome.actions.map((a) => `- ${a}`).join("\n")
      : "- Nothing could be filed from this file.";
    const caveats = outcome.caveats.length
      ? `\nNarrower points, true only of customs-grade evidence:\n${outcome.caveats
          .map((c) => `- ${c}`)
          .join("\n")}`
      : "";
    return `### ${outcome.filename}\n${actions}${caveats}`;
  });
  return (
    "## What was already done with the attached files\n\n" +
    "Every line below has ALREADY been carried out before you were asked. It is a record of " +
    "completed actions, not a plan. Report it as done.\n\n" +
    "**Do not contradict it.** If a line says a fact was saved as confirmed, it IS confirmed and " +
    "stored — never tell the customer it was 'logged as a lead' or 'still needs confirming'. " +
    "A code the customer supplied in their own document is a confirmed customer fact and the " +
    "monitor now uses it.\n\n" +
    "The one real distinction, and the only one worth mentioning: a confirmed customer fact is " +
    "not the same as *customs-grade* evidence. Only a PEB or invoice carrying a document number " +
    "and date can back a declaration to customs. So a spreadsheet of codes is fully recorded and " +
    "acted on, while still not being the paperwork that proves a declaration. Say that once, " +
    "briefly, and only if it matters to what they asked.\n\n" +
    "If the codes conflict with what is already on record, say so plainly and ask which is " +
    "current — that is a genuinely useful question, unlike asking them to re-confirm.\n\n" +
    `${blocks.join("\n\n")}\n\n`
  );
}
