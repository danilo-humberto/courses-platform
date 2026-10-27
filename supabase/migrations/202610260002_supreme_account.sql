-- Prepare locally; applying to a connected environment requires specific approval.
begin;
alter table public.profiles add column is_supreme boolean not null default false;
alter table public.profiles add constraint supreme_is_admin check (not is_supreme or (role = 'admin' and active and deleted_at is null));
create unique index one_supreme_account on public.profiles (is_supreme) where is_supreme;

-- One-time bootstrap of the documented, already provisioned GTI account.
-- Future name/email changes or new signups never grant supreme access.
do $$
declare target uuid;
begin
  select p.id into strict target from public.profiles p
    join auth.users u on u.id = p.id
    where lower(p.email) = 'gti@cifraengenharia.com.br'
      and lower(u.email) = 'gti@cifraengenharia.com.br'
      and p.role = 'admin' and p.active and p.deleted_at is null;
  update public.profiles set is_supreme = true where id = target;
  insert into public.audit_events(actor_id, action, target_id) values(target, 'supreme.bootstrapped', target);
exception when no_data_found then
  -- Fresh installations have no users yet; provision the reviewed GTI UUID separately.
  null;
end $$;

create function private.is_supreme() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid()
    and is_supreme and role = 'admin' and active and deleted_at is null)
$$;
revoke all on function private.is_supreme() from public, anon;
grant execute on function private.is_supreme() to authenticated;

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  private.is_supreme() or (private.is_admin() and role = 'manager')
  or (id = auth.uid() and active)
);

create function public.supreme_promote_admin(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Lock the actor to serialize against privileged revocation during promotion.
  perform 1 from public.profiles where id = auth.uid() and is_supreme
    and role = 'admin' and active and deleted_at is null for update;
  if not found then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update public.profiles set role = 'admin', job_id = null
    where id = p_id and role = 'manager' and active and deleted_at is null;
  if not found then raise exception 'Selecione um usuário ativo para promover'; end if;
  insert into public.audit_events(actor_id, action, target_id)
    values(auth.uid(), 'user.promoted_to_admin', p_id);
end $$;
revoke all on function public.supreme_promote_admin(uuid) from public, anon;
grant execute on function public.supreme_promote_admin(uuid) to authenticated;
commit;
