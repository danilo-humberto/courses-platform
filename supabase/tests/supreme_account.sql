begin;
reset role;
insert into auth.users(id,email) values
 ('90000000-0000-4000-8000-000000000001','supreme@example.test'),
 ('90000000-0000-4000-8000-000000000002','admin@example.test'),
 ('90000000-0000-4000-8000-000000000003','learner@example.test'),
 ('90000000-0000-4000-8000-000000000004','inactive@example.test');
update public.profiles set active=true where id in ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000003');
update public.profiles set role='admin' where id in ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002');
update public.profiles set is_supreme=true where id='90000000-0000-4000-8000-000000000001';
do $$ begin
  begin update public.profiles set is_supreme=true where id='90000000-0000-4000-8000-000000000002'; raise exception 'UNEXPECTED'; exception when unique_violation then null; end;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from public.profiles where id='90000000-0000-4000-8000-000000000001') then raise exception 'Supreme exposed'; end if;
  begin perform public.supreme_promote_admin('90000000-0000-4000-8000-000000000003'); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  begin update public.profiles set is_supreme=true where id=auth.uid(); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin perform public.supreme_promote_admin(auth.uid()); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
select public.supreme_promote_admin('90000000-0000-4000-8000-000000000003');
do $$ begin
  if not exists(select 1 from public.profiles where id='90000000-0000-4000-8000-000000000003' and role='admin' and not is_supreme) then raise exception 'Promotion incorrect'; end if;
  if not exists(select 1 from public.audit_events where action='user.promoted_to_admin' and target_id='90000000-0000-4000-8000-000000000003') then raise exception 'Audit missing'; end if;
  begin perform public.supreme_promote_admin('90000000-0000-4000-8000-000000000004'); raise exception 'UNEXPECTED'; exception when raise_exception then if sqlerrm <> 'Selecione um usuário ativo para promover' then raise; end if; end;
  begin perform public.supreme_promote_admin(auth.uid()); raise exception 'UNEXPECTED'; exception when raise_exception then if sqlerrm <> 'Selecione um usuário ativo para promover' then raise; end if; end;
  if has_function_privilege('anon','public.supreme_promote_admin(uuid)','EXECUTE') then raise exception 'Anonymous promotion enabled'; end if;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin perform public.supreme_promote_admin('90000000-0000-4000-8000-000000000004'); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  perform public.admin_save_job(null,'Promoted admin job','');
end $$;
rollback;
