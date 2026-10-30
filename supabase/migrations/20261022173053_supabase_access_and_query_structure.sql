-- Metadata-preserving access/query cleanup; no tenant or rule data is modified.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';
create index if not exists "fk_alerts_check_run_id_be4dbe6b" on "public"."alerts" (check_run_id);
create index if not exists "fk_alerts_customer_id_723175a4" on "public"."alerts" (customer_id);
create index if not exists "fk_alerts_finding_id_9a36e0d0" on "public"."alerts" (finding_id);
create index if not exists "fk_audit_batches_input_run_id_customer_id_8c2df8c3" on "public"."audit_batches" (input_run_id, customer_id);
create index if not exists "fk_audit_batches_upload_id_customer_id_b23d0586" on "public"."audit_batches" (upload_id, customer_id);
create index if not exists "fk_audit_entry_results_audit_id_customer_id_59775689" on "public"."audit_entry_results" (audit_id, customer_id);
create index if not exists "fk_audit_review_events_audit_id_customer_id_0b9b9c0f" on "public"."audit_review_events" (audit_id, customer_id);
create index if not exists "fk_chat_file_chunks_upload_id_customer_id_1993f8a8" on "public"."chat_file_chunks" (upload_id, customer_id);
create index if not exists "fk_chat_file_uploads_customer_id_c7138e70" on "public"."chat_file_uploads" (customer_id);
create index if not exists "fk_chat_messages_conversation_id_d7e8c348" on "public"."chat_messages" (conversation_id);
create index if not exists "fk_check_runs_customer_id_a1872eba" on "public"."check_runs" (customer_id);
create index if not exists "fk_checklist_items_customer_id_570bbba6" on "public"."checklist_items" (customer_id);
create index if not exists "fk_component_substances_component_id_816c3e3d" on "public"."component_substances" (component_id);
create index if not exists "fk_component_substances_substance_id_2d8b19b1" on "public"."component_substances" (substance_id);
create index if not exists "fk_component_substances_supplier_document_id_5bdecbb9" on "public"."component_substances" (supplier_document_id);
create index if not exists "fk_conversations_customer_id_4bfc815d" on "public"."conversations" (customer_id);
create index if not exists "fk_customer_profiles_customer_id_1a38d647" on "public"."customer_profiles" (customer_id);
create index if not exists "fk_document_findings_document_id_cea53867" on "public"."document_findings" (document_id);
create index if not exists "fk_document_findings_product_id_69b54e23" on "public"."document_findings" (product_id);
create index if not exists "fk_finding_actions_customer_id_e422c680" on "public"."finding_actions" (customer_id);
create index if not exists "fk_findings_check_run_id_ba9a769c" on "public"."findings" (check_run_id);
create index if not exists "fk_findings_customer_id_9d1a723c" on "public"."findings" (customer_id);
create index if not exists "fk_findings_source_id_73c104c4" on "public"."findings" (source_id);
create index if not exists "fk_impact_assessments_customer_id_ece247a6" on "public"."impact_assessments" (customer_id);
create index if not exists "fk_impact_assessments_finding_id_08f25c58" on "public"."impact_assessments" (finding_id);
create index if not exists "fk_impact_assessments_lane_id_2b1fd908" on "public"."impact_assessments" (lane_id);
create index if not exists "fk_impact_assessments_product_id_47cd23d6" on "public"."impact_assessments" (product_id);
create index if not exists "fk_kbli_records_customer_id_eae1334b" on "public"."kbli_records" (customer_id);
create index if not exists "fk_memories_supersedes_id_36e6cb46" on "public"."memories" (supersedes_id);
create index if not exists "fk_product_classifications_product_id_cea859bb" on "public"."product_classifications" (product_id);
create index if not exists "fk_product_components_parent_component_id_b9a94c0c" on "public"."product_components" (parent_component_id);
create index if not exists "fk_product_components_product_id_6c8e5523" on "public"."product_components" (product_id);
create index if not exists "fk_product_components_supplier_id_79363a8d" on "public"."product_components" (supplier_id);
create index if not exists "fk_regulation_links_customer_id_50639215" on "public"."regulation_links" (customer_id);
create index if not exists "fk_regulation_links_finding_id_465b678c" on "public"."regulation_links" (finding_id);
create index if not exists "fk_regulation_links_target_finding_id_c8ad184c" on "public"."regulation_links" (target_finding_id);
create index if not exists "fk_restricted_substance_entries_list_id_a165348d" on "public"."restricted_substance_entries" (list_id);
create index if not exists "fk_restricted_substance_entries_substance_id_81e5a466" on "public"."restricted_substance_entries" (substance_id);
create index if not exists "fk_screening_results_customer_id_9f42294b" on "public"."screening_results" (customer_id);
create index if not exists "fk_screening_results_supplier_id_bbae95ac" on "public"."screening_results" (supplier_id);
create index if not exists "fk_source_documents_source_id_b82930ab" on "public"."source_documents" (source_id);
create index if not exists "fk_source_results_check_run_id_72d0cf8d" on "public"."source_results" (check_run_id);
create index if not exists "fk_source_results_source_id_5f25ec7d" on "public"."source_results" (source_id);
create index if not exists "fk_supplier_documents_product_id_bedc324e" on "public"."supplier_documents" (product_id);
create index if not exists "fk_supplier_documents_supplier_id_ae839d83" on "public"."supplier_documents" (supplier_id);
create index if not exists "fk_suppliers_customer_id_864b7b1d" on "public"."suppliers" (customer_id);
create index if not exists "fk_tariff_check_attestations_check_id_customer_id_74318cc0" on "public"."tariff_check_attestations" (check_id, customer_id);
create index if not exists "fk_tariff_check_attestations_terminal_event_id_fa96a275" on "public"."tariff_check_attestations" (terminal_event_id);
create index if not exists "fk_tariff_check_events_check_id_customer_id_ebbdc9a5" on "public"."tariff_check_events" (check_id, customer_id);
create index if not exists "fk_tariff_impact_attestations_audit_id_customer_id_4f572ea9" on "public"."tariff_impact_attestations" (audit_id, customer_id);
create index if not exists "fk_tariff_impact_events_finding_id_fa7205cf" on "public"."tariff_impact_events" (finding_id);
create index if not exists "fk_tariff_impact_events_run_id_customer_id_c5150f87" on "public"."tariff_impact_events" (run_id, customer_id);
create index if not exists "fk_tariff_impact_rows_product_id_046ca247" on "public"."tariff_impact_rows" (product_id);
create index if not exists "fk_tariff_impact_rows_run_id_customer_id_748c2677" on "public"."tariff_impact_rows" (run_id, customer_id);
create index if not exists "fk_tariff_impact_rows_supplier_id_927898b1" on "public"."tariff_impact_rows" (supplier_id);
create index if not exists "fk_tariff_monitor_candidates_product_id_925f3b4f" on "public"."tariff_monitor_candidates" (product_id);
create index if not exists "fk_tariff_stacking_authoring_jobs_duplicate_of_fd035a80" on "public"."tariff_stacking_authoring_jobs" (duplicate_of);
create index if not exists "fk_tariff_stacking_rule_drafts_authoring_job_id_f9448dea" on "public"."tariff_stacking_rule_drafts" (authoring_job_id);
create index if not exists "fk_tariff_stacking_rule_drafts_promoted_rule_id_6ee9f2cf" on "public"."tariff_stacking_rule_drafts" (promoted_rule_id);
create index if not exists "fk_tariff_stacking_rules_precedence_over_088602fe" on "public"."tariff_stacking_rules" (precedence_over);
create index if not exists "fk_tariff_stacking_rules_superseded_by_d1995e07" on "public"."tariff_stacking_rules" (superseded_by);
create index if not exists "fk_trade_documents_customer_id_83a77d51" on "public"."trade_documents" (customer_id);
create index if not exists "fk_trade_lanes_customer_id_c5916de6" on "public"."trade_lanes" (customer_id);
create index if not exists "fk_trade_lanes_product_id_a30d6b42" on "public"."trade_lanes" (product_id);
create index if not exists "fk_trade_lanes_supplier_id_f9aed179" on "public"."trade_lanes" (supplier_id);
create policy tenant_insert on "public"."alerts" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."alerts" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."alerts" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."alerts";
alter policy "insert_audits" on "public"."audit_batches" with check (((actor_id = (select auth.uid())) AND private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])));
alter policy "insert_chat_chunks" on "public"."chat_file_chunks" with check ((private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]) AND (EXISTS ( SELECT 1
   FROM chat_file_uploads u
  WHERE ((u.id = chat_file_chunks.upload_id) AND (u.customer_id = chat_file_chunks.customer_id) AND (u.actor_id = (select auth.uid())))))));
alter policy "insert_chat_uploads" on "public"."chat_file_uploads" with check (((actor_id = (select auth.uid())) AND private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])));
create policy tenant_insert on "public"."check_runs" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."check_runs" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."check_runs" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."check_runs";
create policy tenant_insert on "public"."checklist_items" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."checklist_items" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."checklist_items" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."checklist_items";
create policy tenant_insert on "public"."conversations" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."conversations" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."conversations" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."conversations";
create policy tenant_insert on "public"."customer_profiles" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."customer_profiles" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."customer_profiles" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."customer_profiles";
drop policy "Users can view their own memberships" on "public"."customer_users";
drop policy "Members can view their customer" on "public"."customers";
create policy tenant_insert on "public"."document_chunks" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."document_chunks" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."document_chunks" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."document_chunks";
create policy tenant_insert on "public"."finding_actions" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."finding_actions" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."finding_actions" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."finding_actions";
create policy tenant_insert on "public"."findings" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."findings" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."findings" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."findings";
create policy tenant_insert on "public"."impact_assessments" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."impact_assessments" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."impact_assessments" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."impact_assessments";
create policy tenant_insert on "public"."jurisdiction_profiles" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."jurisdiction_profiles" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."jurisdiction_profiles" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."jurisdiction_profiles";
create policy tenant_insert on "public"."kbli_records" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."kbli_records" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."kbli_records" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."kbli_records";
create policy tenant_insert on "public"."memories" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."memories" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."memories" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."memories";
create policy tenant_insert on "public"."products" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."products" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."products" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."products";
create policy tenant_insert on "public"."regulation_links" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."regulation_links" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."regulation_links" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."regulation_links";
create policy tenant_insert on "public"."screening_results" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."screening_results" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."screening_results" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."screening_results";
create policy tenant_insert on "public"."source_documents" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."source_documents" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."source_documents" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."source_documents";
create policy tenant_insert on "public"."suppliers" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."suppliers" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."suppliers" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."suppliers";
alter policy "insert_check_events" on "public"."tariff_check_events" with check ((private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]) AND (actor_id = (select auth.uid())) AND ((kind = 'review'::text) OR (EXISTS ( SELECT 1
   FROM tariff_check_records r
  WHERE ((r.id = tariff_check_events.check_id) AND (r.customer_id = tariff_check_events.customer_id) AND (r.actor_id = (select auth.uid()))))))));
alter policy "insert_archive" on "public"."tariff_check_records" with check ((private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]) AND (actor_id = (select auth.uid()))));
alter policy "draft_bundles" on "public"."tariff_rule_bundles" with check (((select public.is_platform_tariff_reviewer()) AND (actor_id = (select auth.uid())) AND (status = 'draft'::text)));
alter policy "read_bundles" on "public"."tariff_rule_bundles" using (((status = 'approved'::text) OR (select public.is_platform_tariff_reviewer())));
alter policy "insert_versions" on "public"."tariff_source_versions" with check ((private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]) AND (actor_id = (select auth.uid()))));
create policy tenant_insert on "public"."trade_documents" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."trade_documents" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."trade_documents" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."trade_documents";
create policy tenant_insert on "public"."trade_lanes" for insert to authenticated with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_update on "public"."trade_lanes" for update to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text])) with check (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
create policy tenant_delete on "public"."trade_lanes" for delete to authenticated using (private.has_customer_role(customer_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]));
drop policy tenant_write on "public"."trade_lanes";
CREATE OR REPLACE FUNCTION public.review_tariff_stacking_draft(draft_id uuid, reviewer_id uuid, decision text, narrowed_conditions jsonb DEFAULT NULL::jsonb, precedence_id uuid DEFAULT NULL::uuid, precedence_basis text DEFAULT NULL::text, reviewer_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d public.tariff_stacking_rule_drafts; p jsonb; c jsonb; existing public.tariff_stacking_rules;
  rule_id uuid; k text; v jsonb; conflict_ids uuid[] := '{}'::uuid[]; start_on date; end_on date;
begin
 -- The trusted worker and authenticated wrapper must both name an appointed reviewer.
 if reviewer_id is null or not exists(select 1 from private.platform_tariff_reviewers where user_id=reviewer_id) then
  raise exception using errcode='42501', message='Platform tariff reviewer access required'; end if;
 perform pg_advisory_xact_lock(61011183153);
 select * into d from public.tariff_stacking_rule_drafts where id=draft_id for update;
 if d.id is null then raise exception 'Draft not found'; end if;
 if d.status <> 'pending' then raise exception 'Draft already reviewed'; end if;
 if decision not in ('confirm','reject') then raise exception 'Invalid review decision'; end if;
 if decision='reject' then
  update public.tariff_stacking_rule_drafts set status='rejected',reviewed_by=reviewer_id::text,reviewed_at=now(),review_note=reviewer_note where id=draft_id;
  return null;
 end if;
 if coalesce(length(trim(reviewer_note)),0)<10 then raise exception 'Record your source review and legal basis'; end if;
 p := d.proposed_rule; c := coalesce(narrowed_conditions,p->'conditions');
 if jsonb_typeof(c)<>'object' or c='{}'::jsonb then raise exception 'Supported conditions required'; end if;
 -- Review may narrow scope, never silently broaden the model's proposal.
 for k,v in select key,value from jsonb_each(p->'conditions') loop
  if not c ? k or (k='hts_prefix' and not (c->>k like (v #>> '{}') || '%'))
   or (k<>'hts_prefix' and c->k <> v) then raise exception 'Conditions may only narrow the proposed scope'; end if;
 end loop;
 for k,v in select key,value from jsonb_each(c) loop
  if k in ('section_232_matched','section_301_matched','section_338_matched','usmca_qualified','usmca_duty_free') then
   if jsonb_typeof(v)<>'boolean' then raise exception 'Boolean condition required'; end if;
  elsif k='country_of_origin' then
   if coalesce(c->>k,'') !~ '^[A-Z]{2}$' then raise exception 'ISO country required'; end if;
  elsif k='hts_prefix' then
   if coalesce(c->>k,'') !~ '^[0-9]{2,10}$' then raise exception 'Digits-only HTS prefix required'; end if;
  elsif k='section232_source_document' then
   if jsonb_typeof(v)<>'string' or length(c->>k) not between 1 and 80 then raise exception 'Source document required'; end if;
  else raise exception 'Unsupported shipment fact %',k;
  end if;
 end loop;
 if coalesce(p->>'target_measure','') !~ '^(9903\.[0-9]{2}\.[0-9]{2}|section_301_forced_labor|section_232_live)$'
  or p->>'action' not in ('include','exclude','cap_at') then raise exception 'Unsupported measure or action'; end if;
 if p->>'target_measure'='section_232_live' and not c ? 'section232_source_document' then raise exception 'Live measure needs source scope'; end if;
 start_on := (p->>'effective_date')::date; end_on := (p->>'expires_date')::date;
 if start_on is not null and end_on is not null and end_on<=start_on then raise exception 'Invalid rule date range'; end if;
 for existing in select * from public.tariff_stacking_rules where target_measure=p->>'target_measure'
  and tier in ('human','document') and superseded_by is null loop
  if coalesce(existing.effective_date,'-infinity'::date)<coalesce(end_on,'infinity'::date)
   and coalesce(start_on,'-infinity'::date)<coalesce(existing.expires_date,'infinity'::date)
   and private.stacking_conditions_overlap(existing.conditions,c) then
    conflict_ids := array_append(conflict_ids,existing.id);
  end if;
 end loop;
 if cardinality(conflict_ids)>1 then raise exception 'Multiple overlapping confirmed rules: narrow conditions before promotion'; end if;
 if cardinality(conflict_ids)=1 and (precedence_id is distinct from conflict_ids[1] or coalesce(length(trim(precedence_basis)),0)<10) then
  raise exception 'Overlapping confirmed rule % requires explicit precedence and a legal basis, or narrower conditions',conflict_ids[1];
 end if;
 if precedence_id is not null and not (precedence_id=any(conflict_ids)) then raise exception 'Precedence must name the overlapping confirmed rule'; end if;
 insert into public.tariff_stacking_rules(target_measure,action,cap_rate_percent,conditions,priority,rule_text,embedding,citation,effective_date,expires_date,tier,confirmed_by,precedence_over,precedence_reason)
 values(p->>'target_measure',p->>'action',(p->>'cap_rate_percent')::numeric,c,(p->>'priority')::integer,p->>'rule_text',d.embedding,p->>'citation',start_on,end_on,'human',reviewer_id::text,precedence_id,precedence_basis) returning id into rule_id;
 update public.tariff_stacking_rule_drafts set status='promoted',reviewed_by=reviewer_id::text,reviewed_at=now(),review_note=reviewer_note,promoted_rule_id=rule_id where id=draft_id;
 return rule_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_tariff_check(target_check_id uuid, target_customer_id uuid, report_text text, sources jsonb, outcome text DEFAULT 'completed'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s jsonb; version_id uuid; actual_hash text; event_id uuid; refs jsonb:='[]'::jsonb; bytes bigint:=0; final_payload text;
begin
 if outcome not in ('completed','failed') then raise exception 'Invalid check outcome'; end if;
 if auth.uid() is null or not private.has_customer_role(target_customer_id,array['owner','admin','member']) then raise exception 'Write access required'; end if;
 if not exists(select 1 from public.tariff_check_records where id=target_check_id and customer_id=target_customer_id and actor_id=auth.uid()) then raise exception 'Check not found'; end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_check_id::text,0));
 if exists(select 1 from public.tariff_check_events where check_id=target_check_id and kind in ('completed','failed')) then raise exception 'Check already finished'; end if;
 if jsonb_typeof(report_text::jsonb)<>'object' or octet_length(report_text)>12000000 or jsonb_typeof(sources)<>'array' or jsonb_array_length(sources)>500 then raise exception 'Invalid evidence package'; end if;
 for s in select value from jsonb_array_elements(sources) loop
   version_id:=null;
   if s->>'body' is not null then
     bytes:=bytes+octet_length(s->>'body'); if bytes>32000000 then raise exception 'Evidence capture exceeds archive limit'; end if;
     actual_hash:=encode(extensions.digest(case when coalesce(s->>'bodyEncoding','utf8')='base64' then decode(s->>'body','base64') else convert_to(s->>'body','UTF8') end,'sha256'),'hex');
     if actual_hash is distinct from s->>'sha256' then raise exception 'Source hash mismatch'; end if;
     insert into public.tariff_source_versions(customer_id,url,encoding,body,compression,original_sha256) values(target_customer_id,s->>'url',coalesce(s->>'bodyEncoding','utf8'),s->>'body',s->>'compression',s->>'originalSha256') on conflict(customer_id,url,sha256) do nothing;
     select id into version_id from public.tariff_source_versions where customer_id=target_customer_id and url=s->>'url' and sha256=actual_hash;
     if version_id is null then raise exception 'Source version not retained'; end if;
   end if;
   refs:=refs||jsonb_build_array((s-'body')||jsonb_build_object('versionId',version_id));
 end loop;
 final_payload:=jsonb_build_object('report',report_text::jsonb,'sources',refs)::text;
 insert into public.tariff_check_events(customer_id,check_id,kind,payload_text) values(target_customer_id,target_check_id,outcome,final_payload) returning id into event_id;
 return event_id;
end;
$function$
;
revoke all on function public.review_section232_proposal(target_document_number text, decision text, reviewer text, note text) from public, anon, authenticated;
grant execute on function public.review_section232_proposal(target_document_number text, decision text, reviewer text, note text) to service_role;
revoke all on function public.auto_approve_section232_proposal(target_document_number text, note text) from public, anon, authenticated;
grant execute on function public.auto_approve_section232_proposal(target_document_number text, note text) to service_role;
revoke all on function public.pending_section232_proposals() from public, anon, authenticated;
grant execute on function public.pending_section232_proposals() to service_role;
commit;
