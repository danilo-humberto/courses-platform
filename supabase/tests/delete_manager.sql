-- Roll back all fixtures so the following concurrency tests remain independent.
begin;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin
    perform public.admin_delete_profile('10000000-0000-4000-8000-000000000002');
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$
declare before_history jsonb; after_history jsonb;
begin
  perform public.admin_save_profile('10000000-0000-4000-8000-000000000002','Ana',true);
  select jsonb_build_array(
    (select jsonb_agg(a) from public.assignments a),
    (select jsonb_agg(v) from public.slide_views v),
    (select jsonb_agg(q) from public.quiz_attempts q),
    (select jsonb_agg(q) from public.quiz_answers q),
    (select jsonb_agg(c) from public.completions c)
  ) into before_history;
  perform public.admin_delete_profile('10000000-0000-4000-8000-000000000002');
  perform public.admin_delete_profile('10000000-0000-4000-8000-000000000002');
  if not exists(select 1 from public.profiles where id='10000000-0000-4000-8000-000000000002' and not active and deleted_at is not null)
    then raise exception 'Deletion did not disable profile'; end if;
  if (select count(*) from public.audit_events where action='user.deleted') <> 1
    then raise exception 'Deletion audit not idempotent'; end if;
  select jsonb_build_array(
    (select jsonb_agg(a) from public.assignments a),
    (select jsonb_agg(v) from public.slide_views v),
    (select jsonb_agg(q) from public.quiz_attempts q),
    (select jsonb_agg(q) from public.quiz_answers q),
    (select jsonb_agg(c) from public.completions c)
  ) into after_history;
  if before_history is distinct from after_history then raise exception 'History changed'; end if;
  begin
    perform public.admin_save_profile('10000000-0000-4000-8000-000000000002','Ana',true);
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Gerente não encontrado ou excluído' then raise; end if; end;
  begin
    perform public.admin_delete_profile('10000000-0000-4000-8000-000000000001');
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Gerente não encontrado' then raise; end if; end;
  begin
    perform public.admin_assign((select id from public.course_versions limit 1),array['10000000-0000-4000-8000-000000000002'::uuid]);
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Gerente inativo ou inválido' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from public.assignments) or exists(select 1 from storage.objects)
    or exists(select 1 from public.profiles) then raise exception 'Deleted session retains access'; end if;
end $$;
rollback;
