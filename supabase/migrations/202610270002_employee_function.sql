-- Apply before deploying the function filter. Existing job links are preserved.
-- job_name remains the existing API input for the professional function.
alter table public.profiles add column professional_function text not null default ''
  check (length(professional_function) <= 120);

update public.profiles p set professional_function = btrim(j.name)
from public.job_positions j where p.job_id = j.id;

create or replace function public.admin_create_employees(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item jsonb; payload jsonb; result jsonb := '[]'; employee_id uuid; c text; e text;
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
    employee_id := gen_random_uuid();
    insert into public.profiles(id,name,email,role,active,cpf,state,cost_center,professional_function,credential_pending)
      values(employee_id,btrim(payload->>'name'),e,'manager',true,c,coalesce(payload->>'state',''),coalesce(payload->>'cost_center',''),btrim(coalesce(payload->>'job_name','')),true);
    insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'user.created_pending',employee_id);
    result := result || jsonb_build_array(jsonb_build_object('row',item->'row','status','created','id',employee_id));
  end loop;
  return result;
end $$;
revoke all on function public.admin_create_employees(jsonb) from public, anon;
grant execute on function public.admin_create_employees(jsonb) to authenticated;

