import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

import { type Finding, type RegulationLink } from "@/lib/db/schema";

/**
 * Regulation lifecycle — linking a rule to the rule it changes.
 *
 * Cante recorded that Permendag 12/2026 appeared. It did not record that
 * 12/2026 is the *fifth amendment to 23/2023*, which is the single most useful
 * fact about it — it tells the reader whether this is a new obligation or a
 * tweak to one they already comply with. Competitors track announcement →
 * implementation → revocation; this is the minimum that earns the comparison.
 *
 * ## Why this reads text instead of asking the model
 *
 * Indonesian and US legal drafting both signal these relationships in fixed
 * language — "Perubahan Kelima atas", "mencabut", "amending", "revokes". A
 * regex over the citation sentence is deterministic, auditable, and cannot
 * hallucinate a relationship that isn't there. Every link stores the sentence
 * it was read from, so a human can check it. The model may add links later; it
 * may not be the only thing asserting them.
 */

export type Relation = "amends" | "supersedes" | "revokes" | "implements" | "extends";

interface Pattern {
  relation: Relation;
  /** Must capture the target citation in group 1. */
  re: RegExp;
  language: "id" | "en";
}

/**
 * A regulation citation: "Permendag 23 Tahun 2023", "Permendag 23/2023",
 * "Peraturan Menteri Perdagangan Nomor 23 Tahun 2023", "19 CFR 190".
 */
const ID_CITATION = String.raw`((?:Peraturan\s+\w+(?:\s+\w+){0,3}|Permendag|Permenkeu|PMK|PP|Perpres|UU|Permen\w*)\s*(?:Nomor\s*)?\d+[^,.;]{0,40}?(?:Tahun\s*\d{4}|\/\d{4}))`;
const EN_CITATION = String.raw`((?:\d+\s+CFR\s+[\d.]+|Executive\s+Order\s+\d+|Public\s+Law\s+[\d-]+|\d{2}\s+U\.?S\.?C\.?\s+[\d.]+))`;

// The Indonesian patterns are case-insensitive because these phrases arrive as
// *titles*, not prose. A title capitalises words the body text does not
// ("Perubahan Atas", not "perubahan atas") and is sometimes typed entirely in
// capitals. Matching only the lower-case form silently found one link in a live
// batch of 23 Kemenperin regulations where eight were amendments or revocations.
const PATTERNS: Pattern[] = [
  // Indonesian: "Perubahan Kelima atas Peraturan Menteri Perdagangan Nomor 23 Tahun 2023"
  { relation: "amends", language: "id", re: new RegExp(String.raw`perubahan\s+\w*\s*atas\s+${ID_CITATION}`, "i") },
  { relation: "amends", language: "id", re: new RegExp(String.raw`mengubah\s+(?:atas\s+)?${ID_CITATION}`, "i") },
  // Both the verb ("mencabut", how a rule's body reads) and the noun
  // ("Pencabutan", how its title reads). Titles are usually all this monitor has.
  { relation: "revokes", language: "id", re: new RegExp(String.raw`mencabut\s+(?:dan menyatakan tidak berlaku\s+)?${ID_CITATION}`, "i") },
  { relation: "revokes", language: "id", re: new RegExp(String.raw`pencabutan\s+(?:atas\s+)?${ID_CITATION}`, "i") },
  { relation: "supersedes", language: "id", re: new RegExp(String.raw`menggantikan\s+${ID_CITATION}`, "i") },
  { relation: "implements", language: "id", re: new RegExp(String.raw`pelaksanaan\s+(?:dari\s+)?${ID_CITATION}`, "i") },

  { relation: "amends", language: "en", re: new RegExp(String.raw`amend(?:s|ing|ment\s+to)\s+${EN_CITATION}`, "i") },
  { relation: "revokes", language: "en", re: new RegExp(String.raw`(?:revok(?:es|ing)|rescind(?:s|ing))\s+${EN_CITATION}`, "i") },
  { relation: "supersedes", language: "en", re: new RegExp(String.raw`supersed(?:es|ing)\s+${EN_CITATION}`, "i") },
  { relation: "extends", language: "en", re: new RegExp(String.raw`extend(?:s|ing)\s+${EN_CITATION}`, "i") },
];

export interface DetectedLink {
  relation: Relation;
  targetRef: string;
  evidence: string;
}

/** Read relationships out of a regulation's own text. */
export function detectRegulationLinks(text: string): DetectedLink[] {
  if (!text.trim()) return [];
  const found: DetectedLink[] = [];
  const seen = new Set<string>();

  for (const pattern of PATTERNS) {
    const match = text.match(pattern.re);
    if (!match?.[1]) continue;

    const targetRef = match[1].replace(/\s+/g, " ").trim();
    const key = `${pattern.relation}:${targetRef.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Keep the sentence, not just the match, so a reviewer sees the context.
    const index = text.indexOf(match[0]);
    const start = Math.max(0, text.lastIndexOf(".", index) + 1);
    const endDot = text.indexOf(".", index + match[0].length);
    const end = endDot === -1 ? text.length : endDot + 1;

    found.push({
      relation: pattern.relation,
      targetRef,
      evidence: text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 400),
    });
  }

  return found;
}

/**
 * Detect and store links for a finding, resolving the target to an earlier
 * finding where we have actually seen it.
 */
export async function linkRegulation(
  customerId: string,
  finding: Pick<Finding, "id" | "title" | "summaryEn" | "reasoning" | "regulationRef">,
): Promise<RegulationLink[]> {
  const supabase = await createClient();
  const text = [finding.title, finding.summaryEn, finding.reasoning].filter(Boolean).join(" ");
  const detected = detectRegulationLinks(text);
  if (detected.length === 0) return [];

  const stored: RegulationLink[] = [];
  const now = new Date().toISOString();

  for (const link of detected) {
    const row = {
      id: randomUUID(),
      customerId,
      findingId: finding.id,
      relation: link.relation,
      targetRef: link.targetRef,
      targetFindingId: await resolveTargetFinding(customerId, link.targetRef),
      evidence: link.evidence,
      // Read from the document's own words, so `stated` rather than inferred.
      confidence: "stated",
      createdAt: now,
    };
    stored.push(row as RegulationLink);
  }
  if (stored.length) cloudResult(
    await supabase
      .from("regulation_links")
      .insert(stored.map(snakeRow)),
  );

  return stored;
}

/** Match a cited rule against findings we already hold, by number and year. */
async function resolveTargetFinding(customerId: string, targetRef: string): Promise<string | null> {
  const supabase = await createClient();
  const numberYear = targetRef.match(/(\d+)[^\d]{0,20}?(\d{4})/);
  if (!numberYear) return null;
  const [, number, year] = numberYear;

  const candidates = cloudResult<Array<typeof Schema.findings.$inferSelect>>(
    await supabase
      .from("findings")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
  );

  const match = candidates.find((candidate) => {
    const haystack = `${candidate.regulationRef ?? ""} ${candidate.title}`;
    return new RegExp(String.raw`\b${number}\b`).test(haystack) && haystack.includes(year);
  });
  return match?.id ?? null;
}

export async function listLinksForFinding(findingId: string): Promise<RegulationLink[]> {
  const supabase = await createClient();
  return cloudResult<Array<typeof Schema.regulationLinks.$inferSelect>>(
    await supabase
      .from("regulation_links")
      .select("*")
      .eq("finding_id", findingId),
  );
}

/**
 * Findings whose rule a later rule has revoked or superseded.
 *
 * This is what stops a monitor from carrying a dead obligation forever. It
 * reports the *claim* — that a later document says it revoked this one — and
 * not a legal conclusion, so the caller must present it as something to verify
 * rather than as settled.
 */
export async function supersededFindings(customerId: string): Promise<Array<{
  finding: Finding;
  supersededBy: RegulationLink;
  caveat: string;
}>> {
  const supabase = await createClient();
  const links = cloudResult<Array<typeof Schema.regulationLinks.$inferSelect>>(
    await supabase
      .from("regulation_links")
      .select("*")
      .eq("customer_id", customerId),
  )
    .filter((link) => link.relation === "revokes" || link.relation === "supersedes");

  const out: Array<{ finding: Finding; supersededBy: RegulationLink; caveat: string; }> = [];
  for (const link of links) {
    if (!link.targetFindingId) continue;
    const target = (cloudResult<typeof Schema.findings.$inferSelect | null>(
      await supabase
        .from("findings")
        .select("*")
        .eq("id", link.targetFindingId)
        .limit(1)
        .maybeSingle(),
    ) ?? undefined);
    if (!target) continue;
    out.push({
      finding: target,
      supersededBy: link,
      caveat:
        `A later document states it ${link.relation} ${link.targetRef}. This is what the newer rule claims, ` +
        "read from its own text — it is not a legal determination that the earlier rule stopped applying, " +
        "and transitional provisions often keep parts of it in force.",
    });
  }
  return out;
}

/**
 * Whether a change helps or hurts. `unknown` is the default and is honest.
 *
 * A monitor that only ever reports bad news trains the reader to dread it, and
 * a duty reduction or an exclusion grant is worth surfacing too.
 */
export function classifyDirection(input: {
  dutyDelta?: number | null;
  text?: string | null;
}): "unfavorable" | "favorable" | "neutral" | "unknown" {
  if (typeof input.dutyDelta === "number") {
    if (input.dutyDelta > 0) return "unfavorable";
    if (input.dutyDelta < 0) return "favorable";
    return "neutral";
  }

  const text = (input.text ?? "").toLowerCase();
  if (!text) return "unknown";

  // "exclusion granted" and "an exclusion is granted" are the same news, so the
  // verb is allowed to drift a couple of words from the noun.
  const favorable =
    /\b(exclusion\s+(?:\w+\s+){0,2}granted|exemption|relief|reduc(?:e|ed|tion)|suspend(?:ed|s)? the duty|dibebaskan|pembebasan|penurunan tarif)\b/;
  const unfavorable = /\b(increase(?:d|s)?|impos(?:e|ed|ition)|additional dut|prohibit(?:ed|ion)|larangan|kenaikan tarif|dilarang)\b/;

  const isFavorable = favorable.test(text);
  const isUnfavorable = unfavorable.test(text);
  // Both signals present is genuinely ambiguous, not a coin flip.
  if (isFavorable && !isUnfavorable) return "favorable";
  if (isUnfavorable && !isFavorable) return "unfavorable";
  return "unknown";
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
