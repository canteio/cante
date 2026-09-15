import { createHash, randomUUID } from "node:crypto";
import { getDataBackend } from "@/lib/auth/config";
import {
  auditDocument,
  DocumentInputError,
  ingestDocument,
  promoteCodesFromDocument,
} from "@/lib/documents/audit";
import { importProductsCsv } from "@/lib/catalogue/products";
import { parseCsv } from "@/lib/catalogue/csv";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import type { JurisdictionName } from "@/lib/countries";
import { addMemory } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";

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

/**
 * A spreadsheet of SKUs is a catalogue; a PEB is a document. Headers tell them apart.
 *
 * Exported (was previously private) so it can be unit-tested directly instead
 * of only indirectly through `fileAttachments`, which needs a live DB/Supabase
 * backend to exercise at all. This function has no such dependency and the
 * catalogue/document fork it drives is worth locking down on its own.
 */
export function looksLikeCatalogue(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  const hasSku = /\b(sku|product_code|item_code|part_number)\b/.test(firstLine);
  return hasSku && firstLine.includes(",");
}

async function saveUploadedFact(
  customerId: string,
  jurisdiction: JurisdictionName,
  content: string,
  filename: string,
): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const inserted = await addMemory({
    customerId,
    jurisdiction,
    kind: trimmed.toUpperCase().startsWith("KBLI") ? "kbli" : "hs_code",
    content: trimmed,
    origin: "upload",
    source: `Uploaded by the customer in chat: ${filename}`,
    confirmed: true,
  });
  return inserted !== null;
}

function chunks(text: string, maxLength = 1_800): string[] {
  const result: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    if (current && current.length + paragraph.length + 2 > maxLength) {
      result.push(current);
      current = "";
    }
    if (paragraph.length <= maxLength) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) result.push(current);
    for (let start = 0; start < paragraph.length; start += maxLength) {
      result.push(paragraph.slice(start, start + maxLength));
    }
  }
  if (current) result.push(current);
  return result;
}

async function fileCloudDocument(
  customerId: string,
  jurisdiction: JurisdictionName,
  attachment: AttachmentInput,
): Promise<string> {
  const supabase = await createClient();
  const documentId = randomUUID();
  const { error: documentError } = await supabase.from("trade_documents").insert({
    id: documentId,
    customer_id: customerId,
    doc_type: "other",
    filename: attachment.filename,
    parse_status: "partial",
    parse_note: "Text extracted in chat; no customs-grade audit has run in the hosted app.",
    extracted: { format: attachment.format },
    raw_text: attachment.text,
  });
  if (documentError) throw new Error(`Supabase document filing failed: ${documentError.message}`);

  const rows = chunks(attachment.text).map((content, chunkIndex) => ({
    customer_id: customerId,
    document_id: documentId,
    jurisdiction,
    chunk_index: chunkIndex,
    content,
    content_hash: createHash("sha256").update(content).digest("hex"),
  }));
  if (rows.length) {
    const { error } = await supabase.from("document_chunks").insert(rows);
    if (error) throw new Error(`Supabase document indexing failed: ${error.message}`);
  }
  return documentId;
}

export async function importCloudCatalogue(customerId: string, text: string) {
  const supabase = await createClient();
  const table = parseCsv(text);
  const skuHeader = ["sku", "product_code", "item_code", "part_number"].find((key) =>
    table.headers.includes(key),
  );
  if (!skuHeader) throw new Error("The catalogue has no SKU, product_code, item_code, or part_number column.");

  let created = 0;
  let updated = 0;
  for (const row of table.rows) {
    const sku = row[skuHeader]?.trim();
    if (!sku) continue;
    const { data: existing, error: readError } = await supabase
      .from("products")
      .select("id")
      .eq("customer_id", customerId)
      .eq("sku", sku)
      .maybeSingle();
    if (readError) throw new Error(`Supabase catalogue lookup failed: ${readError.message}`);
    const values = {
      customer_id: customerId,
      sku,
      name: row.name || row.product_name || row.description || sku,
      description: row.description || null,
      materials: (row.materials || "").split(/[;|]/).map((value) => value.trim()).filter(Boolean),
      origin_country: row.origin_country || row.country_of_origin || null,
      unit_of_measure: row.unit_of_measure || row.uom || null,
      notes: row.notes || null,
      updated_at: new Date().toISOString(),
    };
    const query = existing
      ? supabase.from("products").update(values).eq("id", existing.id)
      : supabase.from("products").insert({ id: randomUUID(), ...values });
    const { error } = await query;
    if (error) throw new Error(`Supabase catalogue write failed for ${sku}: ${error.message}`);
    if (existing) updated += 1;
    else created += 1;
  }
  return { created, updated };
}

/**
 * Codes stated in an uploaded file, as plain facts worth remembering.
 * Deliberately regex, not a model call: this decides what gets stored as
 * confirmed, and it must be inspectable and unable to invent a code.
 */
export function extractStatedCodes(text: string): { kbli: string[]; hs: string[] } {
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
        const summary =
          getDataBackend() === "supabase"
            ? await importCloudCatalogue(customerId, attachment.text)
            : importProductsCsv(customerId, attachment.text);
        outcome.actions.push(
          `Imported into the product catalogue: ${summary.created} created, ${summary.updated} updated.`,
        );
        const caveats = "caveats" in summary ? (summary.caveats as string[] | undefined) : undefined;
        if (caveats?.length) outcome.caveats.push(...caveats);
        outcome.caveats.push(
          "Codes from a spreadsheet are recorded as leads on each SKU. Approving them as the declared code still needs a person on the Catalogue screen.",
        );
      } else if (getDataBackend() === "supabase") {
        outcome.documentId = await fileCloudDocument(customerId, jurisdiction, attachment);
        outcome.actions.push("Filed on the Documents screen and indexed for tenant-scoped chat retrieval.");
        outcome.caveats.push(
          "The hosted app stored and indexed the extracted text, but customs-grade document auditing still runs in the local worker.",
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
        if (await saveUploadedFact(customerId, jurisdiction, `KBLI ${code}`, attachment.filename)) {
          saved.push(`KBLI ${code}`);
        }
      }
      for (const code of stated.hs) {
        if (await saveUploadedFact(customerId, jurisdiction, `HS code ${code}`, attachment.filename)) {
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

  if (touchedChecklist && getDataBackend() === "sqlite") {
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
