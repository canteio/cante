import { z } from "zod";
import { completeJson, type LlmProvider } from "@/lib/llm";
import { judge, type JudgeInput, type Judgment } from "@/lib/checks/judge";
import { normalizeUrlKey } from "@/lib/checks/coverage";
import type { RegulationEntry } from "@/lib/sources/fetch";

/**
 * Judgment in batches, because one big batch does not get judged.
 *
 * `judge()`'s prompt has always told the model to return a verdict for every
 * entry. Measured against real runs, it does not: 54 entries in, 36 verdicts
 * back; then 62 entries in, **20 verdicts back and 41 unaccounted**. The
 * completion retry added on 18 Aug was meant to close that gap and has never
 * once resolved a single entry across three runs (0 of 1, 0 of 3, 0 of 41) —
 * because it re-asked for the missed entries in one large batch too, which is
 * the same failure again.
 *
 * The retry was treating a symptom. The cause is batch size: a model asked for
 * 60-odd structured verdicts in a single response stops well short, and no
 * amount of instruction fixes it. Asking for fifteen at a time does.
 *
 * ## Why the customer message is composed separately
 *
 * `judge()` returns verdicts *and* the customer-facing message together. Once
 * judgment is split across batches that no longer works — each call would write
 * a message about its own slice, knowing nothing about the others. So batches
 * produce verdicts only, and one small final call writes the message from the
 * findings that actually matter. That also makes the message better: it sees
 * the flagged and noted items rather than sixty rows of mostly-irrelevant ones.
 */

/**
 * Fifteen is deliberately conservative. The observed cliff is somewhere between
 * 15 (fine) and 54 (a third dropped); the cost of being under it is a few more
 * calls, and the cost of being over it is silently unjudged regulations.
 */
export const JUDGMENT_BATCH_SIZE = 15;

/** Split entries into batches, preserving order. */
export function planBatches<T>(items: T[], size = JUDGMENT_BATCH_SIZE): T[][] {
  if (size < 1) throw new Error("Batch size must be at least 1");
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

const MessageSchema = z.object({
  whatsappMessage: z
    .string()
    .describe(
      "The ready-to-send message. If nothing is flagged or noted, ONE short line saying so, " +
        "bolded with single asterisks (WhatsApp bold, not Markdown). Do not restate coverage " +
        "caveats — code appends those separately.",
    ),
  summaryId: z.string().describe("2-4 short lines in the primary language."),
  summaryEn: z.string().describe("One-line English gloss."),
});

export interface BatchedJudgment {
  findings: Judgment["findings"];
  coverageCaveats: string[];
  whatsappMessage: string;
  summaryId: string;
  summaryEn: string;
  batches: number;
  failedBatches: number;
}

/**
 * Judge every entry, in batches, then compose one message.
 *
 * A batch that throws is recorded as a code-written caveat rather than failing
 * the run: losing fifteen verdicts is bad, losing the whole check is worse, and
 * `auditVerdictCoverage()` will report the survivors as unaccounted anyway.
 */
export async function judgeAllEntries(
  provider: LlmProvider,
  input: JudgeInput,
  options: { batchSize?: number } = {},
): Promise<BatchedJudgment> {
  const entries = input.report.regulations;
  const batches = planBatches(entries, options.batchSize ?? JUDGMENT_BATCH_SIZE);
  const lang = input.jurisdiction === "United States" ? "en" : "id";

  const findings: Judgment["findings"] = [];
  const caveats = new Set<string>();
  let failedBatches = 0;

  for (const batch of batches) {
    try {
      const result = await judge(provider, {
        ...input,
        report: { ...input.report, regulations: batch },
      });
      // A verdict for something outside this batch is not a verdict on this
      // batch. Filtering keeps the coverage audit meaningful instead of letting
      // a stray row mask a genuinely unjudged one.
      const allowed = new Set(batch.map((entry) => normalizeUrlKey(entry.url)));
      for (const finding of result.findings) {
        if (allowed.has(normalizeUrlKey(finding.url))) findings.push(finding);
      }
      for (const caveat of result.coverageCaveats) caveats.add(caveat);
    } catch {
      failedBatches += 1;
    }
  }

  if (failedBatches > 0) {
    caveats.add(
      lang === "en"
        ? `${failedBatches} of ${batches.length} judgment batches failed outright; the regulations in them were not judged at all.`
        : `${failedBatches} dari ${batches.length} kelompok penilaian gagal total; peraturan di dalamnya sama sekali belum dinilai.`,
    );
  }

  const reportable = findings.filter(
    (finding) => finding.relevance === "flagged" || finding.relevance === "noted",
  );
  const message = await composeMessage(provider, input, reportable, entries);

  return {
    findings,
    coverageCaveats: [...caveats],
    whatsappMessage: message.whatsappMessage,
    summaryId: message.summaryId,
    summaryEn: message.summaryEn,
    batches: batches.length,
    failedBatches,
  };
}

/** One small call that writes the customer message from what was actually found. */
async function composeMessage(
  provider: LlmProvider,
  input: JudgeInput,
  reportable: Judgment["findings"],
  allEntries: RegulationEntry[],
): Promise<z.infer<typeof MessageSchema>> {
  const indonesian = input.jurisdiction !== "United States";
  const system = indonesian
    ? "You write one short compliance update for an Indonesian business owner. Casual, clear Bahasa Indonesia, no legal jargon. You are told exactly what was found; never invent anything beyond it."
    : "You write one short compliance update for a small US manufacturer. Plain English, concrete. You are told exactly what was found; never invent anything beyond it.";

  const found = reportable.length
    ? reportable
        .map(
          (finding) =>
            `- [${finding.relevance}] ${finding.regulationRef}: ${
              finding.summaryId ?? finding.summaryEn ?? finding.reasoning
            }`,
        )
        .join("\n")
    : "(nothing flagged or noted)";

  const prompt =
    `Company: ${input.customer.name}\n` +
    `Entries checked today: ${allEntries.length}\n\n` +
    `## What was found\n\n${found}\n\n` +
    "## What to write\n\n" +
    "If nothing was flagged or noted, reply with ONE short bolded line saying today is clear — " +
    "for example '*Aman* — tidak ada yang baru hari ini.' and nothing else. " +
    "If something was found, say briefly what it is and why it might matter, in a couple of lines. " +
    "Do not list coverage gaps, failed sources, or unconfirmed codes: those are appended automatically " +
    "after your message, and repeating them makes the alert unreadable.";

  const { value } = await completeJson(provider, MessageSchema, {
    system,
    prompt,
    timeoutMs: 300_000,
  });
  return value;
}
