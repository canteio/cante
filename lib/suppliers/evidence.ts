import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  supplierDocuments,
  suppliers,
  type Supplier,
  type SupplierDocument,
} from "@/lib/db/schema";
import { listProducts } from "@/lib/catalogue/products";
import { EVIDENCE_STATUSES, EVIDENCE_TYPES, type EvidenceStatus } from "./contract";

export { EVIDENCE_TYPES, type EvidenceStatus } from "./contract";

/**
 * Supplier evidence tracking — item 9.
 *
 * The distinction this file exists to preserve: **"we never asked" is not
 * "they didn't send it"**, and neither is "it expired". A single
 * `hasCertificate` boolean would flatten three different situations into one
 * misleading answer, and the one that matters most — nobody has ever requested
 * this — would be indistinguishable from supplier non-compliance.
 *
 * What this does NOT do: send the request. Outreach needs delivery
 * infrastructure (email/Telegram) that this project has explicitly deferred, so
 * `requestEvidence()` records that a request was made and when. The sending is
 * still manual, and the status says so rather than implying a message went out.
 */

const STATUSES = new Set<EvidenceStatus>(EVIDENCE_STATUSES);
const DOCUMENT_TYPES = new Set<string>(EVIDENCE_TYPES);

export class EvidenceError extends Error {
  readonly status = 400;
}

export function listSupplierDocuments(supplierId: string): SupplierDocument[] {
  return db
    .select()
    .from(supplierDocuments)
    .where(eq(supplierDocuments.supplierId, supplierId))
    .all();
}

export interface EvidenceInput {
  supplierId: string;
  docType: string;
  productId?: string | null;
  status?: EvidenceStatus;
  expiresAt?: string | null;
  fileRef?: string | null;
  notes?: string | null;
}

export function upsertEvidence(input: EvidenceInput): SupplierDocument {
  // Reject values outside the discovery enum instead of silently persisting a
  // document type that API clients cannot read back through the contract.
  if (!DOCUMENT_TYPES.has(input.docType)) {
    throw new EvidenceError(`Unknown document type "${input.docType}".`);
  }
  if (!STATUSES.has((input.status ?? "not_requested") as EvidenceStatus)) {
    throw new EvidenceError(`Unknown status "${input.status}".`);
  }
  const now = new Date().toISOString();
  const existing = listSupplierDocuments(input.supplierId).find(
    (d) => d.docType === input.docType && (d.productId ?? null) === (input.productId ?? null),
  );

  const status = input.status ?? existing?.status ?? "not_requested";
  const values = {
    status,
    productId: input.productId ?? existing?.productId ?? null,
    requestedAt:
      status === "requested" && !existing?.requestedAt ? now : (existing?.requestedAt ?? null),
    receivedAt: status === "received" ? (existing?.receivedAt ?? now) : (existing?.receivedAt ?? null),
    expiresAt: input.expiresAt ?? existing?.expiresAt ?? null,
    fileRef: input.fileRef ?? existing?.fileRef ?? null,
    notes: input.notes ?? existing?.notes ?? null,
    updatedAt: now,
  };

  if (existing) {
    db.update(supplierDocuments).set(values).where(eq(supplierDocuments.id, existing.id)).run();
    return { ...existing, ...values };
  }

  const row = {
    id: randomUUID(),
    supplierId: input.supplierId,
    docType: input.docType,
    ...values,
    createdAt: now,
  };
  db.insert(supplierDocuments).values(row).run();
  return row as SupplierDocument;
}

/**
 * Record that evidence was requested. Does not send anything — see the file
 * header. The returned `draftMessage` is text a human sends by hand.
 */
export function requestEvidence(
  supplierId: string,
  docType: string,
  productId?: string | null,
): { record: SupplierDocument; draftMessage: string; delivered: false } {
  const supplier = db.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
  if (!supplier) throw new EvidenceError("Supplier not found.");

  const record = upsertEvidence({ supplierId, docType, productId, status: "requested" });
  const readable = docType.replace(/_/g, " ");
  const draftMessage =
    `Dear ${supplier.name},\n\n` +
    `We are updating our export compliance records and need a current ${readable} ` +
    `for the goods you supply to us.\n\n` +
    `Please send the document, along with its issue and expiry dates, at your earliest convenience.\n\n` +
    `Thank you.`;

  return { record, draftMessage, delivered: false };
}

export interface EvidenceGap {
  supplier: Supplier;
  docType: string;
  status: EvidenceStatus;
  /** Why this matters, in plain words. */
  detail: string;
  severity: "high" | "medium" | "low";
  expiresAt?: string | null;
}

/**
 * Outstanding evidence across all suppliers.
 *
 * Expiry is computed against a horizon so "expires in three weeks" surfaces
 * before it becomes "expired", which is the entire operational point.
 */
export function evidenceGaps(
  customerId: string,
  options: { now?: Date; horizonDays?: number } = {},
): EvidenceGap[] {
  const now = options.now ?? new Date();
  const horizon = new Date(now.getTime() + (options.horizonDays ?? 60) * 86_400_000);
  const rows = db.select().from(suppliers).where(eq(suppliers.customerId, customerId)).all();
  const gaps: EvidenceGap[] = [];

  for (const supplier of rows) {
    const docs = listSupplierDocuments(supplier.id);
    if (docs.length === 0) {
      gaps.push({
        supplier,
        docType: "any",
        status: "not_requested",
        detail: `No evidence of any kind has ever been requested from ${supplier.name}. This is an unasked question, not a supplier failure.`,
        severity: "medium",
      });
      continue;
    }

    for (const doc of docs) {
      const status = doc.status as EvidenceStatus;
      if (status === "not_applicable" || status === "rejected") continue;

      if (status === "not_requested") {
        gaps.push({
          supplier,
          docType: doc.docType,
          status,
          detail: `${doc.docType.replace(/_/g, " ")} has never been requested from ${supplier.name}.`,
          severity: "medium",
        });
        continue;
      }
      if (status === "requested") {
        const waitingDays = doc.requestedAt
          ? Math.round((now.getTime() - new Date(doc.requestedAt).getTime()) / 86_400_000)
          : null;
        gaps.push({
          supplier,
          docType: doc.docType,
          status,
          detail: `${doc.docType.replace(/_/g, " ")} was requested${waitingDays !== null ? ` ${waitingDays} day(s) ago` : ""} and has not arrived.`,
          severity: waitingDays !== null && waitingDays > 30 ? "high" : "low",
        });
        continue;
      }
      if (status === "received" && doc.expiresAt) {
        const expiry = new Date(doc.expiresAt);
        if (expiry.getTime() < now.getTime()) {
          gaps.push({
            supplier,
            docType: doc.docType,
            status: "expired",
            detail: `${doc.docType.replace(/_/g, " ")} from ${supplier.name} expired on ${doc.expiresAt}.`,
            severity: "high",
            expiresAt: doc.expiresAt,
          });
        } else if (expiry.getTime() <= horizon.getTime()) {
          gaps.push({
            supplier,
            docType: doc.docType,
            status: "received",
            detail: `${doc.docType.replace(/_/g, " ")} from ${supplier.name} expires on ${doc.expiresAt}.`,
            severity: "medium",
            expiresAt: doc.expiresAt,
          });
        }
      }
    }
  }

  return gaps;
}

/**
 * Products whose materials suggest evidence nobody has asked for.
 *
 * A suggestion, explicitly labelled as one — material keywords are a prompt to
 * ask a question, never a determination that a rule applies.
 */
export function suggestedEvidence(customerId: string): Array<{ sku: string; docType: string; why: string }> {
  const suggestions: Array<{ sku: string; docType: string; why: string }> = [];
  const triggers: Array<[RegExp, string]> = [
    [/pfas|fluor|ptfe/i, "pfas"],
    [/phthalate|pvc|plasticis|plasticiz/i, "material_declaration"],
    [/lead|cadmium|mercury|chromium/i, "rohs"],
    [/textile|polyester|scrim|fabric/i, "test_report"],
  ];

  for (const product of listProducts(customerId)) {
    const haystack = [product.description, ...product.materials].filter(Boolean).join(" ");
    for (const [pattern, docType] of triggers) {
      if (pattern.test(haystack)) {
        suggestions.push({
          sku: product.sku,
          docType,
          why: `${product.sku}'s recorded materials match "${pattern.source}". This is a keyword prompt to ask, not a determination that any rule applies.`,
        });
      }
    }
  }

  return suggestions;
}
