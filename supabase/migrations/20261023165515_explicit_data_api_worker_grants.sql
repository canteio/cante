begin;
-- Existing deployments already inherited these worker privileges. Make the
-- dependency explicit for resets, preview branches and new projects after the
-- October 30 Data API default change. Never grant browser/anonymous access here.
-- The corresponding CREATE TABLE migrations contain the same explicit grants.
set local lock_timeout = '3s';
grant select, insert, update, delete on
  public.customers,
  public.customer_users,
  public.customer_profiles,
  public.jurisdiction_profiles,
  public.kbli_records,
  public.sources,
  public.source_packs,
  public.check_runs,
  public.source_results,
  public.source_documents,
  public.findings,
  public.alerts,
  public.conversations,
  public.chat_messages,
  public.memories,
  public.checklist_items,
  public.products,
  public.product_classifications,
  public.suppliers,
  public.trade_lanes,
  public.supplier_documents,
  public.trade_documents,
  public.document_findings,
  public.regulation_links,
  public.product_components,
  public.substances,
  public.component_substances,
  public.restricted_substance_lists,
  public.restricted_substance_entries,
  public.finding_actions,
  public.impact_assessments,
  public.screening_results,
  public.document_chunks,
  public.tariff_impact_runs,
  public.tariff_impact_rows,
  public.tariff_monitor_candidates,
  public.tariff_impact_events
to service_role;
grant usage, select on sequence public.document_chunks_id_seq to service_role;
commit;
