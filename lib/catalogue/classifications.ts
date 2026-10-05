import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

import { type ClassificationRef, type ProductClassification } from "@/lib/db/schema";
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

function normaliseCode(code: string): string {
  return code.replace(/\s+/g, "").trim();
}

export async function listClassifications(productId: string): Promise<ProductClassification[]> {
  const supabase = await createClient();
  return cloudResult<Array<typeof Schema.productClassifications.$inferSelect>>(
    await supabase
      .from("product_classifications")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: true }),
  );
}

/**
 * File a code against a product. Always lands as `proposed`.
 *
 * Idempotent on (product, system, jurisdiction, code) among live rows, so
 * re-importing the same CSV does not grow the history by a row per run — but a
 * repeat sighting does refresh nothing silently either; the original basis and
 * date are kept.
 */
export async function recordClassification(input: RecordClassificationInput): Promise<ProductClassification> {
  const supabase = await createClient();
  const code = normaliseCode(input.code);
  const jurisdiction = input.jurisdiction ?? null;

  const existing = cloudResult<Array<typeof Schema.productClassifications.$inferSelect>>(
    await supabase
      .from("product_classifications")
      .select("*")
      .eq("product_id", input.productId)
      .eq("system", input.system)
      .eq("code", code)
      .is("superseded_at", null),
  )
    .find((row) => (row.jurisdiction ?? null) === jurisdiction);

  if (existing) {
    // A stronger tier for a code we already track is real news — a lead that
    // turns up on a PEB should stop being a lead — but it must not silently
    // become approved.
    if (tierRank(input.tier as HsCodeTier) > tierRank(existing.tier as HsCodeTier)) {
      cloudResult(
        await supabase
          .from("product_classifications")
          .update(snakeRow({ tier: input.tier, basis: input.basis }))
          .eq("id", existing.id),
      );
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
  cloudResult(
    await supabase
      .from("product_classifications")
      .insert(snakeRow(row)),
  );
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
export async function approveClassification(
  classificationId: string,
  approvedBy: string,
  rationale: string,
): Promise<ProductClassification> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_product_classification", {
    target_id: classificationId, approver: approvedBy, reason: rationale,
  }).single();
  if (error?.code === "P0001") throw new ClassificationApprovalError(error.message);
  return cloudResult<ProductClassification>({ data, error });
}

/**
 * Reject a classification with a written reason.
 *
 * Previously this ran an unconditional UPDATE: rejecting an unknown id was a
 * silent no-op, an already-superseded row could be "rejected" again and its
 * supersededAt timestamp overwritten (destroying when it actually left
 * current), and an empty reason was accepted — the one piece of information a
 * rejection exists to record. approveClassification already guards all of
 * this; rejectClassification is the other half of the same decision and must
 * hold itself to the same standard.
 */
export async function rejectClassification(classificationId: string, reason: string): Promise<void> {
  const supabase = await createClient();
  const row = (cloudResult<typeof Schema.productClassifications.$inferSelect | null>(
    await supabase
      .from("product_classifications")
      .select("*")
      .eq("id", classificationId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!row) throw new ClassificationApprovalError("Classification not found.");
  if (row.supersededAt) {
    throw new ClassificationApprovalError("That classification is superseded.");
  }
  if (!reason.trim()) {
    throw new ClassificationApprovalError("Rejection requires a written reason.");
  }

  cloudResult(
    await supabase
      .from("product_classifications")
      .update(snakeRow({ status: "rejected", rationale: reason, supersededAt: new Date().toISOString() }))
      .eq("id", classificationId),
  );
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
export async function resolveProductCodes(
  productId: string,
  system: string,
  jurisdiction: string | null = null,
): Promise<ResolvedProductCodes> {
  const rows = (await listClassifications(productId)).filter(
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

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
