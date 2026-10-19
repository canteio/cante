import assert from "node:assert/strict";
import test from "node:test";
import type { LlmProvider, CompletionRequest } from "@/lib/llm";
import { draftStackingRules, readStackingSource } from "./stacking-authoring";
import { generatorResult, mentionsStackingInteraction, stackingProposal } from "./stacking-authoring-contract";

const citation = "https://www.federalregister.gov/documents/2026/07/20/test";
const text = "The Section 301 duty shall not apply to goods already subject to Section 232. This is the complete test legal evidence and not a live rule.";
const rule = { target_measure: "section_301_forced_labor", action: "exclude", cap_rate_percent: null,
  conditions: { section_232_matched: true }, priority: 100, rule_text: "Excluded when goods are subject to Section 232.", citation,
  effective_date: null, expires_date: null, precedence_over: null, precedence_reason: null,
  evidence_quote: "The Section 301 duty shall not apply to goods already subject to Section 232." };
function model(outputs: unknown[]) {
  const calls: CompletionRequest[] = [];
  const provider: LlmProvider = { name: "fixture", available: async () => ({ ok: true, detail: "fixture" }), complete: async req => {
    calls.push(req); const output = outputs.shift();
    if (output instanceof Error) throw output;
    return { text: JSON.stringify(output), provider: "fixture", durationMs: 1 };
  } };
  return { provider, calls };
}

test("generator and adversarial verifier are independent bounded calls; disputed drafts stay reviewable", async () => {
  const { provider, calls } = model([{ rules: [rule], reason: "Source interaction" }, { verdict: "disputed", reasoning: "Scope is incomplete." }]);
  const result = await draftStackingRules(provider, { citation, text }, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.tools), [[], []]);
  assert.match(calls[1].system, /Find unsupported claims/);
  assert.equal(result.drafts[0].verifier_verdict, "disputed");
  assert.equal((result.drafts[0] as Record<string, unknown>).tier, undefined);
});

test("invented citation or quote never reaches verification or persistence", async () => {
  for (const changed of [{ citation: "https://example.gov/invented" }, { evidence_quote: "This invented clause does not occur in the source text." }]) {
    const { provider, calls } = model([{ rules: [{ ...rule, ...changed }], reason: "test" }]);
    await assert.rejects(draftStackingRules(provider, { citation, text }, []), /citation or evidence quote/);
    assert.equal(calls.length, 1);
  }
});

test("verifier failure preserves a draft as insufficient evidence", async () => {
  const { provider } = model([{ rules: [rule], reason: "test" }, new Error("timeout")]);
  const result = await draftStackingRules(provider, { citation, text }, []);
  assert.equal(result.drafts[0].verifier_verdict, "insufficient_evidence");
});

test("no supported rule needs no verifier call", async () => {
  const { provider, calls } = model([{ rules: [], reason: "Legal scope requires unsupported shipment facts" }]);
  assert.deepEqual((await draftStackingRules(provider, { citation, text }, [])).drafts, []);
  assert.equal(calls.length, 1);
});

test("strict conditions and cap/date validation reject unsupported law-to-fact mappings", () => {
  assert.equal(stackingProposal.safeParse({ ...rule, conditions: { supplier_certified: true } }).success, false);
  assert.equal(stackingProposal.safeParse({ ...rule, action: "cap_at", cap_rate_percent: null }).success, false);
  assert.equal(stackingProposal.safeParse({ ...rule, effective_date: "2026-02-30" }).success, false);
  assert.equal(stackingProposal.safeParse({ ...rule, conditions: {} }).success, false);
});

test("nominations require multiple known measures; USMCA and Section 232 qualify", () => {
  assert.equal(mentionsStackingInteraction("Section 232 steel tariff"), false);
  assert.equal(mentionsStackingInteraction("Section 232 exclusion for USMCA"), true);
});

test("source reader rejects non-government, local and credentialed URLs before fetching", async () => {
  for (const url of ["http://www.cbp.gov/", "https://127.0.0.1/", "https://cbp.gov.example.com/", "https://user:pass@www.cbp.gov/"]) {
    await assert.rejects(readStackingSource({ url }), /government source/);
  }
});

test("source reader fails on oversized evidence instead of silently truncating law", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("x".repeat(200001), { headers: { "content-type": "text/plain" } });
  try { await assert.rejects(readStackingSource({ url: citation }), /bounded authoring size/); }
  finally { globalThis.fetch = original; }
});

test("an evidenced exclusion concern remains flagged even when no usable rule can be drafted", async () => {
  const { provider, calls } = model([{ rules: [], flagged_measures: [{ target_measure: "section_301_forced_labor", evidence_quote: rule.evidence_quote, reason: "The legal interaction needs shipment facts not yet supported." }], reason: "No computable rule" }]);
  const result = await draftStackingRules(provider, { citation, text }, []);
  assert.equal(result.drafts.length, 0);
  assert.equal(result.flags[0].target_measure, "section_301_forced_labor");
  assert.equal(calls.length, 1);
});


test("hosted-provider JSON-schema adapter can serialize the generator contract", async () => {
  const { zodToJsonSchema } = await import("@/lib/llm/json-schema");
  const schema = zodToJsonSchema(generatorResult);
  assert.equal(schema.type, "object");
  const properties = schema.properties as Record<string, { items: { type: string; required: string[] } }>;
  assert.equal(properties.rules.items.type, "object");
  assert.ok(properties.rules.items.required.includes("target_measure"));
});
