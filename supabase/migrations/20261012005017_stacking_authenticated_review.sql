-- Hosted admin review uses the caller's verified JWT. Never put the worker
-- service key in Vercel or let a caller choose a reviewer identity.
create function public.read_tariff_stacking_reviews(review_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pending jsonb; reviewed jsonb; rules jsonb; jobs jsonb; total integer;
begin
 if auth.uid() is null or not exists(select 1 from public.customer_users where user_id=auth.uid() and role in ('owner','admin')) then
  raise exception 'Owner or admin access required'; end if;
 if review_offset<0 or review_offset>1000000 then raise exception 'Invalid review offset'; end if;
 select count(*) into total from public.tariff_stacking_rule_drafts where status='pending';
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into pending from (
  select id,proposed_rule,verifier_verdict,verifier_reasoning,status,created_at,reviewed_at,reviewed_by,review_note,promoted_rule_id
  from public.tariff_stacking_rule_drafts where status='pending' order by created_at,id offset review_offset limit 20) d;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into reviewed from (
  select id,proposed_rule,verifier_verdict,verifier_reasoning,status,created_at,reviewed_at,reviewed_by,review_note,promoted_rule_id
  from public.tariff_stacking_rule_drafts where status<>'pending' order by reviewed_at desc,id limit 20) d;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into rules from (
  select id,target_measure,conditions,action,cap_rate_percent,rule_text,citation,effective_date,expires_date,precedence_over,precedence_reason
  from public.tariff_stacking_rules where tier in ('human','document') and superseded_by is null
  and target_measure in (select item->'proposed_rule'->>'target_measure' from jsonb_array_elements(pending) item)
  order by id) r;
 select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) into jobs from (
  select id,citation,status,detail,detected_flags,created_at,started_at,completed_at
  from public.tariff_stacking_authoring_jobs where duplicate_of is null order by created_at desc,id limit 20) j;
 return jsonb_build_object('drafts',pending||reviewed,'rules',rules,'jobs',jobs,'totalPending',total,'hasMore',review_offset+20<total);
end;
$$;
create function public.review_tariff_stacking_draft_authenticated(
 draft_id uuid, decision text, narrowed_conditions jsonb default null,
 precedence_id uuid default null, precedence_basis text default null,
 reviewer_note text default null, source_read boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.customer_users where user_id=auth.uid() and role in ('owner','admin')) then
  raise exception 'Owner or admin review required'; end if;
 if decision='confirm' and (not coalesce(source_read,false) or coalesce(length(trim(reviewer_note)),0)<10) then
  raise exception 'Read the official source and record your legal basis'; end if;
 return public.review_tariff_stacking_draft(draft_id,auth.uid(),decision,narrowed_conditions,precedence_id,precedence_basis,reviewer_note);
end;
$$;
revoke all on function public.read_tariff_stacking_reviews(integer) from public,anon;
revoke all on function public.review_tariff_stacking_draft_authenticated(uuid,text,jsonb,uuid,text,text,boolean) from public,anon;
grant execute on function public.read_tariff_stacking_reviews(integer) to authenticated;
grant execute on function public.review_tariff_stacking_draft_authenticated(uuid,text,jsonb,uuid,text,text,boolean) to authenticated;
