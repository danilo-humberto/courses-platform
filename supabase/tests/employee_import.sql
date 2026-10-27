begin;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; eid uuid; begin
  result := public.admin_create_employees('[{"row":2,"data":{"name":"Synthetic Employee","cpf":"01234567890","email":"","state":"PE","cost_center":"TI","job_name":"Synthetic Function","role":"admin"}}]');
  eid := (result->0->>'id')::uuid;
  if not exists(select 1 from public.profiles where id=eid and role='manager' and credential_pending and auth_user_id is null and email='' and cpf='01234567890' and job_id is null and professional_function='Synthetic Function') then raise exception 'Pending profile incorrect'; end if;
  if exists(select 1 from public.job_positions where name='Synthetic Function') then raise exception 'Function created a job'; end if;
  if exists(select 1 from public.profiles p where p.id=eid and p.is_supreme) then raise exception 'Privilege escalation'; end if;
  result := public.admin_create_employees('[{"row":2,"data":{"name":"Duplicate","cpf":"01234567890","email":""}}]');
  if result->0->>'status' <> 'duplicate' then raise exception 'Duplicate not skipped'; end if;
  if public.admin_employee_password_target(eid)->>'cpf' <> '01234567890' then raise exception 'Incorrect password target'; end if;
  perform set_config('test.employee_id',eid::text,true);
  if has_function_privilege('anon','public.admin_create_employees(jsonb)','execute') then raise exception 'Anonymous import allowed'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin perform public.admin_create_employees('[]'); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  begin perform public.admin_employee_password_target(current_setting('test.employee_id')::uuid); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Auth linkage rejects a mismatched identity, preserving the pending profile.
do $$ begin
  begin
    insert into auth.users(id,email) values(current_setting('test.employee_id')::uuid,'wrong@example.test');
    raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Cadastro não disponível para gerar acesso' then raise; end if; end;
end $$;
insert into auth.users(id,email) values(current_setting('test.employee_id')::uuid,'01234567890@cifraengenharia.com.br');
do $$ begin
  if not exists(select 1 from public.profiles where id=current_setting('test.employee_id')::uuid and auth_user_id=id and not credential_pending and email='') then raise exception 'Contact overwritten or identity not linked'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin
  begin perform public.admin_employee_password_target(current_setting('test.employee_id')::uuid); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Confirme a geração de uma nova senha' then raise; end if; end;
  begin perform public.admin_employee_password_target(auth.uid()); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Funcionário ativo não encontrado' then raise; end if; end;
end $$;
-- Simulate GoTrue's separate password and metadata writes inside one transaction.
select set_config('test.password_operation', public.admin_employee_password_target(current_setting('test.employee_id')::uuid,true)->>'operation',true);
reset role;
update auth.users set encrypted_password='synthetic-hash' where id=current_setting('test.employee_id')::uuid;
update auth.users set raw_app_meta_data=jsonb_build_object('employee_password_operation',current_setting('test.password_operation')) where id=current_setting('test.employee_id')::uuid;
do $$ begin
  if exists(select 1 from auth.users where id=current_setting('test.employee_id')::uuid and raw_app_meta_data ? 'employee_password_operation') then raise exception 'Operation leaked'; end if;
  if not exists(select 1 from public.audit_events where target_id=current_setting('test.employee_id')::uuid and action='user.password_regenerated' and actor_id='10000000-0000-4000-8000-000000000001') then raise exception 'Reset audit missing'; end if;
  begin
    update auth.users set raw_app_meta_data=jsonb_build_object('employee_password_operation',current_setting('test.password_operation')) where id=current_setting('test.employee_id')::uuid;
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
end $$;
set role authenticated;
select set_config('test.password_operation', public.admin_employee_password_target(current_setting('test.employee_id')::uuid,true)->>'operation',true);
reset role;
update public.profiles set role='admin' where id=current_setting('test.employee_id')::uuid;
do $$ begin
  begin
    update auth.users set encrypted_password='should-rollback' where id=current_setting('test.employee_id')::uuid;
    update auth.users set raw_app_meta_data=jsonb_build_object('employee_password_operation',current_setting('test.password_operation')) where id=current_setting('test.employee_id')::uuid;
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from auth.users where id=current_setting('test.employee_id')::uuid and encrypted_password <> 'synthetic-hash') then raise exception 'Password changed after promotion'; end if;
end $$;
rollback;
