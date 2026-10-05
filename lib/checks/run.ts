import { randomUUID } from "node:crypto";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import type { JurisdictionProfile, Memory } from "@/lib/db/schema";
import {
  getCustomerWithProfile,
  getJurisdictionProfile,
  getSeenRegulations,
  listMemories,
  reapStaleRuns,
} from "@/lib/db/queries";
import { getProvider, type LlmProviderChoice } from "@/lib/llm";
import { judge } from "@/lib/checks/judge";
import { judgeAllEntries, planBatches } from "@/lib/checks/judge-batched";
import { auditVerdictCoverage, normalizeUrlKey } from "@/lib/checks/coverage";
import { detectRegulationLinks, linkRegulation } from "@/lib/checks/lifecycle";
import { briefFindings, renderBriefings } from "@/lib/checks/briefing";
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
  // runCheck runs both from HTTP routes and standalone CLI/cron scripts
  // (scripts/run-check.ts, scripts/scheduled-check.ts) with no cookie/user
  // session available. The `sources` table it writes to is shared
  // operational metadata (last-fetched timestamps, registry state), not
  // per-tenant data, so the trusted service client — which intentionally
  // bypasses RLS — is the correct client here, not the cookie-backed one.
  const supabase = createServiceClient();
  const target = await getCustomerWithProfile(customerId);
  if (!target) throw new Error(`No customer/profile found for ${customerId}`);

  // A killed process leaves its run row saying "running" forever, and the
  // dashboard shows a check that looks like it is still working.
  await reapStaleRuns();

  const runId = randomUUID();
  await checked(supabase.from("check_runs").insert({ id: runId, customer_id: customerId, jurisdiction, status: "running" }));

  try {
    const provider = getProvider(providerChoice);
    const health = await provider.available();
    if (!health.ok) throw new Error(`LLM provider unavailable — ${health.detail}`);

    // --- Fetch stage -------------------------------------------------------
    const rawDir = path.join(process.cwd(), "raw");
    const jurisdictionProfile = await getJurisdictionProfile(customerId, jurisdiction);
    const memoryRows = await listMemories(customerId, jurisdiction);
    const { data: previousRun, error: previousRunError } = await supabase
      .from("check_runs").select("completed_at")
      .eq("customer_id", customerId).eq("jurisdiction", jurisdiction)
      .eq("status", "complete").order("completed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (previousRunError) throw new Error(`Previous run lookup failed: ${previousRunError.message}`);
    const selection = selectMonitoredSources(
      jurisdiction,
      sourceProfileWithConfirmedMemory(jurisdictionProfile, memoryRows, target.profile.sideOfTrade),
      {
        lastCompletedAt: previousRun?.completed_at ?? null,
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
      await checked(supabase.from("sources").upsert({
        id: source.id,
        country: source.country,
        name: source.name,
        domain: source.domain,
        url: source.url,
        regulation_type: source.regulationType,
        reliability_status: source.reliabilityStatus,
        view: source.view ?? null,
        notes: source.notes ?? null,
      }, { onConflict: "id" }));
    }
    const report = await fetchAllSources(monitored, rawDir, selection.coverageCaveats);

    // An official source that failed leaves the customer with nothing for that
    // topic. Where a re-publisher covers the same ministry, fetch it as a
    // labelled backup — additive, never a swap: the primary's failure row stays
    // untouched and a caveat says the official record was unreachable.
    const fallbacks = selectFallbackSources(report);
    if (fallbacks.length > 0) {
      for (const source of fallbacks) {
        await checked(supabase.from("sources").upsert({
          id: source.id,
          country: source.country,
          name: source.name,
          domain: source.domain,
          url: source.url,
          regulation_type: source.regulationType,
          reliability_status: source.reliabilityStatus,
          view: source.view ?? null,
          notes: source.notes ?? null,
        }, { onConflict: "id" }));
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
      await checked(supabase.from("source_results").insert({
        id: randomUUID(),
        check_run_id: runId,
        source_id: outcome.sourceId,
        success: outcome.success,
        error_message: outcome.errorMessage,
        entries_parsed: outcome.entriesParsed,
        parse_warning: outcome.parseWarning,
        raw_content_path: outcome.rawContentPath,
        fetched_at: outcome.fetchedAt,
      }));

      if (outcome.success) {
        await checked(supabase.from("sources").update({ last_success_at: outcome.fetchedAt }).eq("id", outcome.sourceId));
      }
    }

    if (report.outcomes.every((o) => !o.success)) {
      throw new Error("Every source failed — there is nothing for the judgment stage to read.");
    }

    const seen = await getSeenRegulations(customerId, jurisdiction);
    const fetchedInventoryCount = report.regulations.length;
    const changes = await selectSourceChanges(
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
    // Batched, because one large batch is exactly what was going unjudged —
    // 62 entries in, 20 verdicts back. See lib/checks/judge-batched.ts.
    const judgment = await judgeAllEntries(provider, {
      customer: target.customer,
      profile: target.profile,
      jurisdiction,
      jurisdictionProfile,
      report,
      seen: seenForPrompt,
      lastRunAt: previousRun?.completed_at ?? null,
      memories: memoryRows,
    });
    console.log(
      `[judgment] ${report.regulations.length} entries in ${judgment.batches} batch(es) — ` +
      `${judgment.findings.length} verdicts, ${judgment.failedBatches} batch failure(s)`,
    );

    // --- Completion pass -----------------------------------------------------
    // Batching the first pass is the actual fix for entries going unjudged, so
    // this is now a genuine long stop rather than the main mechanism: it exists
    // for whatever a batch still drops. It re-asks in batches too, because the
    // old single-large-batch retry is precisely what resolved 0 of 41.
    // A retry failure must never fail a run that otherwise succeeded.
    const lang = jurisdiction === "United States" ? "en" : "id";
    let allFindings = judgment.findings;
    let allCaveats = judgment.coverageCaveats;
    let finalMessage = judgment.whatsappMessage;

    const firstPassCoverage = auditVerdictCoverage(
      report.regulations,
      allFindings.map((f) => f.url),
      seen.map((s) => s.url),
      lang,
      // The same regulation reaches us from two portals under two URLs. Without
      // its citation the audit calls the second copy "never checked".
      seen.map((s) => s.regulationRef ?? s.title),
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
        const missedUrls = new Set(firstPassCoverage.unaccounted.map((e) => normalizeUrlKey(e.url)));
        const validRetryFindings: typeof allFindings = [];

        for (const batch of planBatches(firstPassCoverage.unaccounted)) {
          try {
            const retryJudgment = await judge(provider, {
              customer: target.customer,
              profile: target.profile,
              jurisdiction,
              jurisdictionProfile,
              report: { ...report, regulations: batch },
              seen: retrySeen,
              lastRunAt: previousRun?.completed_at ?? null,
              memories: memoryRows,
            });
            // Only accept verdicts for entries actually in the missed set — the
            // model re-litigating something already judged does not count as
            // completing the retry.
            for (const finding of retryJudgment.findings) {
              if (missedUrls.has(normalizeUrlKey(finding.url))) validRetryFindings.push(finding);
            }
          } catch {
            // One failed retry batch must not abandon the others.
          }
        }
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
      // The same regulation reaches us from two portals under two URLs. Without
      // its citation the audit calls the second copy "never checked".
      seen.map((s) => s.regulationRef ?? s.title),
    );
    console.log(
      `[coverage] ${coverage.totalEntries} entries — ${coverage.judged} judged, ` +
      `${coverage.alreadySeen} already seen, ${coverage.unaccounted.length} unaccounted`,
    );
    let linksStored = 0;
    for (const finding of allFindings) {
      const findingId = randomUUID();
      await checked(supabase.from("findings").insert({
        id: findingId,
        check_run_id: runId,
        customer_id: customerId,
        source_id: finding.sourceId ?? null,
        regulation_ref: finding.regulationRef,
        title: finding.title,
        url: finding.url,
        enacted_on: finding.enactedOn,
        summary_id: finding.summaryId,
        summary_en: finding.summaryEn,
        relevance: finding.relevance,
        reasoning: finding.reasoning,
      }));

      // "Permendag 12/2026 is the fifth amendment to 23/2023" is the single most
      // useful fact about a finding, and lifecycle.ts has been able to read it
      // for a while — nothing ever called it, so regulation_links stayed empty
      // no matter what ran. Only worth doing for findings a person will read;
      // a `clear` verdict is not a rule anyone is tracking.
      if (finding.relevance === "flagged" || finding.relevance === "noted") {
        try {
          linksStored += (await linkRegulation(customerId, {
            id: findingId,
            title: finding.title,
            summaryEn: finding.summaryEn,
            reasoning: finding.reasoning,
            regulationRef: finding.regulationRef,
          })).length;
        } catch {
          // A missing amendment link is a lost nicety; it must not cost the run.
        }
      }
    }
    if (linksStored > 0) console.log(`[lifecycle] ${linksStored} regulation link(s) stored`);

    // "PP 20/2026 — worth a look" makes the reader do all the work: find the
    // new rule, find the old one, read both, spot the delta. Nobody does that,
    // so the alert gets skimmed. Research the difference and put it in the
    // alert instead. Only for what a person will actually read, and never at
    // the cost of the run.
    let briefingBlock = "";
    const worthBriefing = allFindings.filter(
      (f) => f.relevance === "flagged" || f.relevance === "noted",
    );
    if (worthBriefing.length > 0) {
      try {
        const briefed = await briefFindings(
          provider,
          worthBriefing.map((finding) => {
            const detected = detectRegulationLinks(
              [finding.title, finding.summaryEn, finding.reasoning].filter(Boolean).join(" "),
            )[0];
            return {
              regulationRef: finding.regulationRef,
              title: finding.title,
              url: finding.url,
              amends: detected?.targetRef ?? null,
              relation: detected?.relation ?? null,
            };
          }),
          { customer: target.customer, profile: target.profile, jurisdiction },
        );
        briefingBlock = renderBriefings(briefed, lang);
        console.log(`[briefing] ${briefed.length} of ${worthBriefing.length} finding(s) briefed`);
      } catch {
        // No briefing is a worse alert, not a failed run.
      }
    }

    const caveats = [...new Set([
      ...allCaveats,
      ...report.coverageCaveats,
      ...coverage.caveats,
    ])];
    const body = [
      finalMessage,
      briefingBlock,
      caveats.length
        ? `\n---\n${jurisdiction === "Indonesia" ? "Catatan cakupan" : "Coverage notes"}:\n${caveats.map((c) => `- ${c}`).join("\n")}`
        : "",
    ]
      .join("")
      .trim();

    await checked(supabase.from("alerts").insert({
      id: randomUUID(),
      check_run_id: runId,
      customer_id: customerId,
      finding_id: null,
      body,
      channel: "manual",
      delivery_status: "pending",
    }));

    await checked(supabase.from("check_runs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", runId));

    await refreshChecklistForCustomer(customerId, jurisdiction);

    return { runId };
  } catch (err) {
    await checked(supabase.from("check_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: err instanceof Error ? err.message : String(err),
    }).eq("id", runId));
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

/** Supabase reports write failures as values; never mark a run successful after one. */
async function checked(query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await query;
  if (error) throw new Error(`Check persistence failed: ${error.message}`);
}
