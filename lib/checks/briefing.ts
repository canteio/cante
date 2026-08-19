import { z } from "zod";
import { completeJson, type LlmProvider } from "@/lib/llm";
import type { Customer, CustomerProfile } from "@/lib/db/schema";
import type { JurisdictionName } from "@/lib/countries";

/**
 * "PP 20/2026 — worth a look" is not an answer. This turns it into one.
 *
 * A monitor that reports a regulation *changed* without saying **what** changed
 * hands the reader the whole job: find the new rule, find the old rule, read
 * both, work out the delta. Nobody does that, so the alert gets skimmed and the
 * product is worth nothing. `lib/checks/lifecycle.ts` already detects that
 * 20/2026 amends 55/2022; this reads both and writes the before/after.
 *
 * ## Why it may refuse
 *
 * The obvious failure here is a confident, invented comparison — a fabricated
 * "before" column is worse than no table at all, because it reads authoritative
 * and a customer might act on it. So:
 *
 * - Every row must come from a document the model actually fetched. It is told
 *   to return fewer rows rather than guess one.
 * - `sourcesRead` records which documents it managed to open, and
 *   `confidence` drops to `partial` when the older rule could not be read —
 *   which is common, because the amended rule is often on a portal that blocks
 *   automation.
 * - A briefing with no rows and no sources is discarded entirely rather than
 *   rendered as an empty comparison.
 *
 * Bounded to the few findings a person will actually read: `flagged` and
 * `noted` only, capped per run, and every failure degrades to the plain finding
 * the alert would have carried anyway.
 */

const MAX_BRIEFINGS_PER_RUN = 3;

const BriefingSchema = z.object({
  whatItIs: z
    .string()
    .describe("ONE short sentence, max 20 words: what this regulation governs. No preamble."),
  changes: z
    .array(
      z.object({
        topic: z
          .string()
          .describe('Who this row is about, 2-5 words, e.g. "Orang pribadi" or "PT biasa & CV".'),
        before: z
          .string()
          .describe(
            "The old position in AT MOST 8 words — a number, a duration, or a yes/no. " +
              'e.g. "maksimal 7 tahun". Not a sentence, not a Pasal citation.',
          ),
        after: z
          .string()
          .describe(
            'The new position in AT MOST 8 words. e.g. "tanpa batas waktu" or "tidak boleh lagi".',
          ),
      }),
    )
    .max(5)
    .describe(
      "At most 5 rows, the ones that matter most. Empty array if you could not establish any " +
        "from the actual documents — never guess a difference, and never pad this list.",
    ),
  affectsCustomer: z
    .string()
    .describe(
      "AT MOST 2 short sentences on whether this touches THIS company and what to do. " +
        "Say plainly if it probably does not apply to them.",
    ),
  sourcesRead: z
    .array(z.string())
    .describe("URLs you actually fetched. Empty if you could not open anything."),
  confidence: z
    .enum(["sourced", "partial"])
    .describe(
      "'sourced' only when you read both the new rule and the one it changes. 'partial' when you " +
        "read one of them, or neither.",
    ),
});

export type Briefing = z.infer<typeof BriefingSchema>;

export interface BriefingInput {
  regulationRef: string;
  title: string;
  url: string;
  /** From lifecycle detection: the rule this one changes, if any. */
  amends?: string | null;
  relation?: string | null;
}

export interface BriefedFinding extends BriefingInput {
  briefing: Briefing;
}

const SYSTEM = `You explain one regulation change to a small business owner who will give it thirty seconds on a phone.

Your job is the delta, not a summary. They already know a rule appeared; they need what it says now versus before, and whether it touches them.

**Brevity is the requirement, not a preference.** Each before/after value is a fragment, not a sentence: "maksimal 7 tahun" → "tanpa batas waktu". "boleh pakai" → "tidak boleh lagi". No Pasal citations, no clause explanations, no "this regulation states that". If a row cannot be said in eight words, it is too detailed for this format — leave it out and let the customer ask.

Hard rules:
- Every before/after row must come from a document you actually fetched. If you could not read one, return fewer rows. An invented "before" is the worst possible output here: it reads authoritative and someone may act on it.
- Four sharp rows beat eight vague ones. Pick the differences a business owner would actually care about — money, deadlines, eligibility, whether they can still do the thing.
- If the rule plainly does not touch this company, say so in one line. That is a useful answer, not a failure.`;

/** Research one regulation change and return a briefing, or null if nothing solid came back. */
export async function briefFinding(
  provider: LlmProvider,
  input: {
    finding: BriefingInput;
    customer: Customer;
    profile: CustomerProfile;
    jurisdiction: JurisdictionName;
  },
): Promise<Briefing | null> {
  const { finding, customer, profile } = input;
  const amendsLine = finding.amends
    ? `This regulation ${finding.relation ?? "amends"}: ${finding.amends}. Fetch that older regulation too and compare them.`
    : "No amendment link was detected. If the title says it changes an earlier rule, find that rule.";

  // The customer reads this, so it must be in their language — the first live
  // run came back entirely in English for an Indonesian business.
  const language =
    input.jurisdiction === "United States"
      ? "Write every field in English."
      : "Write every field in Bahasa Indonesia — this goes straight to an Indonesian business owner. " +
        "Keep regulation numbers and Indonesian legal terms as they are.";

  const prompt =
    `## The regulation\n\n${finding.regulationRef} — ${finding.title}\n${finding.url}\n\n` +
    `${amendsLine}\n\n` +
    `## The company\n\n${customer.name}: ${profile.productDescription ?? "manufacturer"}. ` +
    `Side of trade: ${profile.sideOfTrade ?? "unknown"}.\n\n` +
    `## What to do\n\n` +
    `Fetch the regulation. Fetch the rule it changes. Then write the before/after differences that ` +
    `matter, and say whether this touches ${customer.name}. Use WebSearch if the direct URL will not open. ` +
    `Return only differences you can support from a document you actually read.\n\n` +
    `${language}`;

  try {
    const { value } = await completeJson(provider, BriefingSchema, {
      system: SYSTEM,
      prompt,
      timeoutMs: 420_000,
    });
    // Nothing read and nothing established is not a briefing; rendering it as an
    // empty comparison would imply the work was done and found no differences.
    if (value.changes.length === 0 && value.sourcesRead.length === 0) return null;
    return value;
  } catch {
    return null;
  }
}

/** Brief the findings a person will actually read, in order, bounded per run. */
export async function briefFindings(
  provider: LlmProvider,
  findings: BriefingInput[],
  context: { customer: Customer; profile: CustomerProfile; jurisdiction: JurisdictionName },
): Promise<BriefedFinding[]> {
  const briefed: BriefedFinding[] = [];
  for (const finding of findings.slice(0, MAX_BRIEFINGS_PER_RUN)) {
    const briefing = await briefFinding(provider, { finding, ...context });
    if (briefing) briefed.push({ ...finding, briefing });
  }
  return briefed;
}

/**
 * Render briefings for the alert. Scannable on a phone: a heading, a short
 * what-it-is, the before/after rows, then what it means for this company.
 */
export function renderBriefings(
  briefed: BriefedFinding[],
  language: "id" | "en" = "id",
): string {
  if (briefed.length === 0) return "";
  const id = language === "id";

  const blocks = briefed.map((item) => {
    const { briefing } = item;
    const header = `*${item.regulationRef}*${
      item.amends ? ` — ${id ? "mengubah" : "changes"} ${item.amends}` : ""
    }`;
    const rows = briefing.changes.length
      ? `\n${id ? "Yang berubah" : "What changed"}:\n` +
        briefing.changes
          .map((change) => `• ${change.topic}: ${change.before} → ${change.after}`)
          .join("\n")
      : `\n${id ? "Perbedaan spesifiknya belum bisa dibaca dari dokumen resmi." : "The specific differences could not be read from the official documents."}`;
    // A partial comparison must say so next to the table, not in a footnote
    // three sections away that nobody reaches.
    const confidence =
      briefing.confidence === "partial"
        ? `\n${id ? "⚠️ Aturan lama belum terbaca lengkap, jadi perbandingan ini belum tentu utuh." : "⚠️ The earlier rule could not be fully read, so this comparison may be incomplete."}`
        : "";

    return (
      `${header}\n${briefing.whatItIs}${rows}\n\n` +
      `${id ? "Buat kamu" : "For you"}: ${briefing.affectsCustomer}${confidence}`
    );
  });

  return `\n---\n${id ? "Rincian perubahan" : "What changed"}:\n\n${blocks.join("\n\n")}\n`;
}
