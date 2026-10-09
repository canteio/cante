-- PostgREST reads function configuration before starting the statement timer.
-- SET LOCAL inside the body cannot extend that already-running timer.
-- This service-only RPC atomically publishes a full chapter, including chapter 99.
alter function public.publish_hts_chapter(text,text,jsonb) set statement_timeout = '55s';
notify pgrst, 'reload schema';
