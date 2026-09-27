import { z } from "zod";
import { completeJson, type LlmProvider } from "@/lib/llm";
import type {
  CustomerProfile,
  Customer,
  JurisdictionProfile,
  Memory,
} from "@/lib/db/schema";
import type { FetchOutcome, FetchReport } from "@/lib/sources/fetch";
import { renderMemoryForPrompt } from "@/lib/db/queries";
import { renderHsCodesForPrompt, resolveHsCodes, resolveKbliCodes } from "@/lib/checks/facts";
import type { JurisdictionName } from "@/lib/countries";

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
    .describe("2-4 short lines in the primary language required by the system prompt."),
  summaryEn: z
    .string()
    .describe("One-line English gloss; in US mode this may repeat the primary English summary."),
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
        summaryId: z
          .string()
          .nullable()
          .describe("Primary-language explanation required by the system prompt, if flagged."),
        summaryEn: z.string().nullable().describe("One-line English gloss, if flagged."),
      }),
    )
    .describe("One entry per regulation you actually reached a verdict on."),
  whatsappMessage: z
    .string()
    .describe(
      "The ready-to-send WhatsApp message, in the tone of a real message to a business owner. " +
        "Use the language required by the system prompt. If nothing is flagged or noted, this must be " +
        "ONE short line stating so plainly, bolded with a single leading/trailing asterisk " +
        "(WhatsApp's own bold syntax, not Markdown) — e.g. '*Aman* — tidak ada yang baru hari ini.' or '*Clear* — nothing new today.' Do not add an explanatory paragraph after it, and do " +
        "not restate coverage caveats, failed sources, or unconfirmed HS/KBLI facts here — code appends " +
        "those automatically as a separate section right after this message. Only write more than the " +
        "one-line summary when something is actually flagged or noted and needs explaining.",
    ),
});

export type Judgment = z.infer<typeof JudgmentSchema>;

const SYSTEM_PROMPT = `You are the judgment stage of an Indonesian compliance monitor for one manufacturer.

Your job is to read regulation listings the way an experienced person would, and decide honestly whether anything genuinely affects this specific company. You are not a keyword matcher. Most relevant regulations will not contain the product's name in the title.

The company may export, import, or sell only domestically — "Side of trade" below says which. Do not assume export. A purely domestic manufacturer is a normal customer, and for one, export licensing and customs procedure are irrelevant while KBLI licensing, OSS, SNI product standards, environmental permits, labor and OHS rules, tax administration, and local Perda are the substance of the job. Judge against what this company actually does.

Accuracy matters more than having something to report. Nothing-to-report is the expected outcome on most days — genuinely relevant changes for a single product category are rare, and a quiet alert is the product working, not failing.

Hard rules:
- Never fabricate a regulation or a change that is not clearly in the source material.
- Never claim a source was checked if it failed or parsed zero entries.
- Never assert something is new or recent without an authoritative legal or publication date. Kemendag listings carry only a year; use their detail page. Other entries may carry structured dates from the official source; preserve the distinction between legal dates, upload dates, and notice-posting dates.
- If you are unsure whether something is new or relevant, say "worth a manual look" rather than asserting impact confidently.
- Write Bahasa Indonesia that a business owner reads easily: casual, clear, no legal jargon, no long quotes. Paraphrase.
- Keep the WhatsApp message short. If nothing is flagged or noted, one bolded line is the whole message — do not add a "Catatan" paragraph restating coverage gaps, failed sources, or unconfirmed HS/KBLI codes; those are appended automatically afterward. Never state or imply a specific entry was already checked unless you actually returned a verdict for it — that claim is audited against your own findings and will be caught if false.`;

const US_SYSTEM_PROMPT = `You are the judgment stage of a United States manufacturing, distribution, and export compliance monitor.

Your job is to decide whether official federal, state, local, product, and trade changes plausibly affect one specific company. You are not a keyword matcher. Match rules against the company's actual facilities, NAICS, products, materials, processes, waste streams, labels, distribution states, and export profile.

Accuracy matters more than having something to report. A quiet check is normal.

Hard rules:
- Never fabricate a rule, obligation, classification, permit, or change.
- Never claim a source was checked if it failed, was skipped, or parsed zero entries.
- Federal Register publication is not the same as an effective date. Each entry already carries the agency's own effectiveOn, commentsCloseOn, datesNote, documentType, and action straight from the official API — use those fields rather than guessing, and say so plainly when effectiveOn is null (many proposals and notices have no effective date at all).
- Only fetch a document when the entry's own fields leave a real question open. Fetch textUrl (plain text through the official API), never the url HTML page — that page is ~100KB and intermittently blocks automated requests.
- An eCFR section change is evidence that text changed, not proof that it applies to this company. Its amendedOn field is the eCFR amendment date, not a legal effective date; effectiveOn is explicitly null unless a separate official source establishes one.
- A portal heartbeat only proves the page was reachable. It is never regulation coverage.
- Proposed rules are not current obligations. Label them clearly and only flag an action if the company should comment, prepare, or investigate now.
- Missing company facts are coverage gaps. Do not infer NAICS, ECCN, permit status, waste streams, or distribution states.
- Never describe an item as probably, typically, or likely EAR99. Without a documented classification, say ECCN/EAR99 is unknown.
- If applicability requires legal, engineering, environmental, customs, or export-control judgment, use "requires expert review" language.
- Write concise plain English for a small manufacturer. Cite the agency, document number or CFR citation, and source URL.
- Keep the WhatsApp message short. If nothing is flagged or noted, one bolded line is the whole message — do not add a paragraph restating coverage gaps, failed sources, or unconfirmed facts; those are appended automatically afterward. Never state or imply a specific entry was already checked unless you actually returned a verdict for it — that claim is audited against your own findings and will be caught if false.`;

export interface JudgeInput {
  customer: Customer;
  profile: CustomerProfile;
  jurisdiction: JurisdictionName;
  jurisdictionProfile: JurisdictionProfile | null;
  report: FetchReport;
  /** Regulations already flagged in past runs — do not re-flag these. */
  seen: { regulationRef: string | null; title: string; url: string | null; relevance: string }[];
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
    system: input.jurisdiction === "United States" ? US_SYSTEM_PROMPT : SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    timeoutMs: 600_000,
  });
  return value;
}

export function buildPrompt(input: JudgeInput): string {
  if (input.jurisdiction === "United States") return buildUsPrompt(input);
  const { customer, profile, report, seen, lastRunAt, memories = [] } = input;

  const failed = report.outcomes.filter((o) => !o.success);
  const zeroParse = report.outcomes.filter(
    (o) => o.success && o.entriesParsed === 0 && !o.validEmpty,
  );
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

Each Kemendag listing view shows only the newest ~10 of ~2,386 regulations. Other source windows are described in the code-written coverage notes. Last completed run: ${
    lastRunAt ?? "never (this is the first run)"
  }. ${
    lastRunAt
      ? "If that was several days ago, items may have scrolled off unseen — say so."
      : ""
  }

## Already seen in past runs — do not flag these again
${
  seen.length
    ? seen.map((s) => `  - [${s.relevance}] ${s.regulationRef ?? "?"} — ${s.title} — ${s.url ?? "no URL"}`).join("\n")
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

An entry carrying a "provenance" field did NOT come from the government's own record — it was re-published by a private legal database because the official source is unreachable. Most such rows are the publisher's unreviewed parse. Judge the substance normally, but never present one as an official record: say in the message that it comes from a private re-publisher and still needs confirming against the official document, and prefer "worth a manual look" over asserting a confident obligation. An entry with no provenance field came straight from the official portal and needs no such hedge.

For those entries, read "datesNote" before deciding anything about recency. When it names a Ditetapkan (signed) or Diundangkan (promulgated) date, that date is established and you may reason from it — a rule promulgated last month is genuinely recent, one promulgated eight months ago is not, and saying so is the point of the monitor. When datesNote is absent or empty, the year is the only time fact available: do not state or imply the entry is new, recent, or newly in force. In neither case is the date it takes legal effect established — that is usually set by the regulation's own closing article and can be later than promulgation, so do not present a promulgation date as an effective date.

${renderKbliSection(kbli)}
${JSON.stringify(report.regulations, null, 2)}

## What to do

For each regulation that could plausibly matter, fetch its detail page and read the enactment date before deciding. Then return your verdicts, the coverage caveats, and a ready-to-send WhatsApp message.

Return a verdict for every entry above that you did not already see in a past run — "clear" is a verdict and costs one line. Copy sourceId and url exactly from the entry; never rewrite a URL. An entry with no verdict is indistinguishable from one nobody looked at, and the run records it as unchecked.`;
}

function buildUsPrompt(input: JudgeInput): string {
  const { customer, profile, jurisdictionProfile: us, report, seen, lastRunAt, memories = [] } = input;
  const failed = report.outcomes.filter((o) => !o.success);
  const zeroParse = report.outcomes.filter(
    (o) => o.success && o.entriesParsed === 0 && !o.validEmpty,
  );
  const isBootstrap = seen.length === 0;
  const memory = renderMemoryForPrompt(memories);
  const codes = (rows: { code: string; basis: string; confirmed: boolean }[] | undefined) =>
    rows?.length
      ? rows.map((row) => `  - ${row.code} [${row.confirmed ? "confirmed" : "unconfirmed"}] - ${row.basis}`).join("\n")
      : "  (none recorded)";
  const list = (values: string[] | undefined) =>
    values?.length ? values.map((value) => `  - ${value}`).join("\n") : "  (none recorded)";

  return `# United States compliance check

${memory}Customer: ${customer.name}
Home profile: ${profile.productDescription}
Selected jurisdiction: United States
Legal name: ${us?.legalName ?? "not recorded"}

## Facilities
${list(us?.facilityAddresses)}

## NAICS
${codes(us?.naicsCodes)}

## Products and SKUs
${list([...(us?.products ?? []), ...(us?.skus ?? []).map((sku) => `SKU ${sku}`)])}

## Materials, chemicals, processes, and waste
Materials/chemicals:
${list(us?.materialsChemicals)}
Processes:
${list(us?.manufacturingProcesses)}
Waste streams:
${list(us?.wasteStreams)}

## Labels and claims
${list(us?.labelsClaims)}

## Distribution states
${list(us?.distributionStates)}

## Export profile
HTS / Schedule B:
${codes(us?.htsScheduleBCodes)}
ECCN / EAR99:
${codes(us?.exportClassifications)}
Export countries:
${list(us?.exportCountries)}

## Regulated product flags
${list(us?.regulatedProductFlags)}

Missing fields above are unknowns that limit applicability analysis. Disclose material gaps.

## Separate coverage tracks
- Domestic manufacturing: OSHA, EPA/TSCA/RCRA/air/water/waste, product safety, labeling, and facility permits.
- Distribution: state product, packaging/EPR/PFAS/chemical, tax, warehouse, hazmat, warranty, and consumer rules for the recorded distribution states.
- Export: HTS/Schedule B, EAR/ECCN/EAR99, BIS license controls, AES/FTR, OFAC, end user/end use, CBP, and ITAR only when the product flags support it.

Do not imply that one successful federal feed covers all three tracks. State and local coverage is location-specific.

## Source status
${renderSourceStatus(report.outcomes)}
${failed.length || zeroParse.length ? "\nDisclose every failed, skipped, or zero-parse source in coverageCaveats." : ""}
${
  report.coverageCaveats.length
    ? `\nProfile-driven sources not activated this run (code appends these exact caveats to the final alert; do not claim this coverage):\n${report.coverageCaveats
        .map((caveat) => `  - ${caveat}`)
        .join("\n")}`
    : ""
}
${
  report.heartbeats.length
    ? `\nPortal reachability pings (NOT regulations and NOT complete change coverage):\n${report.heartbeats
        .map((h) => `  - ${h.sourceName}: ${h.fullTitle}`)
        .join("\n")}`
    : ""
}

Last completed United States run: ${lastRunAt ?? "never (bootstrap run)"}.

## Already seen in United States runs
${seen.length ? seen.map((s) => `  - [${s.relevance}] ${s.regulationRef ?? "?"} - ${s.title} - ${s.url ?? "no URL"}`).join("\n") : "  (none)"}
${isBootstrap ? "\nThis is a bootstrap run. Do not call the visible backlog new. Use baseline for older relevant material." : ""}

An entry is already seen only when its exact entry URL appears above. A matching title with a different URL is not enough; judge that entry and copy its current URL exactly.

## Official entries (${report.regulations.length}, deduplicated)

Federal Register entries carry structured official fields: documentType ("Rule" / "Proposed Rule" / "Notice"), action, effectiveOn, commentsCloseOn, and datesNote. These come from the Federal Register API itself, so publication date, effective date, and comment deadline are already known — do not re-derive them from the title and do not report them as unverified.

eCFR entries are codified text that has already changed, windowed from the last completed run. amendedOn is the eCFR amendment date; it is not proof of the legal effective date, and effectiveOn remains null unless a separate official source establishes one. The #cante-amendment-YYYY-MM-DD fragment gives each section amendment a distinct monitoring identity while the underlying link still opens the current eCFR citation. OSHA RSS is a targeted duplicate view of Federal Register documents.

textUrl is the plain-text version of the document through the official API. Fetch it only when the fields above leave a genuine question — otherwise judge from the entry. Never fetch the url HTML page; keep url for citation only.

${JSON.stringify(report.regulations, null, 2)}

## Output rules

All output text MUST be English, including summaryId, summaryEn, coverageCaveats, reasoning, and whatsappMessage.

Do not estimate how many entries were judged, already seen, or unaccounted in coverageCaveats. Code performs that audit after your response and appends the exact counts.

Return one verdict for every entry not already seen. Use clear for reviewed non-applicable entries. Copy sourceId and url exactly from the entry; never rewrite a URL. The ready-to-send message must be plain English and separate domestic, distribution, and export impact when more than one track is involved. State what remains unchecked and what evidence is needed.`;
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
      : outcome.validEmpty
        ? "OK (validated empty listing; 0 current entries)"
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
