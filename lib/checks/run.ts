import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  alerts,
  checkRuns,
  findings,
  sourceResults,
  sources,
  type JurisdictionProfile,
  type Memory,
} from "@/lib/db/schema";
import {
  getCustomerWithProfile,
  getJurisdictionProfile,
  getSeenRegulations,
  listMemories,
  reapStaleRuns,
} from "@/lib/db/queries";
import { getProvider, type LlmProviderChoice } from "@/lib/llm";
import { judge } from "@/lib/checks/judge";
import { auditVerdictCoverage, normalizeUrlKey } from "@/lib/checks/coverage";
import { selectSourceChanges } from "@/lib/checks/source-changes";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { fetchAllSources } from "@/lib/sources/fetch";
import { enrichPasalDates } from "@/lib/sources/pasal-dates";
import { fallbackCaveat, selectFallbackSources } from "@/lib/sources/fallback";
import {
  selectMonitoredSources,
  type SourceSelectionProfile,
} from "@/lib/sources/registry";
import { DEFAULT_JURISDICTION, type JurisdictionName } from "@/lib/countries";

/**
 * Orchestrates one check: fetch -> judge -> store.
 *
 * The fetch stage always records a row per source before the model is asked
 * anything, so a run that dies mid-judgment still leaves behind an honest
 * record of what was and wasn't reachable.
 */
export async function runCheck(
  customerId: string,
  providerChoice?: LlmProviderChoice,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<{ runId: string }> {
  const target = await getCustomerWithProfile(customerId);
  if (!target) throw new Error(`No customer/profile found for ${customerId}`);

  // A killed process leaves its run row saying "running" forever, and the
  // dashboard shows a check that looks like it is still working.
  reapStaleRuns();

  const runId = randomUUID();
  db.insert(checkRuns)
    .values({ id: runId, customerId, jurisdiction, status: "running" })
    .run();

  try {
    const provider = getProvider(providerChoice);
    const health = await provider.available();
    if (!health.ok) throw new Error(`LLM provider unavailable — ${health.detail}`);

    // --- Fetch stage -------------------------------------------------------
    const rawDir = path.join(process.cwd(), "raw");
    const jurisdictionProfile = await getJurisdictionProfile(customerId, jurisdiction);
    const memoryRows = await listMemories(customerId, jurisdiction);
    const previousRun = db
      .select({ completedAt: checkRuns.completedAt })
      .from(checkRuns)
      .where(
        and(
          eq(checkRuns.customerId, customerId),
          eq(checkRuns.jurisdiction, jurisdiction),
          eq(checkRuns.status, "complete"),
        ),
      )
      .orderBy(desc(checkRuns.completedAt))
      .get();
    const selection = selectMonitoredSources(
      jurisdiction,
      sourceProfileWithConfirmedMemory(jurisdictionProfile, memoryRows, target.profile.sideOfTrade),
      {
        lastCompletedAt: previousRun?.completedAt ?? null,
        locations:
          jurisdiction === "Indonesia"
            ? [target.customer.city, target.customer.country].filter((value): value is string => Boolean(value))
            : [],
      },
    );
    const monitored = selection.sources;
    if (monitored.length === 0) {
      throw new Error(`No monitored sources are registered for ${jurisdiction}.`);
    }
    for (const source of monitored) {
      db.insert(sources)
        .values({
          id: source.id,
          country: source.country,
          name: source.name,
          domain: source.domain,
          url: source.url,
          regulationType: source.regulationType,
          reliabilityStatus: source.reliabilityStatus,
          view: source.view ?? null,
          notes: source.notes ?? null,
        })
        .onConflictDoUpdate({
          target: sources.id,
          set: {
            name: source.name,
            domain: source.domain,
            url: source.url,
            regulationType: source.regulationType,
            reliabilityStatus: source.reliabilityStatus,
            view: source.view ?? null,
            notes: source.notes ?? null,
          },
        })
        .run();
    }
    const report = await fetchAllSources(monitored, rawDir, selection.coverageCaveats);

    // An official source that failed leaves the customer with nothing for that
    // topic. Where a re-publisher covers the same ministry, fetch it as a
    // labelled backup — additive, never a swap: the primary's failure row stays
    // untouched and a caveat says the official record was unreachable.
    const fallbacks = selectFallbackSources(report);
    if (fallbacks.length > 0) {
      for (const source of fallbacks) {
        db.insert(sources)
          .values({
            id: source.id,
            country: source.country,
            name: source.name,
            domain: source.domain,
            url: source.url,
            regulationType: source.regulationType,
            reliabilityStatus: source.reliabilityStatus,
            view: source.view ?? null,
            notes: source.notes ?? null,
          })
          .onConflictDoUpdate({
            target: sources.id,
            set: { name: source.name, url: source.url, notes: source.notes ?? null },
          })
          .run();
      }
      const backup = await fetchAllSources(fallbacks, rawDir);
      report.outcomes.push(...backup.outcomes);
      report.regulations.push(...backup.regulations);
      report.heartbeats.push(...backup.heartbeats);
      for (const outcome of backup.outcomes) {
        if (outcome.success) report.coverageCaveats.push(fallbackCaveat(outcome.sourceId));
      }
      console.log(`[fallback] ${fallbacks.length} backup source(s) fetched for failed primaries`);
    }

    for (const outcome of report.outcomes) {
      db.insert(sourceResults)
        .values({
          id: randomUUID(),
          checkRunId: runId,
          sourceId: outcome.sourceId,
          success: outcome.success,
          errorMessage: outcome.errorMessage,
          entriesParsed: outcome.entriesParsed,
          parseWarning: outcome.parseWarning,
          rawContentPath: outcome.rawContentPath,
          fetchedAt: outcome.fetchedAt,
        })
        .run();

      if (outcome.success) {
        db.update(sources)
          .set({ lastSuccessAt: outcome.fetchedAt })
          .where(eq(sources.id, outcome.sourceId))
          .run();
      }
    }

    if (report.outcomes.every((o) => !o.success)) {
      throw new Error("Every source failed — there is nothing for the judgment stage to read.");
    }

    const seen = await getSeenRegulations(customerId, jurisdiction);
    const fetchedInventoryCount = report.regulations.length;
    const changes = selectSourceChanges(
      customerId,
      jurisdiction,
      report.regulations,
      seen.map((entry) => entry.url),
    );
    report.regulations = changes.regulations;
    report.coverageCaveats.push(...changes.caveats);

    // pasal.id publishes no date through its API, so entries arrive knowing only
    // their year. Enrich here rather than in the parser: this runs after the
    // ledger diff, so only the handful of new or changed regulations cost a
    // lookup instead of the whole year, every day. Failures are absorbed into
    // caveats — a missing date must never fail a run that otherwise succeeded.
    const pasalDates = await enrichPasalDates(report.regulations);
    report.coverageCaveats.push(...pasalDates.caveats);
    if (pasalDates.attempted > 0) {
      console.log(
        `[pasal-dates] ${pasalDates.resolved} of ${pasalDates.attempted} enactment dates resolved`,
      );
    }
    report.coverageCaveats.push(
      jurisdiction === "Indonesia"
        ? `Inventaris sumber membuat sidik jari untuk ${fetchedInventoryCount} catatan yang berhasil diambil; ${changes.newCount} baru ditemukan setelah baseline, ${changes.changedCount} berubah sejak inventaris sebelumnya, ${changes.baselinedCount} menjadi baseline historis pada run pertama, dan ${changes.regulations.length} masuk tahap penilaian.`
        : `The source inventory fingerprinted ${fetchedInventoryCount} successfully fetched records; ${changes.newCount} were new after baseline, ${changes.changedCount} changed since the prior inventory, ${changes.baselinedCount} were recorded as first-run historical baseline, and ${changes.regulations.length} entered judgment.`,
    );

    // --- Judgment stage ----------------------------------------------------
    const seenForPrompt = seen.map((s) => ({
      regulationRef: s.regulationRef,
      title: s.title,
      url: s.url,
      relevance: s.relevance,
    }));
    const judgment = await judge(provider, {
      customer: target.customer,
      profile: target.profile,
      jurisdiction,
      jurisdictionProfile,
      report,
      seen: seenForPrompt,
      lastRunAt: previousRun?.completedAt ?? null,
      memories: memoryRows,
    });

    // --- Completion pass -----------------------------------------------------
    // judge()'s prompt explicitly instructs the model to return a verdict for
    // every entry — but on a large batch it does not always fully comply, and
    // auditVerdictCoverage() is exactly what catches that. Disclosing the gap
    // is necessary but not sufficient: retry once against only the entries the
    // first pass missed. A much smaller batch is far more likely to get full
    // compliance. Bounded to a single retry, so worst case is two model calls,
    // never an open-ended loop chasing a model that may never fully finish. A
    // retry failure must not fail a run that otherwise succeeded — it falls
    // back to the same honest "unaccounted" disclosure the first pass would
    // have produced alone.
    const lang = jurisdiction === "United States" ? "en" : "id";
    let allFindings = judgment.findings;
    let allCaveats = judgment.coverageCaveats;
    let finalMessage = judgment.whatsappMessage;

    const firstPassCoverage = auditVerdictCoverage(
      report.regulations,
      allFindings.map((f) => f.url),
      seen.map((s) => s.url),
      lang,
    );

    if (firstPassCoverage.unaccounted.length > 0) {
      try {
        const retrySeen = [
          ...seenForPrompt,
          ...allFindings.map((f) => ({
            regulationRef: f.regulationRef,
            title: f.title,
            url: f.url,
            relevance: f.relevance,
          })),
        ];
        const retryJudgment = await judge(provider, {
          customer: target.customer,
          profile: target.profile,
          jurisdiction,
          jurisdictionProfile,
          report: { ...report, regulations: firstPassCoverage.unaccounted },
          seen: retrySeen,
          lastRunAt: previousRun?.completedAt ?? null,
          memories: memoryRows,
        });

        // Only accept verdicts for entries actually in the missed set — the
        // model choosing to re-litigate something already judged does not
        // count as completing the retry.
        const missedUrls = new Set(firstPassCoverage.unaccounted.map((e) => normalizeUrlKey(e.url)));
        const validRetryFindings = retryJudgment.findings.filter((f) =>
          missedUrls.has(normalizeUrlKey(f.url)),
        );
        allFindings = [...allFindings, ...validRetryFindings];

        const newlySurfaced = validRetryFindings.filter(
          (f) => f.relevance === "flagged" || f.relevance === "noted",
        );
        if (newlySurfaced.length > 0) {
          finalMessage +=
            lang === "en"
              ? `\n\n[Follow-up pass — ${newlySurfaced.length} item(s) missed on the first pass:]\n` +
                newlySurfaced.map((f) => `- ${f.regulationRef}: ${f.summaryEn ?? f.reasoning}`).join("\n")
              : `\n\n[Ditemukan di pemeriksaan lanjutan — ${newlySurfaced.length} item terlewat di pass pertama:]\n` +
                newlySurfaced.map((f) => `- ${f.regulationRef}: ${f.summaryId ?? f.reasoning}`).join("\n");
        }

        allCaveats = [
          ...allCaveats,
          lang === "en"
            ? `Completion pass: ${validRetryFindings.length} of ${firstPassCoverage.unaccounted.length} initially-unjudged entries received a verdict on retry.`
            : `Pemeriksaan lanjutan: ${validRetryFindings.length} dari ${firstPassCoverage.unaccounted.length} entri yang awalnya belum dinilai kini mendapat verdict pada percobaan ulang.`,
        ];
      } catch (retryError) {
        const message = retryError instanceof Error ? retryError.message : String(retryError);
        allCaveats = [
          ...allCaveats,
          lang === "en"
            ? `Completion pass failed (${message}) — ${firstPassCoverage.unaccounted.length} entries remain unjudged from the first pass.`
            : `Pemeriksaan lanjutan gagal (${message}) — ${firstPassCoverage.unaccounted.length} entri masih belum dinilai dari pass pertama.`,
        ];
      }
    }

    // --- Store -------------------------------------------------------------
    // Entries in, verdicts out. Anything fetched but never judged, and never
    // seen before, is unchecked — and has to say so in the alert.
    const coverage = auditVerdictCoverage(
      report.regulations,
      allFindings.map((f) => f.url),
      seen.map((s) => s.url),
      lang,
    );
    console.log(
      `[coverage] ${coverage.totalEntries} entries — ${coverage.judged} judged, ` +
        `${coverage.alreadySeen} already seen, ${coverage.unaccounted.length} unaccounted`,
    );
    for (const finding of allFindings) {
      db.insert(findings)
        .values({
          id: randomUUID(),
          checkRunId: runId,
          customerId,
          sourceId: finding.sourceId ?? null,
          regulationRef: finding.regulationRef,
          title: finding.title,
          url: finding.url,
          enactedOn: finding.enactedOn,
          summaryId: finding.summaryId,
          summaryEn: finding.summaryEn,
          relevance: finding.relevance,
          reasoning: finding.reasoning,
        })
        .run();
    }

    const caveats = [...new Set([
      ...allCaveats,
      ...report.coverageCaveats,
      ...coverage.caveats,
    ])];
    const body = [
      finalMessage,
      caveats.length
        ? `\n---\n${jurisdiction === "Indonesia" ? "Catatan cakupan" : "Coverage notes"}:\n${caveats.map((c) => `- ${c}`).join("\n")}`
        : "",
    ]
      .join("")
      .trim();

    db.insert(alerts)
      .values({
        id: randomUUID(),
        checkRunId: runId,
        customerId,
        findingId: null,
        body,
        channel: "manual",
        deliveryStatus: "pending",
      })
      .run();

    db.update(checkRuns)
      .set({ status: "complete", completedAt: new Date().toISOString() })
      .where(eq(checkRuns.id, runId))
      .run();

    await refreshChecklistForCustomer(customerId, jurisdiction);

    return { runId };
  } catch (err) {
    db.update(checkRuns)
      .set({
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(checkRuns.id, runId))
      .run();
    throw err;
  }
}

/** All-empty selection facts, used when only the side of trade is known. */
function emptySelectionProfile(): Omit<SourceSelectionProfile, "sideOfTrade"> {
  return {
    facilityAddresses: [],
    products: [],
    distributionStates: [],
    labelsClaims: [],
    htsScheduleBCodes: [],
    exportClassifications: [],
    exportCountries: [],
    regulatedProductFlags: [],
  };
}

function sourceProfileWithConfirmedMemory(
  profile: JurisdictionProfile | null,
  memories: Memory[],
  sideOfTrade?: string | null,
): SourceSelectionProfile | null {
  // A stated side of trade is a fact about the customer, not about a
  // jurisdiction, so it comes off the customer profile and is threaded in here
  // rather than duplicated per country.
  if (!profile) return sideOfTrade ? { ...emptySelectionProfile(), sideOfTrade } : null;
  const confirmed = memories.filter((memory) => memory.confirmed);
  const values = (kind: string) =>
    confirmed.filter((memory) => memory.kind === kind).map((memory) => memory.content);
  const codes = (kind: string, pattern: RegExp) =>
    values(kind).map((content) => ({ code: content.match(pattern)?.[0] ?? content }));

  return {
    sideOfTrade: sideOfTrade ?? null,
    facilityAddresses: [...profile.facilityAddresses, ...values("location")],
    products: [...profile.products, ...values("product")],
    distributionStates: [...profile.distributionStates, ...values("distribution_state")],
    labelsClaims: [...profile.labelsClaims, ...values("label_claim")],
    htsScheduleBCodes: [
      ...profile.htsScheduleBCodes,
      ...codes("hs_code", /\b\d{4}(?:[.\s-]?\d{2}){1,3}\b/),
    ],
    exportClassifications: [
      ...profile.exportClassifications,
      ...codes("export_classification", /\b(?:EAR99|[0-9][A-E][0-9]{3})\b/i),
    ],
    exportCountries: [...profile.exportCountries, ...values("market")],
    regulatedProductFlags: [...profile.regulatedProductFlags, ...values("product_flag")],
  };
}
