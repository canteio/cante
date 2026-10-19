-- Project Mission One, phase 1 (see MISSION_ONE_PLAN.md).
--
-- Stacking-exclusion rules: AI drafts them once per regulation (not
-- implemented in this migration — see tariff_stacking_rule_drafts below,
-- currently populated only by hand), a human confirms them, and
-- lib/tariff/stacking-rules.ts applies confirmed rules deterministically at
-- shipment time, with zero model calls in that path. Public reference data,
-- like hts_schedule_embeddings and section232_tariff_rows — tariff law
-- isn't tenant-specific, so no RLS, just read/write grants.

create table public.tariff_stacking_rules (
  id uuid primary key default gen_random_uuid(),
  target_measure text not null,
  action text not null check (action in ('exclude', 'include', 'cap_at')),
  cap_rate_percent numeric check (cap_rate_percent is null or (cap_rate_percent >= 0 and cap_rate_percent <= 1)),
  conditions jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  rule_text text not null,
  embedding extensions.vector(384),
  citation text not null,
  effective_date date,
  expires_date date,
  tier text not null check (tier in ('lead', 'human', 'document')),
  confirmed_by text,
  superseded_by uuid references public.tariff_stacking_rules(id),
  precedence_over uuid references public.tariff_stacking_rules(id),
  precedence_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint confirmed_rules_need_a_reviewer check (tier = 'lead' or confirmed_by is not null),
  constraint cap_action_needs_a_rate check (action <> 'cap_at' or cap_rate_percent is not null),
  constraint precedence_needs_a_reason check (precedence_over is null or precedence_reason is not null)
);

create index tariff_stacking_rules_measure_idx
  on public.tariff_stacking_rules(target_measure) where superseded_by is null;
create index tariff_stacking_rules_hnsw_idx on public.tariff_stacking_rules
  using hnsw (embedding extensions.vector_cosine_ops);

revoke all on public.tariff_stacking_rules from public, anon, authenticated;
grant select on public.tariff_stacking_rules to anon, authenticated;
grant all on public.tariff_stacking_rules to service_role;

-- Where an AI-authored rule proposal (generator pass + verifier pass, see
-- MISSION_ONE_PLAN.md section 5) lands before a human reviews it. Kept
-- structurally separate from tariff_stacking_rules so a draft can never be
-- read by the deterministic application path by construction, not by a
-- filter someone could forget. Not yet populated by any pipeline in this
-- migration -- phase 1 enters confirmed rules directly, by hand.
create table public.tariff_stacking_rule_drafts (
  id uuid primary key default gen_random_uuid(),
  source_finding_id uuid,
  proposed_rule jsonb not null,
  verifier_verdict text check (verifier_verdict in ('confirmed', 'disputed', 'insufficient_evidence')),
  verifier_reasoning text,
  reviewed_by text,
  reviewed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'promoted', 'rejected')),
  created_at timestamptz not null default now()
);

revoke all on public.tariff_stacking_rule_drafts from public, anon, authenticated;
grant all on public.tariff_stacking_rule_drafts to service_role;

-- Phase 1's two named proof cases (MISSION_ONE_PLAN.md section 7), entered
-- directly at tier='human' as the plan specifies for this first pass.
--
-- Real, currently-withheld case: the Sept 15, 2026 amendment (FR doc
-- 2026-18838, cited in lib/tariff/section338.ts) permits the Section 338
-- Canada alcohol basket (9903.03.12) to stack additively with an
-- already-matched Section 232 measure, instead of being excluded by it (the
-- general Section 232/338 exclusion rule). stack.ts currently withholds
-- this component and the shipment's aggregate total because it has no
-- verified computation for the combination -- this rule is that
-- verification, letting lib/tariff/stacking-rules.ts resolve it
-- deterministically.
insert into public.tariff_stacking_rules
  (target_measure, action, conditions, priority, rule_text, citation, effective_date, tier, confirmed_by)
values (
  '9903.03.12',
  'include',
  '{"section_232_matched": true}'::jsonb,
  100,
  'The Section 338 Canada alcoholic-beverages basket (9903.03.12) stacks additively on top of an already-matched Section 232 steel/aluminum/auto measure, rather than being excluded by it -- a specific carve-out from the general Section 232/338 mutual-exclusion rule.',
  'Presidential Proclamation, amendment (Sept. 15, 2026), FR doc 2026-18838',
  '2026-09-15',
  'human',
  'operator (Project Mission One phase 1, entered by hand per MISSION_ONE_PLAN.md)'
);
