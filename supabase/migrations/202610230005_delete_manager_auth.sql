-- Apply only after explicit authorization. Does not delete any existing Auth user.
begin;
-- Historical identity stays stable; only the optional login link is removed by Auth.
alter table public.profiles add column auth_user_id uuid unique references auth.users(id) on delete set null;
update public.profiles set auth_user_id = id;
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles add constraint profile_auth_identity_matches check (auth_user_id is null or auth_user_id = id);
alter table public.profiles add constraint detached_profile_deleted check (auth_user_id is not null or (deleted_at is not null and not active));

create or replace function private.on_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,auth_user_id,email) values(new.id,new.id,coalesce(new.email,''));
  return new;
end $$;

-- A separate entry point also ensures old deployments cannot delete Auth before this migration.
create function public.admin_prepare_manager_deletion(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare auth_id uuid;
begin
  perform public.admin_delete_profile(p_id);
  select auth_user_id into auth_id from public.profiles where id = p_id;
  return auth_id;
end $$;
revoke all on function public.admin_prepare_manager_deletion(uuid) from public, anon;
grant execute on function public.admin_prepare_manager_deletion(uuid) to authenticated;
commit;
