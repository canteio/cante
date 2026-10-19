/** Prepare source-backed reference drafts for the pilot scenarios, never customer data or confirmed law. */
import "./load-env";
import { createHash } from "node:crypto";
import { createServiceClient } from "../lib/supabase/service";
import { getProvider } from "../lib/llm";
import { draftStackingRules, readStackingSource } from "../lib/tariff/stacking-authoring";

async function main() {
  if (process.env.CANTE_LLM !== "api") throw new Error("Explicit CANTE_LLM=api is required.");
  const citation = "https://www.govinfo.gov/content/pkg/FR-2026-07-28/html/2026-15181.htm";
  const signal = AbortSignal.timeout(110_000);
  const text = await readStackingSource({ url: citation }, signal);
  // Deliberately bounded legal scope, not a silently truncated document.
  // The complete fetched source is still stored for verbatim database checks.
  const start = text.indexOf("(f) As provided in heading 9903.05.90");
  const end = text.indexOf("(i) As provided in heading 9903.05.95", start);
  const datesStart = text.indexOf("DATES:");
  const datesEnd = text.indexOf("FOR FURTHER INFORMATION CONTACT", datesStart);
  if (start < 0 || end <= start || datesStart < 0 || datesEnd <= datesStart) throw new Error("Official passage boundaries were not found; do not guess.");
  const excerpt = text.slice(datesStart, datesEnd) + "\n" + text.slice(start, end);
  const sourceDrafts = process.argv.includes("--prepare-source-drafts");
  const source_key = createHash("sha256").update((sourceDrafts ? "source-drafts-v1\n" : "pilot-exclusions-scope-v1\n") + citation + "\n" + excerpt).digest("hex");
  const db = createServiceClient();
  const prior = await db.from("tariff_stacking_authoring_jobs").select("id,status,detail").eq("source_key", source_key).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) { console.log(JSON.stringify({ reused: true, ...prior.data })); return; }
  const job = await db.from("tariff_stacking_authoring_jobs").insert({ citation, source_text: text, source_key, status: "running", started_at: new Date().toISOString(), detail: "Preparing official-source drafts for the pilot; no human approval implied." }).select("id").single();
  if (job.error) throw job.error;
  try {
    const result = sourceDrafts ? {
      reason: "Source-backed proposals for the two USMCA duty-free exclusions. Independent hosted verification timed out; human source review is required. No Section 232 exemption is drafted because the engine does not supply the exact exemption-heading fact.",
      flags: [],
      drafts: ["CA", "MX"].map((country, index) => {
        const beginning = text.indexOf(index === 0 ? "(g) As provided in heading 9903.05.93" : "(h) As provided in heading 9903.05.94");
        const finish = text.indexOf(index === 0 ? "(h) As provided in heading 9903.05.94" : "(i) As provided in heading 9903.05.95", beginning);
        if (beginning < 0 || finish <= beginning || !excerpt.includes("July 24, 2026")) throw new Error("Operative evidence unavailable");
        return { proposed_rule: {
          target_measure: "section_301_forced_labor", action: "exclude", cap_rate_percent: null,
          conditions: { country_of_origin: country, usmca_duty_free: true }, priority: 100,
          rule_text: `Exclude the Section 301 forced-labor duty for ${country === "CA" ? "Canadian" : "Mexican"} products entered free of duty under USMCA; qualification must be explicitly reviewed and the published special base rate must be free.`,
          citation, effective_date: "2026-07-24", expires_date: null, precedence_over: null, precedence_reason: null,
          evidence_quote: text.slice(beginning, finish).trim(),
        }, verifier_verdict: "insufficient_evidence", verifier_reasoning: "Prepared directly from the operative official passage. The independent hosted verifier did not complete. A named human must review the source, scope and date before approval." };
      }),
    } : await draftStackingRules(getProvider("api"), { citation, text: "Bounded scope: only the dates and operative U.S. note 52 (f)-(h) passages below. No assertion of complete document coverage.\n" + excerpt }, [], signal);
    const saved = await db.rpc("store_tariff_stacking_drafts", { job_id: job.data.id, finding_id: null, drafts: result.drafts.map(draft => ({ ...draft, embedding: null })), detail: result.reason + " Prepared from official text; named human review remains required.", flagged_measures: result.flags });
    if (saved.error) throw saved.error;
    console.log(JSON.stringify({ job: job.data.id, drafts: result.drafts.map(draft => ({ target: draft.proposed_rule.target_measure, conditions: draft.proposed_rule.conditions, verifier: draft.verifier_verdict })), flags: result.flags.map(flag => flag.target_measure), promoted: 0 }));
  } catch (error) {
    await db.from("tariff_stacking_authoring_jobs").update({ status: "failed", detail: error instanceof Error ? error.message : "Authoring failed", completed_at: new Date().toISOString() }).eq("id", job.data.id);
    throw error;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Preparation failed"); process.exitCode = 1; });
