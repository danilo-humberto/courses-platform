begin;
reset role;
insert into auth.users(id,email) values
 ('80000000-0000-4000-8000-000000000001','jobs-admin@example.test'),
 ('80000000-0000-4000-8000-000000000002','jobs-user-a@example.test'),
 ('80000000-0000-4000-8000-000000000003','jobs-user-b@example.test'),
 ('80000000-0000-4000-8000-000000000004','jobs-inactive@example.test');
update public.profiles set active=true where id in ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000003');
update public.profiles set role='admin' where id='80000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
do $$
declare first_job uuid; second_job uuid; before_history jsonb;
  members uuid[] := array['80000000-0000-4000-8000-000000000002'::uuid,'80000000-0000-4000-8000-000000000003'::uuid];
begin
  first_job := public.admin_save_job(null,' Analista ','Equipe');
  second_job := public.admin_save_job(null,'Engenheiro','Obras');
  if (select name from public.job_positions where id=first_job) <> 'Analista' then raise exception 'Name not trimmed'; end if;
  begin perform public.admin_save_job(null,'analista',''); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Já existe um cargo com esse nome.' then raise; end if; end;
  begin perform public.admin_save_job(null,'  ',''); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Informe um nome de cargo com até 120 caracteres.' then raise; end if; end;
  begin perform public.admin_save_job(gen_random_uuid(),'Ausente',''); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Cargo não encontrado.' then raise; end if; end;
  perform public.admin_save_job(first_job,'Analista sênior','Descrição atualizada');
  perform public.admin_assign_job(first_job,members);
  if (select count(*) from public.profiles where id=any(members) and job_id=first_job) <> 2 then raise exception 'Batch not assigned'; end if;
  perform public.admin_assign_job(first_job,members);
  if (select count(*) from public.audit_events where action='user.job_assigned' and target_id=any(members)) <> 2 then raise exception 'Non-idempotent assignment'; end if;
  perform public.admin_assign_job(second_job,array[members[1]]);
  if (select job_id from public.profiles where id=members[1]) <> second_job then raise exception 'Job not replaced'; end if;
  if (select job_id from public.profiles where id=members[2]) <> first_job then raise exception 'Unselected user changed'; end if;
  begin perform public.admin_assign_job(second_job,array[members[2],'80000000-0000-4000-8000-000000000004'::uuid]); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Um dos usuários está inativo, excluído ou é inválido. Nenhum cargo foi alterado.' then raise; end if; end;
  if (select job_id from public.profiles where id=members[2]) <> first_job then raise exception 'Partial batch committed'; end if;
  begin perform public.admin_assign_job(second_job,array[members[1],members[1]]); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Selecione cada usuário apenas uma vez.' then raise; end if; end;
  begin perform public.admin_assign_job(second_job,'{}'::uuid[]); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Selecione de 1 a 200 usuários.' then raise; end if; end;
  begin perform public.admin_assign_job(second_job,array[null::uuid]); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Selecione de 1 a 200 usuários.' then raise; end if; end;
  begin perform public.admin_assign_job(second_job,array['80000000-0000-4000-8000-000000000001'::uuid]); raise exception 'UNEXPECTED';
  exception when raise_exception then if sqlerrm <> 'Um dos usuários está inativo, excluído ou é inválido. Nenhum cargo foi alterado.' then raise; end if; end;
  if (select role from public.profiles where id=members[1]) <> 'manager' then raise exception 'Job changed permissions'; end if;
  -- Direct writes and ordinary users cannot bypass the administrative functions.
  begin update public.job_positions set name='Bypass' where id=first_job; raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  begin update public.profiles set job_id=first_job where id=members[1]; raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',members[1]::text,true);
  if exists(select 1 from public.job_positions) then raise exception 'Catalog exposed to learner'; end if;
  begin perform public.admin_save_job(null,'Bypass',''); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  begin perform public.admin_assign_job(first_job,array[members[1]]); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  begin perform public.admin_delete_job(first_job); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
  select jsonb_build_array((select jsonb_agg(a) from public.assignments a),(select jsonb_agg(c) from public.completions c)) into before_history;
  perform public.admin_delete_job(first_job);
  if (select job_id from public.profiles where id=members[2]) is not null then raise exception 'Deleted job still assigned'; end if;
  if (select job_id from public.profiles where id=members[1]) <> second_job then raise exception 'Other job affected'; end if;
  if (select count(*) from public.profiles where id=any(members)) <> 2 then raise exception 'User removed'; end if;
  if before_history is distinct from jsonb_build_array((select jsonb_agg(a) from public.assignments a),(select jsonb_agg(c) from public.completions c)) then raise exception 'Training history changed'; end if;
  if not exists(select 1 from public.audit_events where action='job.deleted' and target_id=first_job) then raise exception 'Missing deletion audit'; end if;
end $$;
do $$ begin
  if has_function_privilege('anon','public.admin_save_job(uuid,text,text)','EXECUTE')
    or has_function_privilege('anon','public.admin_assign_job(uuid,uuid[])','EXECUTE')
    or has_function_privilege('anon','public.admin_delete_job(uuid)','EXECUTE')
    then raise exception 'Anonymous job operation allowed'; end if;
end $$;
rollback;
