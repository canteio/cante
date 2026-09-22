-- Cante production schema for Supabase Postgres.
-- Includes tenant tables for a fresh project bootstrap.

create extension if not exists vector with schema extensions;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  country text,
  city text,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_users (
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (customer_id, user_id)
);

create index if not exists customer_users_user_id_idx
  on public.customer_users(user_id);

alter table public.customers add column if not exists country text;
alter table public.customers add column if not exists city text;

create table if not exists public.customer_profiles (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_description text not null,
  business_type text,
  side_of_trade text not null default 'export',
  hs_codes jsonb not null default '[]'::jsonb,
  kbli_codes jsonb not null default '[]'::jsonb,
  destination_markets jsonb not null default '[]'::jsonb,
  hs_codes_confirmed boolean not null default false,
  destinations_confirmed boolean not null default false,
  relevance_guidance jsonb not null default '{}'::jsonb
);

create table if not exists public.jurisdiction_profiles (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  country text not null,
  legal_name text,
  facility_addresses jsonb not null default '[]'::jsonb,
  naics_codes jsonb not null default '[]'::jsonb,
  products jsonb not null default '[]'::jsonb,
  skus jsonb not null default '[]'::jsonb,
  materials_chemicals jsonb not null default '[]'::jsonb,
  manufacturing_processes jsonb not null default '[]'::jsonb,
  waste_streams jsonb not null default '[]'::jsonb,
  distribution_states jsonb not null default '[]'::jsonb,
  labels_claims jsonb not null default '[]'::jsonb,
  hts_schedule_b_codes jsonb not null default '[]'::jsonb,
  export_classifications jsonb not null default '[]'::jsonb,
  export_countries jsonb not null default '[]'::jsonb,
  regulated_product_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, country)
);

create table if not exists public.kbli_records (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  code text not null,
  version text not null default 'unknown',
  title text,
  risk_level text,
  oss_license_type text,
  required_certificates jsonb not null default '[]'::jsonb,
  sector_ministry text,
  source text,
  status text not null default 'unconfirmed',
  confirmed boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sources (
  id text primary key,
  country text not null,
  name text not null,
  domain text not null,
  url text not null,
  regulation_type text not null,
  reliability_status text not null default 'untested',
  view text,
  notes text,
  last_success_at timestamptz
);

create table if not exists public.source_packs (
  id text primary key,
  country text not null,
  jurisdiction text not null default 'national',
  name text not null,
  category text not null,
  status text not null default 'planned',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.check_runs (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  jurisdiction text not null default 'United States',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  error_message text
);

create table if not exists public.source_results (
  id text primary key,
  check_run_id text not null references public.check_runs(id) on delete cascade,
  source_id text not null references public.sources(id),
  success boolean not null,
  error_message text,
  entries_parsed integer not null default 0,
  parse_warning text,
  raw_content_path text,
  fetched_at timestamptz not null default now()
);

create table if not exists public.source_documents (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  jurisdiction text not null default 'United States',
  source_id text not null references public.sources(id),
  identity text not null,
  content_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  unique (customer_id, jurisdiction, source_id, identity)
);

create table if not exists public.findings (
  id text primary key,
  check_run_id text not null references public.check_runs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_id text references public.sources(id),
  regulation_ref text,
  title text not null,
  url text,
  enacted_on date,
  summary_id text,
  summary_en text,
  relevance text not null,
  reasoning text,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id text primary key,
  finding_id text references public.findings(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  check_run_id text references public.check_runs(id) on delete cascade,
  body text not null,
  channel text not null default 'manual',
  delivery_status text not null default 'pending',
  delivered_at timestamptz,
  delivery_error text,
  delivery_attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  jurisdiction text not null default 'United States',
  title text not null default 'New chat',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id text primary key,
  conversation_id text not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'agent')),
  content text not null,
  activity jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memories (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  jurisdiction text not null default 'United States',
  kind text not null default 'other',
  content text not null,
  source text,
  origin text not null default 'manual',
  confirmed boolean not null default false,
  status text not null default 'active' check (status in ('active', 'disputed', 'superseded')),
  valid_from date,
  valid_to date,
  supersedes_id text references public.memories(id) on delete set null,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_customer_jurisdiction_idx
  on public.memories(customer_id, jurisdiction, confirmed, created_at desc);
create index if not exists memories_content_fts_idx
  on public.memories using gin (to_tsvector('simple', content));

create table if not exists public.checklist_items (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  jurisdiction text not null default 'United States',
  key text,
  title text not null,
  category text not null default 'other',
  status text not null default 'unknown',
  priority text not null default 'medium',
  why_applies text,
  linked_facts jsonb not null default '[]'::jsonb,
  linked_rules jsonb not null default '[]'::jsonb,
  evidence_required text,
  owner text not null default 'user',
  due_at timestamptz,
  last_checked_at timestamptz,
  source_health text not null default 'not_checked',
  confidence text not null default 'lead',
  open_questions jsonb not null default '[]'::jsonb,
  origin text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  sku text not null,
  name text not null,
  description text,
  materials jsonb not null default '[]'::jsonb,
  origin_country text,
  unit_of_measure text,
  unit_value double precision,
  currency text not null default 'USD',
  product_class text not null default 'unknown',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, sku)
);

create table if not exists public.product_classifications (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade,
  system text not null,
  jurisdiction text,
  code text not null,
  tier text not null default 'lead',
  basis text not null,
  supporting_refs jsonb not null default '[]'::jsonb,
  rationale text,
  status text not null default 'proposed',
  approved_by text,
  approved_at timestamptz,
  superseded_at timestamptz,
  superseded_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  country text,
  address text,
  contact_email text,
  role text not null default 'supplier',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_lanes (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  direction text not null default 'export',
  origin_country text not null,
  destination_country text not null,
  transit_countries jsonb not null default '[]'::jsonb,
  supplier_id text references public.suppliers(id) on delete set null,
  broker_name text,
  broker_contact text,
  incoterm text,
  shipment_frequency text not null default 'unknown',
  annual_shipments integer,
  annual_value double precision,
  annual_volume double precision,
  volume_unit text,
  currency text not null default 'USD',
  next_shipment_at timestamptz,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_documents (
  id text primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  doc_type text not null,
  status text not null default 'not_requested',
  requested_at timestamptz,
  received_at timestamptz,
  expires_at timestamptz,
  file_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_documents (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  doc_type text not null,
  filename text not null,
  document_number text,
  document_date date,
  parse_status text not null default 'unparsed',
  parse_note text,
  extracted jsonb,
  raw_text text,
  storage_path text,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.document_findings (
  id text primary key,
  document_id text not null references public.trade_documents(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  kind text not null,
  severity text not null default 'medium',
  message text not null,
  document_value text,
  expected_value text,
  expectation_tier text not null default 'lead',
  status text not null default 'open',
  duty_difference double precision,
  duty_currency text not null default 'USD',
  duty_basis jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.regulation_links (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  finding_id text not null references public.findings(id) on delete cascade,
  relation text not null,
  target_ref text not null,
  target_finding_id text references public.findings(id) on delete set null,
  evidence text,
  confidence text not null default 'inferred',
  created_at timestamptz not null default now()
);

create table if not exists public.product_components (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade,
  parent_component_id text references public.product_components(id) on delete cascade,
  name text not null,
  part_number text,
  supplier_id text references public.suppliers(id) on delete set null,
  quantity double precision,
  unit text,
  mass_grams double precision,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.substances (
  id text primary key,
  name text not null,
  cas_number text unique,
  ec_number text,
  synonyms jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.component_substances (
  id text primary key,
  component_id text not null references public.product_components(id) on delete cascade,
  substance_id text not null references public.substances(id),
  concentration_ppm double precision,
  tier text not null default 'lead',
  basis text not null,
  supplier_document_id text references public.supplier_documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.restricted_substance_lists (
  id text primary key,
  name text not null,
  jurisdiction text not null,
  authority text,
  version text,
  source_url text,
  captured_at timestamptz not null default now()
);

create table if not exists public.restricted_substance_entries (
  id text primary key,
  list_id text not null references public.restricted_substance_lists(id) on delete cascade,
  substance_id text not null references public.substances(id),
  threshold_ppm double precision,
  restriction text not null default 'restricted',
  effective_on date,
  citation text
);

create table if not exists public.finding_actions (
  id text primary key,
  finding_id text not null references public.findings(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  state text not null default 'new',
  assignee text,
  forwarded_to text,
  due_at timestamptz,
  broker_decision text,
  broker_decided_at timestamptz,
  note text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (finding_id)
);

create table if not exists public.impact_assessments (
  id text primary key,
  finding_id text not null references public.findings(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  lane_id text references public.trade_lanes(id) on delete set null,
  match_reason text not null,
  match_kind text not null,
  effective_on date,
  next_affected_shipment_at timestamptz,
  duty_rate_before double precision,
  duty_rate_after double precision,
  estimated_annual_exposure double precision,
  estimated_monthly_exposure double precision,
  annual_duty_at_risk double precision,
  currency text not null default 'USD',
  delay_risk text not null default 'none',
  basis jsonb not null default '[]'::jsonb,
  confidence text not null default 'indicative',
  tariff_code text,
  tariff_basis text,
  direction text not null default 'unknown',
  created_at timestamptz not null default now()
);

create table if not exists public.screening_results (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  supplier_id text references public.suppliers(id) on delete set null,
  screened_name text not null,
  provider text not null default 'csl',
  outcome text not null,
  match_count integer not null default 0,
  matches jsonb not null default '[]'::jsonb,
  error_message text,
  list_version text,
  screened_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  document_id text references public.trade_documents(id) on delete cascade,
  jurisdiction text not null,
  chunk_index integer not null,
  page_number integer,
  heading text,
  content text not null,
  content_hash text not null,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists document_chunks_customer_jurisdiction_idx
  on public.document_chunks(customer_id, jurisdiction);
create index if not exists document_chunks_content_fts_idx
  on public.document_chunks using gin (to_tsvector('simple', content));
create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_customer_member(target_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.customer_users cu
    where cu.customer_id = target_customer_id
      and cu.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_customer_member(uuid) from public;
grant execute on function private.is_customer_member(uuid) to authenticated;

create or replace function private.has_customer_role(
  target_customer_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.customer_users cu
    where cu.customer_id = target_customer_id
      and cu.user_id = (select auth.uid())
      and cu.role = any(allowed_roles)
  );
$$;

revoke all on function private.has_customer_role(uuid, text[]) from public;
grant execute on function private.has_customer_role(uuid, text[]) to authenticated;

-- Directly customer-owned tables share the same read/write policy.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customer_profiles', 'jurisdiction_profiles', 'kbli_records', 'check_runs',
    'source_documents', 'findings', 'alerts', 'conversations', 'memories',
    'checklist_items', 'products', 'suppliers', 'trade_lanes', 'trade_documents',
    'regulation_links', 'finding_actions', 'impact_assessments', 'screening_results',
    'document_chunks'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists tenant_read on public.%I', table_name);
    execute format('drop policy if exists tenant_write on public.%I', table_name);
    execute format(
      'create policy tenant_read on public.%I for select to authenticated using (private.is_customer_member(customer_id))',
      table_name
    );
    execute format(
      'create policy tenant_write on public.%I for all to authenticated using (private.has_customer_role(customer_id, array[''owner'',''admin'',''member''])) with check (private.has_customer_role(customer_id, array[''owner'',''admin'',''member'']))',
      table_name
    );
  end loop;
end $$;

-- Global reference data is readable, but only the trusted worker may write it.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sources', 'source_packs', 'substances', 'restricted_substance_lists',
    'restricted_substance_entries'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('drop policy if exists authenticated_read on public.%I', table_name);
    execute format(
      'create policy authenticated_read on public.%I for select to authenticated using (true)',
      table_name
    );
  end loop;
end $$;

-- Indirect ownership helpers keep child rows behind their parent's tenant.
alter table public.source_results enable row level security;
alter table public.chat_messages enable row level security;
alter table public.product_classifications enable row level security;
alter table public.supplier_documents enable row level security;
alter table public.document_findings enable row level security;
alter table public.product_components enable row level security;
alter table public.component_substances enable row level security;

revoke all on public.source_results, public.chat_messages,
  public.product_classifications, public.supplier_documents,
  public.document_findings, public.product_components,
  public.component_substances from anon, authenticated;
grant select, insert, update, delete on public.source_results, public.chat_messages,
  public.product_classifications, public.supplier_documents,
  public.document_findings, public.product_components,
  public.component_substances to authenticated;

drop policy if exists tenant_access on public.source_results;
create policy tenant_access on public.source_results for all to authenticated
using (exists (
  select 1 from public.check_runs r
  where r.id = check_run_id and private.is_customer_member(r.customer_id)
))
with check (exists (
  select 1 from public.check_runs r
  where r.id = check_run_id
    and private.has_customer_role(r.customer_id, array['owner','admin','member'])
));

drop policy if exists tenant_access on public.chat_messages;
create policy tenant_access on public.chat_messages for all to authenticated
using (exists (
  select 1 from public.conversations c
  where c.id = conversation_id and private.is_customer_member(c.customer_id)
))
with check (exists (
  select 1 from public.conversations c
  where c.id = conversation_id
    and private.has_customer_role(c.customer_id, array['owner','admin','member'])
));

drop policy if exists tenant_access on public.product_classifications;
create policy tenant_access on public.product_classifications for all to authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_id and private.is_customer_member(p.customer_id)
))
with check (exists (
  select 1 from public.products p
  where p.id = product_id
    and private.has_customer_role(p.customer_id, array['owner','admin','member'])
));

drop policy if exists tenant_access on public.supplier_documents;
create policy tenant_access on public.supplier_documents for all to authenticated
using (exists (
  select 1 from public.suppliers s
  where s.id = supplier_id and private.is_customer_member(s.customer_id)
))
with check (exists (
  select 1 from public.suppliers s
  where s.id = supplier_id
    and private.has_customer_role(s.customer_id, array['owner','admin','member'])
));

drop policy if exists tenant_access on public.document_findings;
create policy tenant_access on public.document_findings for all to authenticated
using (exists (
  select 1 from public.trade_documents d
  where d.id = document_id and private.is_customer_member(d.customer_id)
))
with check (exists (
  select 1 from public.trade_documents d
  where d.id = document_id
    and private.has_customer_role(d.customer_id, array['owner','admin','member'])
));

drop policy if exists tenant_access on public.product_components;
create policy tenant_access on public.product_components for all to authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_id and private.is_customer_member(p.customer_id)
))
with check (exists (
  select 1 from public.products p
  where p.id = product_id
    and private.has_customer_role(p.customer_id, array['owner','admin','member'])
));

drop policy if exists tenant_access on public.component_substances;
create policy tenant_access on public.component_substances for all to authenticated
using (exists (
  select 1
  from public.product_components pc
  join public.products p on p.id = pc.product_id
  where pc.id = component_id and private.is_customer_member(p.customer_id)
))
with check (exists (
  select 1
  from public.product_components pc
  join public.products p on p.id = pc.product_id
  where pc.id = component_id
    and private.has_customer_role(p.customer_id, array['owner','admin','member'])
));

-- Customer and membership tables remain read-only from the browser.
alter table public.customers enable row level security;
alter table public.customer_users enable row level security;
revoke all on public.customers, public.customer_users from anon, authenticated;
grant select on public.customers, public.customer_users to authenticated;

drop policy if exists tenant_customer_read on public.customers;
create policy tenant_customer_read on public.customers for select to authenticated
using (private.is_customer_member(id));

drop policy if exists own_membership_read on public.customer_users;
create policy own_membership_read on public.customer_users for select to authenticated
using (user_id = (select auth.uid()));

-- Hybrid retrieval used by the server before an LLM call. It never crosses tenants.
create or replace function public.match_cante_context(
  query_embedding extensions.vector(384),
  target_customer_id uuid,
  target_jurisdiction text,
  match_count integer default 10
)
returns table (
  id bigint,
  document_id text,
  page_number integer,
  heading text,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    dc.id,
    dc.document_id,
    dc.page_number,
    dc.heading,
    dc.content,
    1 - (dc.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.document_chunks dc
  where dc.customer_id = target_customer_id
    and dc.jurisdiction = target_jurisdiction
    and dc.embedding is not null
    and private.is_customer_member(dc.customer_id)
  order by dc.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 30);
$$;

revoke all on function public.match_cante_context(extensions.vector, uuid, text, integer) from public;
grant execute on function public.match_cante_context(extensions.vector, uuid, text, integer)
  to authenticated;

create or replace function public.search_cante_context(
  query_text text,
  target_customer_id uuid,
  target_jurisdiction text,
  match_count integer default 10
)
returns table (
  id bigint,
  document_id text,
  page_number integer,
  heading text,
  content text,
  rank real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    dc.id,
    dc.document_id,
    dc.page_number,
    dc.heading,
    dc.content,
    ts_rank_cd(to_tsvector('simple', dc.content), websearch_to_tsquery('simple', query_text))
  from public.document_chunks dc
  where dc.customer_id = target_customer_id
    and dc.jurisdiction = target_jurisdiction
    and private.is_customer_member(dc.customer_id)
    and to_tsvector('simple', dc.content) @@ websearch_to_tsquery('simple', query_text)
  order by 6 desc
  limit least(greatest(match_count, 1), 30);
$$;

revoke all on function public.search_cante_context(text, uuid, text, integer) from public;
grant execute on function public.search_cante_context(text, uuid, text, integer)
  to authenticated;

grant usage, select on sequence public.document_chunks_id_seq to authenticated;
