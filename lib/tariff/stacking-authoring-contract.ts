import { z } from "zod";
import { isStrictIsoDate } from "@/lib/tariff/date";

export const stackingTarget = z.string().regex(/^(9903\.\d{2}\.\d{2}|section_301_forced_labor|section_232_live)$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const stackingConditions = z.object({
  section_232_matched: z.boolean().optional(),
  section_301_matched: z.boolean().optional(),
  section_338_matched: z.boolean().optional(),
  usmca_qualified: z.boolean().optional(),
  usmca_duty_free: z.boolean().optional(),
  country_of_origin: z.string().regex(/^[A-Z]{2}$/).optional(),
  hts_prefix: z.string().regex(/^\d{2,10}$/).optional(),
  section232_source_document: z.string().max(80).optional(),
}).strict();

export const stackingProposalShape = z.object({
  target_measure: stackingTarget,
  action: z.enum(["include", "exclude", "cap_at"]),
  cap_rate_percent: z.number().finite().min(0).max(1).nullable(),
  conditions: stackingConditions,
  priority: z.number().int().min(0).max(10000),
  rule_text: z.string().trim().min(10).max(2000),
  citation: z.string().url(),
  effective_date: date,
  expires_date: date,
  precedence_over: z.string().uuid().nullable(),
  precedence_reason: z.string().trim().min(10).max(2000).nullable(),
  evidence_quote: z.string().trim().min(20).max(4000),
}).strict();

// The hosted adapter handles plain shapes; strict semantic checks run after
// generation rather than passing unsupported ZodEffects to that adapter.
export const stackingProposal = stackingProposalShape.superRefine((rule, ctx) => {
  for (const value of [rule.effective_date, rule.expires_date]) {
    if (value !== null && !isStrictIsoDate(value)) ctx.addIssue({ code: "custom", message: "Use a real ISO date" });
  }
  if ((rule.action === "cap_at") !== (rule.cap_rate_percent !== null)) ctx.addIssue({ code: "custom", message: "Only cap_at has a cap rate" });
  if (rule.precedence_over && !rule.precedence_reason) ctx.addIssue({ code: "custom", message: "Precedence needs a legal reason" });
  if (rule.effective_date && rule.expires_date && rule.expires_date <= rule.effective_date) ctx.addIssue({ code: "custom", message: "Expiry must follow effective date" });
  if (!Object.keys(rule.conditions).length) ctx.addIssue({ code: "custom", message: "State at least one supported condition" });
});
export type StackingProposal = z.infer<typeof stackingProposal>;
export const generatorResult = z.object({
  rules: z.array(stackingProposalShape).max(6),
  flagged_measures: z.array(z.object({ target_measure: stackingTarget, evidence_quote: z.string().min(20).max(4000), reason: z.string().min(10).max(2000) }).strict()).max(12).default([]),
  reason: z.string().min(1).max(2000),
});
export const verifierResult = z.object({
  verdict: z.enum(["confirmed", "disputed", "insufficient_evidence"]),
  reasoning: z.string().min(1).max(3000),
});

/** Only a nomination: the source text, not a finding summary, supplies evidence. */
export function mentionsStackingInteraction(text: string): boolean {
  const measures = [/section\s*301/i, /section\s*232/i, /section\s*338/i, /USMCA/i, /UFLPA/i, /\bAD\/CVD\b|antidumping|countervailing/i];
  return measures.filter(pattern => pattern.test(text)).length >= 2;
}

export function evidenceIsVerbatim(quote: string, source: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  return normalize(source).includes(normalize(quote));
}
