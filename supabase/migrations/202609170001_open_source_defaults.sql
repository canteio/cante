-- Remove the original pilot jurisdiction assumption from existing deployments.
-- The base schema now uses the same defaults for fresh projects; these ALTERs
-- are required because CREATE TABLE IF NOT EXISTS does not update an existing
-- column default when an old migration is edited.

alter table public.check_runs
  alter column jurisdiction set default 'United States';

alter table public.source_documents
  alter column jurisdiction set default 'United States';

alter table public.conversations
  alter column jurisdiction set default 'United States';

alter table public.memories
  alter column jurisdiction set default 'United States';

alter table public.checklist_items
  alter column jurisdiction set default 'United States';
