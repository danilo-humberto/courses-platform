-- Apply only after explicit authorization for the target environment.
begin;

-- Assignment foreign keys remain restrictive: historical records never cascade.
alter table public.course_versions drop constraint course_versions_course_id_fkey;
alter table public.course_versions add constraint course_versions_course_id_fkey
  foreign key (course_id) references public.courses(id) on delete cascade;
alter table public.questions drop constraint questions_version_id_fkey;
alter table public.questions add constraint questions_version_id_fkey
  foreign key (version_id) references public.course_versions(id) on delete cascade;

create or replace function private.immutable_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Only parent-course deletion may remove published versions. Direct edits stay blocked.
  if tg_op = 'DELETE' and not exists(select 1 from public.courses where id = old.course_id) then
    return old;
  end if;
  if old.published_at is not null then raise exception 'Versão publicada é imutável'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create function public.admin_delete_course(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  -- Same lock used by assignment and draft creation; prevents check/delete races.
  perform 1 from public.courses where id = p_course for update;
  if not found then raise exception 'Curso não encontrado'; end if;
  if exists(select 1 from public.assignments a join public.course_versions v on v.id = a.version_id where v.course_id = p_course) then
    raise exception 'Curso possui atribuições. Use Arquivar para preservar o histórico.';
  end if;
  delete from public.courses where id = p_course;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'course.deleted',p_course);
end $$;
revoke execute on function public.admin_delete_course(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_course(uuid) to authenticated;
commit;
