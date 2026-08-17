import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documentFindings,
  tradeDocuments,
  type DocumentFinding,
  type ExtractedDocument,
  type ExtractedLine,
  type TradeDocument,
} from "@/lib/db/schema";
import { getProductBySku, listProducts } from "@/lib/catalogue/products";
import { listClassifications, recordClassification } from "@/lib/catalogue/classifications";

/**
 * Document audit — item 8.
 *
 * This is also the missing half of Cante's own roadmap. The `document`
 * classification tier is the only one that may be called verified, and until
 * now nothing in the system could produce one: it required a human to read a
 * PEB and type the code into Memory. `promoteCodesFromDocument()` is that path,
 * automated but not weakened — a code is promoted only when it appears on an
 * actual uploaded document, and it still arrives as `proposed`, awaiting the
 * human approval step in lib/catalogue/classifications.ts.
 *
 * ## What this parser does and does not do
 *
 * It reads **text**. Pasted document text, .txt exports, and CSV line-item
 * exports all work. It does **not** do PDF extraction or OCR, and it does not
 * pretend to: `parseStatus` records `unparsed`/`partial`/`failed` distinctly so
 * a document nobody could read never presents as a document with nothing wrong
 * in it. That distinction is rule 2 applied to the customer's own paperwork.
 */

/**
 * An HS code on a document, and not merely six digits in a row.
 *
 * The naive version — four digits, optional separator, two digits — read the
 * PEB's own registration number `000123` as heading `0001.23` and emitted a
 * phantom line item. Two constraints kill that whole class of false positive:
 *
 *   1. Either the code is **separated** (`6306.12.00`, `6306 12 00`) or it is a
 *      run of 8–10 contiguous digits. A bare six-digit run is too ambiguous to
 *      claim, and document/invoice/PO numbers are exactly that shape.
 *   2. The chapter must be **01–99**, which rules out `00`. Chapters 98 and 99
 *      are deliberately allowed: they are US-specific HTSUS chapters, and
 *      9903.* is where Section 301 and 232 duties are declared — the exact
 *      codes the US source pack monitors. Rejecting them would have made the
 *      document parser blind to the measures the monitor cares most about.
 */
const HS_SEPARATED = /\b(\d{4}[.\s]\d{2}(?:[.\s]\d{2}){0,2})\b/;
const HS_CONTIGUOUS = /\b(\d{8,10})\b/;

function validHsCandidate(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return null;
  const chapter = Number(digits.slice(0, 2));
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 99) return null;
  return raw.replace(/\s/g, "");
}

function hsCodeIn(row: string): string | null {
  return (
    validHsCandidate(row.match(HS_SEPARATED)?.[1]) ??
    validHsCandidate(row.match(HS_CONTIGUOUS)?.[1])
  );
}

const MONEY = /(?:USD|IDR|EUR|Rp|\$)?\s*([\d.,]+)/i;

export interface IngestInput {
  customerId: string;
  docType: string;
  filename: string;
  text: string;
}

const DOC_TYPES = new Set([
  "peb",
  "commercial_invoice",
  "packing_list",
  "purchase_order",
  "customs_entry",
  "bill_of_lading",
  "other",
]);

function cleanNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  // Handle both 1,234.56 and 1.234,56 by treating the last separator as decimal.
  const trimmed = raw.trim();
  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");
  let normalised = trimmed;
  if (lastComma > lastDot) normalised = trimmed.replace(/\./g, "").replace(",", ".");
  else normalised = trimmed.replace(/,/g, "");
  const value = Number(normalised.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function findLabelled(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:#]?\\s*([^\\n\\r]+)`, "i");
    const match = text.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function normaliseDate(raw: string | null): string | null {
  if (!raw) return null;
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Pull structured fields out of document text.
 *
 * Line detection is intentionally conservative: a line counts as a line item
 * only when it carries something identifying (an HS code or a known SKU). A
 * greedy parser that treated every text row as a line item would manufacture
 * findings out of address blocks and footers.
 */
export function extractDocument(text: string, knownSkus: string[] = []): ExtractedDocument {
  const lines: ExtractedLine[] = [];
  const skuSet = new Map(knownSkus.map((s) => [s.toLowerCase(), s]));

  const rows = text.split(/\r?\n/);
  rows.forEach((row, index) => {
    if (!row.trim()) return;
    const hs = hsCodeIn(row);

    let sku: string | null = null;
    for (const [lower, original] of skuSet) {
      if (row.toLowerCase().includes(lower)) {
        sku = original;
        break;
      }
    }

    if (!hs && !sku) return;

    // Country of origin as a 2-letter code in parentheses or after "origin".
    const origin =
      row.match(/\borigin\s*[:=]?\s*([A-Za-z ]{2,30})/i)?.[1]?.trim() ??
      row.match(/\(([A-Z]{2})\)/)?.[1] ??
      null;

    const quantityMatch = row.match(/\b(\d+(?:[.,]\d+)?)\s*(pcs|kg|m2|m²|sqm|rolls?|units?|mtr|m)\b/i);
    const values = [...row.matchAll(new RegExp(MONEY, "gi"))]
      .map((m) => cleanNumber(m[1]))
      .filter((v): v is number => v !== null && v > 0);

    lines.push({
      lineNumber: index + 1,
      sku,
      description: row.trim().slice(0, 200),
      hsCode: hs,
      originCountry: origin,
      quantity: quantityMatch ? cleanNumber(quantityMatch[1]) : null,
      unitOfMeasure: quantityMatch?.[2] ?? null,
      unitValue: null,
      lineValue: values.length ? values[values.length - 1] : null,
    });
  });

  return {
    documentNumber:
      findLabelled(text, ["nomor pendaftaran", "nomor peb", "peb no", "invoice no", "invoice number", "document no", "po number", "entry number"]) ?? null,
    documentDate: normaliseDate(
      findLabelled(text, ["tanggal", "invoice date", "date of issue", "document date", "date"]),
    ),
    exporter: findLabelled(text, ["eksportir", "exporter", "shipper", "seller"]),
    consignee: findLabelled(text, ["consignee", "penerima", "buyer", "importer"]),
    originCountry: findLabelled(text, ["negara asal", "country of origin", "origin country"]),
    destinationCountry: findLabelled(text, ["negara tujuan", "country of destination", "destination"]),
    currency: text.match(/\b(USD|IDR|EUR|GBP|SGD|JPY|AUD|CNY)\b/)?.[1] ?? null,
    totalValue: cleanNumber(
      findLabelled(text, ["total value", "nilai fob", "fob", "total amount", "grand total"]) ?? undefined,
    ),
    lines,
  };
}

export class DocumentInputError extends Error {
  readonly status = 400;
}

/** Store an uploaded document with an honest parse status. */
export function ingestDocument(input: IngestInput): TradeDocument {
  if (!DOC_TYPES.has(input.docType)) {
    throw new DocumentInputError(
      `Unknown document type "${input.docType}". Expected one of: ${[...DOC_TYPES].join(", ")}.`,
    );
  }
  if (!input.text.trim()) {
    throw new DocumentInputError("The document had no readable text. PDF and image OCR are not supported; paste the text or upload a text export.");
  }

  const skus = listProducts(input.customerId).map((p) => p.sku);
  const extracted = extractDocument(input.text, skus);

  const hasHeader = Boolean(extracted.documentNumber || extracted.documentDate);
  const hasLines = extracted.lines.length > 0;
  const parseStatus = hasLines && hasHeader ? "parsed" : hasLines || hasHeader ? "partial" : "failed";
  const parseNote =
    parseStatus === "parsed"
      ? null
      : parseStatus === "partial"
        ? `Read ${extracted.lines.length} line item(s)${hasHeader ? "" : " but no document number or date"}. Findings below cover only what was read.`
        : "No line items or header fields could be read. This document has NOT been audited; nothing below should be taken as a clean result.";

  const row = {
    id: randomUUID(),
    customerId: input.customerId,
    docType: input.docType,
    filename: input.filename,
    documentNumber: extracted.documentNumber ?? null,
    documentDate: extracted.documentDate ?? null,
    parseStatus,
    parseNote,
    extracted,
    rawText: input.text.slice(0, 200_000),
    uploadedAt: new Date().toISOString(),
  };
  db.insert(tradeDocuments).values(row).run();
  return row as TradeDocument;
}

export function getDocument(documentId: string): TradeDocument | undefined {
  return db.select().from(tradeDocuments).where(eq(tradeDocuments.id, documentId)).get();
}

export function listDocuments(customerId: string): TradeDocument[] {
  return db
    .select()
    .from(tradeDocuments)
    .where(eq(tradeDocuments.customerId, customerId))
    .orderBy(asc(tradeDocuments.uploadedAt))
    .all();
}

function digits(code: string | null | undefined): string {
  return (code ?? "").replace(/\D/g, "");
}

/**
 * Compare a document against the catalogue and record discrepancies.
 *
 * Every finding names both sides — what the document said and what we expected
 * — plus the tier of the expectation, so a mismatch against a `lead`-tier code
 * cannot be read as "the document is wrong". Often the document is the more
 * authoritative of the two, which is precisely why it can promote a code.
 */
export function auditDocument(documentId: string): DocumentFinding[] {
  const doc = getDocument(documentId);
  if (!doc) throw new DocumentInputError("Document not found.");
  const extracted = doc.extracted;
  if (!extracted) return [];

  const found: DocumentFinding[] = [];
  const now = new Date().toISOString();

  const add = (finding: Omit<DocumentFinding, "id" | "documentId" | "createdAt">) => {
    const row = { id: randomUUID(), documentId, createdAt: now, ...finding };
    db.insert(documentFindings).values(row).run();
    found.push(row as DocumentFinding);
  };

  db.transaction(() => {
    db.delete(documentFindings).where(eq(documentFindings.documentId, documentId)).run();

    for (const line of extracted.lines) {
      const product = line.sku ? getProductBySku(doc.customerId, line.sku) : undefined;

      if (line.sku && !product) {
        add({
          productId: null,
          kind: "missing_field",
          severity: "medium",
          message: `Line ${line.lineNumber}: SKU "${line.sku}" appears on the document but is not in the catalogue.`,
          documentValue: line.sku,
          expectedValue: null,
          expectationTier: "document",
          status: "open",
        });
        continue;
      }
      if (!product) continue;

      if (line.hsCode) {
        const live = listClassifications(product.id).filter(
          (c) => !c.supersededAt && c.status !== "rejected" && (c.system === "hs" || c.system === "hts"),
        );
        const docDigits = digits(line.hsCode);
        const match = live.find((c) => {
          const known = digits(c.code);
          return known === docDigits || known.startsWith(docDigits) || docDigits.startsWith(known);
        });

        if (live.length > 0 && !match) {
          const strongest = live.reduce((a, b) => (a.tier === "document" ? a : b));
          add({
            productId: product.id,
            kind: "code_mismatch",
            severity: strongest.tier === "document" ? "high" : "medium",
            message: `Line ${line.lineNumber}: the document declares ${line.hsCode} for ${product.sku}, but the catalogue holds ${live.map((c) => c.code).join(", ")}.`,
            documentValue: line.hsCode,
            expectedValue: live.map((c) => c.code).join(", "),
            expectationTier: strongest.tier,
            status: "open",
          });
        }
      }

      if (line.originCountry && product.originCountry) {
        const docOrigin = line.originCountry.trim().toLowerCase();
        const known = product.originCountry.trim().toLowerCase();
        if (docOrigin !== known && !known.startsWith(docOrigin) && !docOrigin.startsWith(known)) {
          add({
            productId: product.id,
            kind: "origin_mismatch",
            severity: "high",
            message: `Line ${line.lineNumber}: the document states origin "${line.originCountry}" for ${product.sku}, but the catalogue records "${product.originCountry}".`,
            documentValue: line.originCountry,
            expectedValue: product.originCountry,
            expectationTier: "human",
            status: "open",
          });
        }
      }

      if (line.unitOfMeasure && product.unitOfMeasure) {
        if (line.unitOfMeasure.toLowerCase() !== product.unitOfMeasure.toLowerCase()) {
          add({
            productId: product.id,
            kind: "uom_mismatch",
            severity: "low",
            message: `Line ${line.lineNumber}: unit "${line.unitOfMeasure}" differs from the catalogue's "${product.unitOfMeasure}" for ${product.sku}.`,
            documentValue: line.unitOfMeasure,
            expectedValue: product.unitOfMeasure,
            expectationTier: "human",
            status: "open",
          });
        }
      }
    }

    if (extracted.lines.length > 0 && !extracted.documentNumber) {
      add({
        productId: null,
        kind: "missing_field",
        severity: "low",
        message: "No document number could be read, so this document cannot be cited as evidence for a classification.",
        documentValue: null,
        expectedValue: "a document/registration number",
        expectationTier: "document",
        status: "open",
      });
    }
  });

  return found;
}

export function listDocumentFindings(documentId: string): DocumentFinding[] {
  return db.select().from(documentFindings).where(eq(documentFindings.documentId, documentId)).all();
}

export interface PromotionResult {
  promoted: Array<{ sku: string; code: string }>;
  skipped: string[];
}

/**
 * Promote codes seen on a real document to `document` tier.
 *
 * This is the only automated path to the tier the whole project treats as
 * verified, so it is deliberately narrow:
 *   - the document must have a number and a date (otherwise it is uncitable);
 *   - the line must name a SKU that exists;
 *   - the resulting row is still `proposed`, so a person still approves it.
 */
export function promoteCodesFromDocument(documentId: string): PromotionResult {
  const doc = getDocument(documentId);
  if (!doc) throw new DocumentInputError("Document not found.");
  const promoted: PromotionResult["promoted"] = [];
  const skipped: string[] = [];

  if (!doc.extracted || doc.extracted.lines.length === 0) {
    return { promoted, skipped: ["The document has no readable line items."] };
  }
  if (!doc.documentNumber || !doc.documentDate) {
    return {
      promoted,
      skipped: [
        "The document has no readable number or date, so it cannot be cited as evidence. Codes were not promoted.",
      ],
    };
  }

  for (const line of doc.extracted.lines) {
    if (!line.sku || !line.hsCode) continue;
    const product = getProductBySku(doc.customerId, line.sku);
    if (!product) {
      skipped.push(`SKU ${line.sku} is not in the catalogue.`);
      continue;
    }
    recordClassification({
      productId: product.id,
      system: "hs",
      code: line.hsCode,
      tier: "document",
      basis: `Declared on ${doc.docType.replace(/_/g, " ")} ${doc.documentNumber} dated ${doc.documentDate} (uploaded as ${doc.filename}), line ${line.lineNumber}.`,
      supportingRefs: [{ kind: "document", ref: doc.documentNumber, title: doc.filename }],
    });
    promoted.push({ sku: line.sku, code: line.hsCode });
  }

  return { promoted, skipped };
}
