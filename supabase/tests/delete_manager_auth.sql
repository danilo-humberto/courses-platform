begin;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin
    perform public.admin_prepare_manager_deletion('10000000-0000-4000-8000-000000000002');
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin
  begin
    perform public.admin_prepare_manager_deletion('10000000-0000-4000-8000-000000000001');
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Gerente não encontrado' then raise; end if; end;
  if has_function_privilege('anon','public.admin_prepare_manager_deletion(uuid)','EXECUTE') then raise exception 'Anonymous execution allowed'; end if;
end $$;
reset role;
create temporary table history_before as select jsonb_build_array(
  (select jsonb_agg(a order by id) from public.assignments a),
  (select jsonb_agg(v order by assignment_id,page) from public.slide_views v),
  (select jsonb_agg(t order by id) from public.quiz_attempts t),
  (select jsonb_agg(a order by attempt_id,question_id) from public.quiz_answers a),
  (select jsonb_agg(c order by assignment_id) from public.completions c)
) as snapshot;
set role authenticated;
do $$ begin
  if public.admin_prepare_manager_deletion('10000000-0000-4000-8000-000000000002') <> '10000000-0000-4000-8000-000000000002'::uuid then raise exception 'Wrong Auth identity'; end if;
  if public.admin_prepare_manager_deletion('10000000-0000-4000-8000-000000000002') <> '10000000-0000-4000-8000-000000000002'::uuid then raise exception 'Retry lost identity'; end if;
end $$;
reset role;
-- Simulate the Auth server's successful removal of the synthetic account.
delete from auth.users where id='10000000-0000-4000-8000-000000000002';
do $$ declare snapshot_after jsonb; begin
  if not exists(select 1 from public.profiles where id='10000000-0000-4000-8000-000000000002' and auth_user_id is null and deleted_at is not null and not active) then raise exception 'Historical identity lost'; end if;
  select jsonb_build_array(
    (select jsonb_agg(a order by id) from public.assignments a),
    (select jsonb_agg(v order by assignment_id,page) from public.slide_views v),
    (select jsonb_agg(t order by id) from public.quiz_attempts t),
    (select jsonb_agg(a order by attempt_id,question_id) from public.quiz_answers a),
    (select jsonb_agg(c order by assignment_id) from public.completions c)
  ) into snapshot_after;
  if snapshot_after is distinct from (select snapshot from history_before) then raise exception 'History changed'; end if;
  if public.admin_prepare_manager_deletion('10000000-0000-4000-8000-000000000002') is not null then raise exception 'Completed deletion not idempotent'; end if;
end $$;
insert into auth.users values('10000000-0000-4000-8000-000000000099','ana@example.test');
select public.admin_save_profile('10000000-0000-4000-8000-000000000099','New Ana',true);
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',true);
do $$ begin
  if not exists(select 1 from public.profiles where id='10000000-0000-4000-8000-000000000099' and auth_user_id=id and active) then raise exception 'New account not linked'; end if;
  if exists(select 1 from public.assignments) then raise exception 'New account inherited history'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from public.profiles) or exists(select 1 from public.assignments) then raise exception 'Old session retains access'; end if;
end $$;
rollback;
