import { randomUUID } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts, checkRuns, findings, sourceResults, sources } from "@/lib/db/schema";
import {
  getCustomerWithProfile,
  getSeenRegulations,
  listMemories,
  reapStaleRuns,
} from "@/lib/db/queries";
import { getProvider, type LlmProviderChoice } from "@/lib/llm";
import { judge } from "@/lib/checks/judge";
import { auditVerdictCoverage } from "@/lib/checks/coverage";
import { fetchAllSources } from "@/lib/sources/fetch";
import { monitoredSources } from "@/lib/sources/registry";
import { desc, and } from "drizzle-orm";

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
): Promise<{ runId: string }> {
  const target = await getCustomerWithProfile(customerId);
  if (!target) throw new Error(`No customer/profile found for ${customerId}`);

  // A killed process leaves its run row saying "running" forever, and the
  // dashboard shows a check that looks like it is still working.
  reapStaleRuns();

  const runId = randomUUID();
  db.insert(checkRuns)
    .values({ id: runId, customerId, status: "running" })
    .run();

  try {
    const provider = getProvider(providerChoice);
    const health = await provider.available();
    if (!health.ok) throw new Error(`LLM provider unavailable — ${health.detail}`);

    // --- Fetch stage -------------------------------------------------------
    const rawDir = path.join(process.cwd(), "raw");
    const monitored = monitoredSources();
    const report = await fetchAllSources(monitored, rawDir);

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
    const seen = await getSeenRegulations(customerId);
    const previousRun = db
      .select({ completedAt: checkRuns.completedAt })
      .from(checkRuns)
      .where(and(eq(checkRuns.customerId, customerId), eq(checkRuns.status, "complete")))
      .orderBy(desc(checkRuns.completedAt))
      .get();

    const judgment = await judge(provider, {
      customer: target.customer,
      profile: target.profile,
      report,
      seen: seen.map((s) => ({
        regulationRef: s.regulationRef,
        title: s.title,
        relevance: s.relevance,
      })),
      lastRunAt: previousRun?.completedAt ?? null,
      memories: await listMemories(customerId),
    });

    // --- Store -------------------------------------------------------------
    // Entries in, verdicts out. Anything fetched but never judged, and never
    // seen before, is unchecked — and has to say so in the alert.
    const coverage = auditVerdictCoverage(
      report.regulations,
      judgment.findings.map((f) => f.url),
      seen.map((s) => s.url),
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

    const caveats = [...judgment.coverageCaveats, ...coverage.caveats];
    const body = [
      judgment.whatsappMessage,
      caveats.length ? `\n---\nCatatan cakupan:\n${caveats.map((c) => `- ${c}`).join("\n")}` : "",
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
