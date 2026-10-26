-- Logical deletion: retain Auth identity and all historical foreign keys.
begin;
alter table public.profiles add column deleted_at timestamptz;
alter table public.profiles add constraint deleted_profile_inactive
  check (deleted_at is null or not active);

create or replace function public.admin_save_profile(p_id uuid, p_name text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if length(trim(p_name)) not between 1 and 120 then raise exception 'Nome inválido'; end if;
  update public.profiles set name = trim(p_name), active = p_active
    where id = p_id and role = 'manager' and deleted_at is null;
  if not found then raise exception 'Gerente não encontrado ou excluído'; end if;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'user.updated',p_id);
end $$;

create function public.admin_delete_profile(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  perform private.require_admin();
  select * into target from public.profiles where id = p_id and role = 'manager' for update;
  if not found then raise exception 'Gerente não encontrado'; end if;
  if target.deleted_at is not null then return; end if;
  update public.profiles set active = false, deleted_at = now() where id = p_id;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'user.deleted',p_id);
end $$;
revoke all on function public.admin_delete_profile(uuid) from public, anon;
grant execute on function public.admin_delete_profile(uuid) to authenticated;
commit;
