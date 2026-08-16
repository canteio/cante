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
import { auditVerdictCoverage } from "@/lib/checks/coverage";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { fetchAllSources } from "@/lib/sources/fetch";
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
      sourceProfileWithConfirmedMemory(jurisdictionProfile, memoryRows),
      { lastCompletedAt: previousRun?.completedAt ?? null },
    );
    const monitored = selection.sources;
    if (monitored.length === 0) {
      throw new Error(`No monitored sources are registered for ${jurisdiction}.`);
    }
    const report = await fetchAllSources(monitored, rawDir, selection.coverageCaveats);

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

    // --- Judgment stage ----------------------------------------------------
    const seen = await getSeenRegulations(customerId, jurisdiction);
    const judgment = await judge(provider, {
      customer: target.customer,
      profile: target.profile,
      jurisdiction,
      jurisdictionProfile,
      report,
      seen: seen.map((s) => ({
        regulationRef: s.regulationRef,
        title: s.title,
        url: s.url,
        relevance: s.relevance,
      })),
      lastRunAt: previousRun?.completedAt ?? null,
      memories: memoryRows,
    });

    // --- Store -------------------------------------------------------------
    // Entries in, verdicts out. Anything fetched but never judged, and never
    // seen before, is unchecked — and has to say so in the alert.
    const coverage = auditVerdictCoverage(
      report.regulations,
      judgment.findings.map((f) => f.url),
      seen.map((s) => s.url),
      jurisdiction === "United States" ? "en" : "id",
    );
    console.log(
      `[coverage] ${coverage.totalEntries} entries — ${coverage.judged} judged, ` +
        `${coverage.alreadySeen} already seen, ${coverage.unaccounted.length} unaccounted`,
    );
    for (const finding of judgment.findings) {
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
      ...judgment.coverageCaveats,
      ...report.coverageCaveats,
      ...coverage.caveats,
    ])];
    const body = [
      judgment.whatsappMessage,
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

function sourceProfileWithConfirmedMemory(
  profile: JurisdictionProfile | null,
  memories: Memory[],
): SourceSelectionProfile | null {
  if (!profile) return null;
  const confirmed = memories.filter((memory) => memory.confirmed);
  const values = (kind: string) =>
    confirmed.filter((memory) => memory.kind === kind).map((memory) => memory.content);
  const codes = (kind: string, pattern: RegExp) =>
    values(kind).map((content) => ({ code: content.match(pattern)?.[0] ?? content }));

  return {
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
