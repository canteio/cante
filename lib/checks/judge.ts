import { z } from "zod";
import { completeJson, type LlmProvider } from "@/lib/llm";
import type { CustomerProfile, Customer, Memory } from "@/lib/db/schema";
import type { FetchOutcome, FetchReport } from "@/lib/sources/fetch";
import { renderMemoryForPrompt } from "@/lib/db/queries";
import { renderHsCodesForPrompt, resolveHsCodes, resolveKbliCodes } from "@/lib/checks/facts";

/**
 * The judgment stage, ported from daily-prompt-check.md.
 *
 * The rules that matter are preserved verbatim in spirit: disclose failed or
 * zero-parse sources, never assert recency from the listing alone, and say
 * "nothing relevant" plainly instead of manufacturing a change.
 */

export const JudgmentSchema = z.object({
  summaryId: z
    .string()
    .describe("2-4 short lines of plain Bahasa Indonesia summarising today's check."),
  summaryEn: z.string().describe("One line of English summarising the same thing."),
  coverageCaveats: z
    .array(z.string())
    .describe(
      "Plain-language notes about anything that limits today's coverage: a failed source, " +
        "a view that parsed zero entries, unconfirmed HS codes, a long gap since the last run. " +
        "Empty array only if there is genuinely nothing to disclose.",
    ),
  findings: z
    .array(
      z.object({
        sourceId: z
          .string()
          .nullable()
          .describe("The sourceId from the regulation entry that produced this verdict."),
        regulationRef: z.string().describe('e.g. "Permendag 12 Tahun 2026"'),
        title: z.string(),
        url: z.string(),
        enactedOn: z
          .string()
          .nullable()
          .describe(
            "Enactment date (Tanggal Penetapan/Pengundangan) read off the detail page, " +
              "ISO format. Null if you could not fetch or find it.",
          ),
        relevance: z
          .enum(["flagged", "noted", "baseline", "clear"])
          .describe(
            "flagged = genuinely relevant and new, send it. noted = worth a manual look, " +
              "not confident. baseline = pre-existing backlog, record so tomorrow does not " +
              "treat it as fresh. clear = looked at, not relevant.",
          ),
        reasoning: z.string().describe("Why this verdict, in one or two sentences."),
        summaryId: z.string().nullable().describe("Bahasa Indonesia explanation, if flagged."),
        summaryEn: z.string().nullable().describe("One-line English gloss, if flagged."),
      }),
    )
    .describe("One entry per regulation you actually reached a verdict on."),
  whatsappMessage: z
    .string()
    .describe(
      "The ready-to-send WhatsApp message, in the tone of a real message to a business owner. " +
        "If nothing is relevant, this says so plainly.",
    ),
});

export type Judgment = z.infer<typeof JudgmentSchema>;

const SYSTEM_PROMPT = `You are the judgment stage of an Indonesian export-compliance monitor.

Your job is to read regulation listings the way an experienced person would, and decide honestly whether anything genuinely affects one specific exporter's product. You are not a keyword matcher. Most relevant regulations will not contain the product's name in the title.

Accuracy matters more than having something to report. Nothing-to-report is the expected outcome on most days — genuinely relevant changes for a single product category are rare, and a quiet alert is the product working, not failing.

Hard rules:
- Never fabricate a regulation or a change that is not clearly in the source material.
- Never claim a source was checked if it failed or parsed zero entries.
- Never assert something is new or recent on the strength of the listing alone. The listing carries a year, not a date. Before flagging anything as a change, fetch its detail page and read the enactment date under "Tanggal Penetapan / Pengundangan".
- If you are unsure whether something is new or relevant, say "worth a manual look" rather than asserting impact confidently.
- Write Bahasa Indonesia that a business owner reads easily: casual, clear, no legal jargon, no long quotes. Paraphrase.`;

export interface JudgeInput {
  customer: Customer;
  profile: CustomerProfile;
  report: FetchReport;
  /** Regulations already flagged in past runs — do not re-flag these. */
  seen: { regulationRef: string | null; title: string; relevance: string }[];
  /** ISO date of the previous completed run, if any. */
  lastRunAt: string | null;
  /**
   * Durable customer context accumulated since the profile was written. Passed
   * as rows rather than pre-rendered text so this stage can also resolve the
   * HS and KBLI facts from it — memory that only decorates the prompt changes
   * nothing about the product; memory that decides which codes are in force
   * changes every alert.
   */
  memories?: Memory[];
}

export async function judge(provider: LlmProvider, input: JudgeInput): Promise<Judgment> {
  const { value } = await completeJson(provider, JudgmentSchema, {
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    timeoutMs: 600_000,
  });
  return value;
}

export function buildPrompt(input: JudgeInput): string {
  const { customer, profile, report, seen, lastRunAt, memories = [] } = input;

  const failed = report.outcomes.filter((o) => !o.success);
  const zeroParse = report.outcomes.filter((o) => o.success && o.entriesParsed === 0);
  const isBootstrap = seen.length === 0;

  const memory = renderMemoryForPrompt(memories);
  const hsCodes = resolveHsCodes(profile, memories);
  const kbli = resolveKbliCodes(profile, memories);

  return `# Today's check

${memory}Customer: ${customer.name} — ${profile.productDescription}
Location: ${customer.city ?? "?"}, ${customer.country}
Side of trade: ${profile.sideOfTrade}

${renderHsCodesForPrompt(hsCodes)}

## Destination markets ${profile.destinationsConfirmed ? "(confirmed)" : "(NOT CONFIRMED)"}
${
  profile.destinationMarkets.length
    ? profile.destinationMarkets.map((m) => `  - ${m}`).join("\n")
    : "  (unknown — you cannot assess destination-specific rules, and must not imply that you did)"
}

## Relevance guidance
This is guidance for judgment, not a filter to apply mechanically. Something in the "almost never" list still matters if it changes an export procedure that applies to all exporters — read it, don't pattern-match it.

Likely relevant:
${profile.relevanceGuidance.likelyRelevant.map((g) => `  - ${g}`).join("\n")}

Almost never relevant:
${profile.relevanceGuidance.almostNeverRelevant.map((g) => `  - ${g}`).join("\n")}

## Source status — read this before anything else
${renderSourceStatus(report.outcomes)}
${
  failed.length || zeroParse.length
    ? `\nYou MUST disclose the above in coverageCaveats. Do not imply full coverage. ` +
      `A source listed as SKIPPED was not checked either — it is a failure, not a pass.`
    : ""
}
${
  report.heartbeats.length
    ? `\nPortal reachability pings (NOT regulations — never report one as a rule, a change, or a finding):\n${report.heartbeats
        .map((h) => `  - ${h.sourceName}: ${h.fullTitle}`)
        .join("\n")}`
    : ""
}

Each view shows only the newest ~10 of ~2,386 regulations. Last completed run: ${
    lastRunAt ?? "never (this is the first run)"
  }. ${
    lastRunAt
      ? "If that was several days ago, items may have scrolled off unseen — say so."
      : ""
  }

## Already seen in past runs — do not flag these again
${
  seen.length
    ? seen.map((s) => `  - [${s.relevance}] ${s.regulationRef ?? "?"} — ${s.title}`).join("\n")
    : "  (nothing — the log is empty)"
}
${
  isBootstrap
    ? `
### This is a bootstrap run
The log is empty, so the entire visible backlog looks new. Do NOT flag all of it. Flag at most what a person would genuinely act on today, and mark the remaining relevant-looking entries "baseline" so tomorrow's run does not treat them as fresh.`
    : ""
}

## Regulations found (${report.regulations.length}, deduplicated across views, newest first)

Use fullTitle — it is complete, reconstructed from the URL slug. listingTitle is truncated where truncated=true, and the cut-off part is usually the part that says what the rule covers.

Weight foundInViews: entries from the "ekspor" view are export-policy-tagged by Kemendag itself and are far likelier to matter than the general "semua" feed. The "perizinan" view is mostly historical.

Each regulation entry includes sourceId, sourceName, domain, and regulationType.
Copy sourceId into every finding you return so the stored finding points to the
actual source. Do not collapse everything into Kemendag.

${renderKbliSection(kbli)}
${JSON.stringify(report.regulations, null, 2)}

## What to do

For each regulation that could plausibly matter, fetch its detail page and read the enactment date before deciding. Then return your verdicts, the coverage caveats, and a ready-to-send WhatsApp message.

Return a verdict for every entry above that you did not already see in a past run — "clear" is a verdict and costs one line. An entry with no verdict is indistinguishable from one nobody looked at, and the run records it as unchecked.`;
}

/**
 * Source status, grouped by domain.
 *
 * A dead domain is one fact, not five. Listing peraturan.go.id's five views as
 * five separate failures trained the reader to skim the very section rule 2
 * depends on, so the skipped siblings collapse into one line.
 */
function renderSourceStatus(outcomes: FetchOutcome[]): string {
  const lines: string[] = [];
  const skippedByDomain = new Map<string, FetchOutcome[]>();

  for (const outcome of outcomes) {
    if (outcome.skipped) {
      const group = skippedByDomain.get(outcome.domain) ?? [];
      group.push(outcome);
      skippedByDomain.set(outcome.domain, group);
      continue;
    }
    const state = !outcome.success
      ? `FAILED (${outcome.errorMessage})`
      : outcome.entriesParsed === 0
        ? "SUCCEEDED BUT PARSED 0 ENTRIES — parser is broken, treat as UNCHECKED"
        : `OK (${outcome.entriesParsed} entries)`;
    lines.push(`  - ${outcome.name} [${outcome.view ?? "-"}] — ${state}`);

    const skipped = skippedByDomain.get(outcome.domain);
    if (!outcome.success && skipped?.length) {
      lines.push(
        `    ...plus ${skipped.length} more view(s) on ${outcome.domain} not attempted for the ` +
          `same reason (${skipped.map((s) => s.view ?? s.sourceId).join(", ")}) — also UNCHECKED`,
      );
      skippedByDomain.delete(outcome.domain);
    }
  }

  // Anything whose failing sibling was already printed above is folded in; the
  // rest still gets a line of its own rather than vanishing.
  for (const [domain, group] of skippedByDomain) {
    lines.push(
      `  - ${domain} — ${group.length} view(s) NOT ATTEMPTED (${group[0].errorMessage}) — UNCHECKED`,
    );
  }

  return lines.join("\n");
}

/**
 * The KBLI pass only earns its prompt space once a KBLI exists. Rendering the
 * full mapping instructions against an empty code list spent tokens on every
 * run to say nothing.
 */
function renderKbliSection(kbli: { confirmed: string[]; leads: string[] }): string {
  if (kbli.confirmed.length === 0) {
    return `## KBLI

No confirmed KBLI code. ${
      kbli.leads.length
        ? `Unconfirmed leads only: ${kbli.leads.join(", ")} — use as a lead, never as a mapped fact. `
        : ""
    }Say in coverageCaveats that KBLI-based licensing and sector-rule mapping cannot be done yet, and never claim "all applicable Indonesian rules" are covered.
`;
  }

  return `## KBLI mapping pass

Confirmed KBLI: ${kbli.confirmed.join(", ")}${
    kbli.leads.length ? ` (unconfirmed leads, treat as leads only: ${kbli.leads.join(", ")})` : ""
  }

Map these against official Indonesian rules before finalising coverage:
- OSS KBLI pages for the code: risk level, licensing, PB UMKU, sector ministry obligations.
- Official national-law sources for that KBLI/product context: peraturan.go.id, JDIHN, the
  relevant ministry JDIH, Kemenkeu/DJBC/DJP, Kemendag, and BSN/SNI.
- Treat UU, PP, Perpres/Kepres, Permen/Kepmen, Perda/Perkada, tax/customs, OSS and SNI as
  separate coverage families, and only claim the ones whose sources actually succeeded today.
`;
}
