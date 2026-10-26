begin;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
create function pg_temp.reject_course_delete() returns trigger language plpgsql as $$
begin
  if new.action = 'course.deleted_with_assignments' then raise exception 'Synthetic audit failure'; end if;
  return new;
end $$;
create trigger synthetic_delete_failure before insert on public.audit_events
  for each row execute function pg_temp.reject_course_delete();
do $$
declare cid uuid; counts_before jsonb; counts_after jsonb;
begin
  select course_id into cid from public.course_versions limit 1;
  select jsonb_build_array((select count(*) from public.courses), (select count(*) from public.course_versions),
    (select count(*) from public.assignments), (select count(*) from public.slide_views),
    (select count(*) from public.quiz_attempts), (select count(*) from public.quiz_answers),
    (select count(*) from public.completions), (select count(*) from public.questions),
    (select count(*) from private.quiz_keys)) into counts_before;
  begin
    perform public.admin_delete_course(cid,true);
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Synthetic audit failure' then raise; end if; end;
  select jsonb_build_array((select count(*) from public.courses), (select count(*) from public.course_versions),
    (select count(*) from public.assignments), (select count(*) from public.slide_views),
    (select count(*) from public.quiz_attempts), (select count(*) from public.quiz_answers),
    (select count(*) from public.completions), (select count(*) from public.questions),
    (select count(*) from private.quiz_keys)) into counts_after;
  if counts_before is distinct from counts_after then raise exception 'Partial deletion after failure'; end if;
end $$;
drop trigger synthetic_delete_failure on public.audit_events;
set role authenticated;
do $$
declare cid uuid; other jsonb; aid uuid;
begin
  if has_function_privilege('anon','public.admin_delete_course(uuid,boolean)','execute') then raise exception 'Anonymous execution allowed'; end if;
  select course_id into cid from public.course_versions limit 1;
  select id into aid from public.assignments limit 1;
  perform public.admin_save_profile('10000000-0000-4000-8000-000000000002','Synthetic',true);
  if not exists(select 1 from public.quiz_answers) or not exists(select 1 from public.completions) then raise exception 'Incomplete history fixtures'; end if;
  other := public.admin_save_draft(null,'{"title":"Keep this course","quiz_enabled":false,"pass_score":70,"max_attempts":2,"questions":[]}');
  -- Null is never consent, including direct RPC calls.
  begin
    perform public.admin_delete_course(cid,null);
    raise exception 'UNEXPECTED';
  exception when raise_exception then
    if sqlerrm not like 'Curso possui atribuições.%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  begin
    perform public.admin_delete_course(cid,true);
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  perform public.admin_archive(cid);
  perform public.admin_delete_course(cid,true);
  if exists(select 1 from public.courses where id=cid)
    or exists(select 1 from public.course_versions where course_id=cid)
    or exists(select 1 from public.assignments)
    or exists(select 1 from public.slide_views)
    or exists(select 1 from public.quiz_attempts)
    or exists(select 1 from public.quiz_answers)
    or exists(select 1 from public.completions)
    or exists(select 1 from public.questions) then raise exception 'Dependent data remains'; end if;
  if not exists(select 1 from public.courses where id=(other->>'course_id')::uuid)
    or not exists(select 1 from public.course_versions where id=(other->>'version_id')::uuid) then raise exception 'Unrelated course deleted'; end if;
  if not exists(select 1 from public.audit_events where target_id=cid and action='course.deleted_with_assignments') then raise exception 'Missing audit'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  if exists(select 1 from public.assignments) or exists(select 1 from public.course_versions) then raise exception 'Course still visible to manager'; end if;
  begin
    perform public.training_start(aid);
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from private.quiz_keys) then raise exception 'Answer keys remain'; end if;
end $$;
rollback;
