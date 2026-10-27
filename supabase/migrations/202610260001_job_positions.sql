-- Apply to a reviewed environment only after explicit authorization.
begin;

create table public.job_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  created_at timestamptz not null default now()
);
create unique index job_positions_unique_name on public.job_positions(lower(btrim(name)));
alter table public.profiles add column job_id uuid references public.job_positions(id) on delete set null;
create index profiles_job_id on public.profiles(job_id);

alter table public.job_positions enable row level security;
revoke all on public.job_positions from public, anon, authenticated;
grant select on public.job_positions to authenticated;
create policy job_positions_admin_read on public.job_positions for select to authenticated using (private.is_admin());

create function public.admin_save_job(p_id uuid, p_name text, p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare jid uuid;
begin
  perform private.require_admin();
  if p_name is null or length(btrim(p_name)) not between 1 and 120
    then raise exception 'Informe um nome de cargo com até 120 caracteres.'; end if;
  if p_description is null or length(p_description) > 2000
    then raise exception 'A descrição deve ter até 2000 caracteres.'; end if;
  if p_id is null then
    insert into public.job_positions(name,description) values(btrim(p_name),btrim(p_description)) returning id into jid;
  else
    update public.job_positions set name=btrim(p_name), description=btrim(p_description) where id=p_id returning id into jid;
    if not found then raise exception 'Cargo não encontrado.'; end if;
  end if;
  insert into public.audit_events(actor_id,action,target_id)
    values(auth.uid(),case when p_id is null then 'job.created' else 'job.updated' end,jid);
  return jid;
exception when unique_violation then
  raise exception 'Já existe um cargo com esse nome.';
end $$;

create function public.admin_assign_job(p_job uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  perform private.require_admin();
  if p_users is null or cardinality(p_users) not between 1 and 200 or array_position(p_users,null) is not null
    then raise exception 'Selecione de 1 a 200 usuários.'; end if;
  if (select count(distinct value) from unnest(p_users) as value) <> cardinality(p_users)
    then raise exception 'Selecione cada usuário apenas uma vez.'; end if;
  -- Serialize with deletion of this job. Lock profiles in UUID order across batches.
  perform 1 from public.job_positions where id=p_job for update;
  if not found then raise exception 'Cargo não encontrado.'; end if;
  perform 1 from public.profiles where id=any(p_users) order by id for update;
  if (select count(*) from public.profiles where id=any(p_users) and role='manager' and active and deleted_at is null) <> cardinality(p_users)
    then raise exception 'Um dos usuários está inativo, excluído ou é inválido. Nenhum cargo foi alterado.'; end if;
  for uid in
    update public.profiles set job_id=p_job where id=any(p_users) and job_id is distinct from p_job returning id
  loop
    insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'user.job_assigned',uid);
  end loop;
end $$;

create function public.admin_delete_job(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform 1 from public.job_positions where id=p_id for update;
  if not found then raise exception 'Cargo não encontrado.'; end if;
  -- Match assignment lock order; the foreign key clears only the organizational link.
  perform 1 from public.profiles where job_id=p_id order by id for update;
  delete from public.job_positions where id=p_id;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'job.deleted',p_id);
end $$;

revoke all on function public.admin_save_job(uuid,text,text), public.admin_assign_job(uuid,uuid[]), public.admin_delete_job(uuid) from public, anon, authenticated;
grant execute on function public.admin_save_job(uuid,text,text), public.admin_assign_job(uuid,uuid[]), public.admin_delete_job(uuid) to authenticated;
commit;
