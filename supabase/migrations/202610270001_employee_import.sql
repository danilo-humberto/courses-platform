-- Prepared only. Applying to any connected environment requires separate approval.
begin;
alter table public.profiles
  add column cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  add column state text not null default '',
  add column cost_center text not null default '',
  add column credential_pending boolean not null default false;
create unique index profiles_cpf_unique on public.profiles(cpf) where cpf is not null and deleted_at is null;
alter table public.profiles drop constraint detached_profile_deleted;
alter table public.profiles add constraint detached_profile_deleted check (
  auth_user_id is not null or (deleted_at is not null and not active)
  or (credential_pending and role = 'manager' and cpf is not null)
);
alter table public.profiles add constraint pending_without_auth check (not credential_pending or auth_user_id is null);

-- A pending employee is linked by an explicit UUID supplied by the trusted Auth
-- admin API, never by contact email or user-controlled signup metadata.
create or replace function private.on_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  select * into target from public.profiles where id=new.id for update;
  if found then
    if not target.credential_pending or target.auth_user_id is not null
       or target.role <> 'manager' or not target.active or target.deleted_at is not null
       or new.email is distinct from target.cpf || '@cifraengenharia.com.br'
    then raise exception 'Cadastro não disponível para gerar acesso'; end if;
    update public.profiles set auth_user_id=new.id, credential_pending=false where id=new.id;
    insert into public.audit_events(action,target_id) values('user.password_generated',new.id);
  else
    insert into public.profiles(id,auth_user_id,email) values(new.id,new.id,coalesce(new.email,''));
  end if;
  return new;
end $$;

create function public.admin_create_employees(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item jsonb; payload jsonb; result jsonb := '[]'; employee_id uuid; jid uuid; c text; e text;
begin
  perform private.require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 10000
    then raise exception 'Selecione de 1 a 10.000 registros'; end if;
  -- Serializes concurrent imports/manual creations, including optional email checks.
  perform pg_advisory_xact_lock(270001);
  for item in select value from jsonb_array_elements(p_rows) loop
    payload := item->'data'; c := payload->>'cpf'; e := lower(btrim(coalesce(payload->>'email','')));
    if c is null or c !~ '^[0-9]{11}$' or coalesce(length(btrim(payload->>'name')),0) not between 1 and 120
       or length(coalesce(payload->>'cost_center','')) > 160 or length(coalesce(payload->>'job_name','')) > 120
       or (coalesce(payload->>'state','') <> '' and payload->>'state' <> all(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']))
       or (e <> '' and (length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    then raise exception 'Dados de funcionário inválidos'; end if;
    if exists(select 1 from public.profiles where deleted_at is null and (cpf=c or (e<>'' and lower(email)=e))) then
      result := result || jsonb_build_array(jsonb_build_object('row',item->'row','status','duplicate','message','CPF ou e-mail já cadastrado.'));
      continue;
    end if;
    jid := null;
    if btrim(coalesce(payload->>'job_name','')) <> '' then
      insert into public.job_positions(name) values(btrim(payload->>'job_name')) on conflict do nothing;
      select id into jid from public.job_positions where lower(btrim(name))=lower(btrim(payload->>'job_name'));
    end if;
    employee_id := gen_random_uuid();
    insert into public.profiles(id,name,email,role,active,cpf,state,cost_center,job_id,credential_pending)
      values(employee_id,btrim(payload->>'name'),e,'manager',true,c,coalesce(payload->>'state',''),coalesce(payload->>'cost_center',''),jid,true);
    insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'user.created_pending',employee_id);
    result := result || jsonb_build_array(jsonb_build_object('row',item->'row','status','created','id',employee_id));
  end loop;
  return result;
end $$;
revoke all on function public.admin_create_employees(jsonb) from public, anon;
grant execute on function public.admin_create_employees(jsonb) to authenticated;

create table private.employee_password_operations (
  token uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  target_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
revoke all on private.employee_password_operations from public, anon, authenticated;

-- Auth's service call is separate from the requesting user's transaction. Recheck
-- authorization inside the password write to serialize against promotion/revocation.
create function private.guard_employee_password() returns trigger
language plpgsql security definer set search_path = '' as $$
declare op private.employee_password_operations;
begin
  if new.raw_app_meta_data->>'employee_password_operation' is null then return new; end if;
  delete from private.employee_password_operations
    where token=(new.raw_app_meta_data->>'employee_password_operation')::uuid
      and target_id=new.id and created_at > now()-interval '5 minutes'
    returning * into op;
  if not found then raise exception 'Operação de senha inválida' using errcode='42501'; end if;
  perform 1 from public.profiles where id=op.actor_id and role='admin' and active and deleted_at is null for update;
  if not found then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform 1 from public.profiles where id=new.id and role='manager' and active and deleted_at is null
    and auth_user_id=new.id and new.email=cpf || '@cifraengenharia.com.br' for update;
  if not found then raise exception 'Funcionário ativo não encontrado' using errcode='42501'; end if;
  new.raw_app_meta_data := new.raw_app_meta_data - 'employee_password_operation';
  insert into public.audit_events(actor_id,action,target_id) values(op.actor_id,'user.password_regenerated',new.id);
  return new;
end $$;
create trigger guard_employee_password before update on auth.users for each row execute function private.guard_employee_password();

create function public.admin_employee_password_target(p_id uuid, p_reset boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.profiles; operation uuid;
begin
  perform private.require_admin();
  select * into target from public.profiles where id=p_id and role='manager' and active and deleted_at is null for update;
  if not found then raise exception 'Funcionário ativo não encontrado'; end if;
  if target.cpf is null then raise exception 'Informe o CPF antes de gerar senha'; end if;
  if target.auth_user_id is not null then
    if not p_reset then raise exception 'Confirme a geração de uma nova senha'; end if;
    delete from private.employee_password_operations where created_at < now()-interval '10 minutes';
    insert into private.employee_password_operations(actor_id,target_id) values(auth.uid(),target.id) returning token into operation;
  elsif not target.credential_pending then raise exception 'Cadastro não disponível para gerar acesso'; end if;
  return jsonb_build_object('id',target.id,'cpf',target.cpf,'auth_user_id',target.auth_user_id,'operation',operation);
end $$;
revoke all on function public.admin_employee_password_target(uuid,boolean) from public, anon;
grant execute on function public.admin_employee_password_target(uuid,boolean) to authenticated;
commit;
