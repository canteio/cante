import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  productClassifications,
  type ClassificationRef,
  type ProductClassification,
} from "@/lib/db/schema";
import type { HsCodeTier } from "@/lib/checks/facts";

/**
 * The classification workspace — item 6.
 *
 * Two rules make this different from a codes column on the product:
 *
 * 1. **Nothing is ever overwritten.** A code that stops being current gets
 *    `supersededAt` and stays in the table. "What did we declare in March" is a
 *    question customs asks, and an UPDATE would have destroyed the answer.
 *
 * 2. **Approval is a human act.** `recordClassification()` cannot produce an
 *    approved row no matter what it is passed, and `document` tier is reserved
 *    for codes that came off a real document via the audit path. The model may
 *    propose; only a person approves. This is the same discipline the Memory
 *    page already applies, extended to the thing customs actually charges on.
 */

export interface RecordClassificationInput {
  productId: string;
  system: string;
  code: string;
  tier: HsCodeTier;
  basis: string;
  jurisdiction?: string | null;
  rationale?: string | null;
  supportingRefs?: ClassificationRef[];
}

const APPROVABLE_TIERS = new Set<HsCodeTier>(["document", "human"]);

function normaliseCode(code: string): string {
  return code.replace(/\s+/g, "").trim();
}

export function listClassifications(productId: string): ProductClassification[] {
  return db
    .select()
    .from(productClassifications)
    .where(eq(productClassifications.productId, productId))
    .orderBy(asc(productClassifications.createdAt))
    .all();
}

/**
 * File a code against a product. Always lands as `proposed`.
 *
 * Idempotent on (product, system, jurisdiction, code) among live rows, so
 * re-importing the same CSV does not grow the history by a row per run — but a
 * repeat sighting does refresh nothing silently either; the original basis and
 * date are kept.
 */
export function recordClassification(input: RecordClassificationInput): ProductClassification {
  const code = normaliseCode(input.code);
  const jurisdiction = input.jurisdiction ?? null;

  const existing = db
    .select()
    .from(productClassifications)
    .where(
      and(
        eq(productClassifications.productId, input.productId),
        eq(productClassifications.system, input.system),
        eq(productClassifications.code, code),
        isNull(productClassifications.supersededAt),
      ),
    )
    .all()
    .find((row) => (row.jurisdiction ?? null) === jurisdiction);

  if (existing) {
    // A stronger tier for a code we already track is real news — a lead that
    // turns up on a PEB should stop being a lead — but it must not silently
    // become approved.
    if (tierRank(input.tier as HsCodeTier) > tierRank(existing.tier as HsCodeTier)) {
      db.update(productClassifications)
        .set({ tier: input.tier, basis: input.basis })
        .where(eq(productClassifications.id, existing.id))
        .run();
      return { ...existing, tier: input.tier, basis: input.basis };
    }
    return existing;
  }

  const row = {
    id: randomUUID(),
    productId: input.productId,
    system: input.system,
    jurisdiction,
    code,
    tier: input.tier,
    basis: input.basis,
    supportingRefs: input.supportingRefs ?? [],
    rationale: input.rationale ?? null,
    status: "proposed",
    approvedBy: null,
    approvedAt: null,
    supersededAt: null,
    supersededBy: null,
    createdAt: new Date().toISOString(),
  };
  db.insert(productClassifications).values(row).run();
  return row as ProductClassification;
}

const TIER_ORDER: HsCodeTier[] = ["guess", "lead", "human", "document"];
function tierRank(tier: HsCodeTier): number {
  const index = TIER_ORDER.indexOf(tier);
  return index === -1 ? 0 : index;
}

export class ClassificationApprovalError extends Error {
  readonly status = 400;
}

/**
 * Approve a classification. A human act, with a written reason, that supersedes
 * whatever was current for the same system and jurisdiction.
 *
 * Refuses to approve a `lead` or `guess`: approving a model suggestion without
 * first establishing it from a document or a person is exactly the laundering
 * step this project exists to prevent.
 */
export function approveClassification(
  classificationId: string,
  approvedBy: string,
  rationale: string,
): ProductClassification {
  const row = db
    .select()
    .from(productClassifications)
    .where(eq(productClassifications.id, classificationId))
    .get();
  if (!row) throw new ClassificationApprovalError("Classification not found.");
  if (row.supersededAt) throw new ClassificationApprovalError("That classification is superseded.");
  if (!approvedBy.trim()) throw new ClassificationApprovalError("Approval requires a named approver.");
  if (!rationale.trim()) {
    throw new ClassificationApprovalError("Approval requires a written rationale.");
  }
  if (!APPROVABLE_TIERS.has(row.tier as HsCodeTier)) {
    throw new ClassificationApprovalError(
      `A ${row.tier}-tier code cannot be approved. Establish it from a document or confirm it as a person first.`,
    );
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    const siblings = db
      .select()
      .from(productClassifications)
      .where(
        and(
          eq(productClassifications.productId, row.productId),
          eq(productClassifications.system, row.system),
          eq(productClassifications.status, "approved"),
          isNull(productClassifications.supersededAt),
        ),
      )
      .all()
      .filter((s) => (s.jurisdiction ?? null) === (row.jurisdiction ?? null) && s.id !== row.id);

    for (const sibling of siblings) {
      db.update(productClassifications)
        .set({ status: "superseded", supersededAt: now, supersededBy: row.id })
        .where(eq(productClassifications.id, sibling.id))
        .run();
    }

    db.update(productClassifications)
      .set({ status: "approved", approvedBy, approvedAt: now, rationale })
      .where(eq(productClassifications.id, row.id))
      .run();
  });

  return { ...row, status: "approved", approvedBy, approvedAt: now, rationale };
}

export function rejectClassification(classificationId: string, reason: string): void {
  db.update(productClassifications)
    .set({ status: "rejected", rationale: reason, supersededAt: new Date().toISOString() })
    .where(eq(productClassifications.id, classificationId))
    .run();
}

export interface ResolvedProductCodes {
  /** The code to reason with, if any is established at all. */
  current: ProductClassification | null;
  approved: ProductClassification[];
  document: ProductClassification[];
  human: ProductClassification[];
  leads: ProductClassification[];
  guesses: ProductClassification[];
  documentVerified: boolean;
}

/**
 * The per-SKU answer to "what is this classified as", tiered exactly like
 * `resolveHsCodes()` does at customer level, so the two cannot disagree.
 */
export function resolveProductCodes(
  productId: string,
  system: string,
  jurisdiction: string | null = null,
): ResolvedProductCodes {
  const rows = listClassifications(productId).filter(
    (row) =>
      row.system === system &&
      !row.supersededAt &&
      row.status !== "rejected" &&
      (row.jurisdiction ?? null) === jurisdiction,
  );

  const approved = rows.filter((r) => r.status === "approved");
  const document = rows.filter((r) => r.tier === "document");
  const human = rows.filter((r) => r.tier === "human");
  const leads = rows.filter((r) => r.tier === "lead");
  const guesses = rows.filter((r) => r.tier === "guess");

  return {
    current: approved[0] ?? document[0] ?? human[0] ?? null,
    approved,
    document,
    human,
    leads,
    guesses,
    documentVerified: document.length > 0,
  };
}

/** One line per product for prompts and alerts, honest about tier. */
export function describeProductCodes(resolved: ResolvedProductCodes): string {
  if (resolved.current) {
    const tier = resolved.current.tier;
    const label =
      tier === "document"
        ? "document-verified"
        : tier === "human"
          ? "human-confirmed, never checked against paperwork"
          : tier;
    return `${resolved.current.code} (${label}${resolved.current.status === "approved" ? ", approved" : ""})`;
  }
  if (resolved.leads.length) {
    return `${resolved.leads.map((l) => l.code).join(", ")} — unapproved leads only, nothing established`;
  }
  return "no classification on record";
}
