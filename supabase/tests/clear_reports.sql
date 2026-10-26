begin;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
create function pg_temp.reject_clear() returns trigger language plpgsql as $$
begin
  if new.action = 'reports.cleared' then raise exception 'Synthetic audit failure'; end if;
  return new;
end $$;
create trigger synthetic_clear_failure before insert on public.audit_events
  for each row execute function pg_temp.reject_clear();
do $$
declare before_counts jsonb; after_counts jsonb;
begin
  select jsonb_build_array((select count(*) from public.assignments), (select count(*) from public.slide_views),
    (select count(*) from public.quiz_attempts), (select count(*) from public.quiz_answers), (select count(*) from public.completions)) into before_counts;
  if not exists(select 1 from public.quiz_answers) or not exists(select 1 from public.completions) then raise exception 'Incomplete fixtures'; end if;
  begin
    perform public.admin_clear_reports('EXCLUIR TUDO');
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Synthetic audit failure' then raise; end if; end;
  select jsonb_build_array((select count(*) from public.assignments), (select count(*) from public.slide_views),
    (select count(*) from public.quiz_attempts), (select count(*) from public.quiz_answers), (select count(*) from public.completions)) into after_counts;
  if before_counts is distinct from after_counts then raise exception 'Partial deletion'; end if;
end $$;
drop trigger synthetic_clear_failure on public.audit_events;
set role authenticated;
do $$
declare preserved jsonb; after_counts jsonb;
begin
  if has_function_privilege('anon','public.admin_clear_reports(text)','execute') then raise exception 'Anonymous execution allowed'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  begin
    perform public.admin_clear_reports('EXCLUIR TUDO');
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  begin
    perform public.admin_clear_reports(null);
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm not like 'Confirme a exclusão%' then raise; end if; end;
  select jsonb_build_array((select count(*) from public.courses), (select count(*) from public.course_versions),
    (select count(*) from public.profiles), (select count(*) from public.questions)) into preserved;
  perform public.admin_clear_reports('EXCLUIR TUDO');
  if exists(select 1 from public.assignments) or exists(select 1 from public.slide_views)
    or exists(select 1 from public.quiz_attempts) or exists(select 1 from public.quiz_answers)
    or exists(select 1 from public.completions) then raise exception 'Training records remain'; end if;
  select jsonb_build_array((select count(*) from public.courses), (select count(*) from public.course_versions),
    (select count(*) from public.profiles), (select count(*) from public.questions)) into after_counts;
  if preserved is distinct from after_counts then raise exception 'Catalog or profiles changed'; end if;
  if not exists(select 1 from public.audit_events where action='reports.cleared' and actor_id=auth.uid()) then raise exception 'Missing audit'; end if;
  perform public.admin_clear_reports('EXCLUIR TUDO');
end $$;
rollback;
