-- Apply only after explicit authorization for the target environment.
begin;
drop function public.admin_delete_course(uuid);
create function public.admin_delete_course(p_course uuid, p_delete_assignments boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare aids uuid[];
begin
  perform private.require_admin();
  -- Serialize with assignment creation and edits of this course.
  perform 1 from public.courses where id = p_course for update;
  if not found then raise exception 'Curso não encontrado'; end if;
  -- Serialize with in-flight progress/quiz writes before collecting dependent rows.
  perform a.id from public.assignments a join public.course_versions v on v.id = a.version_id
    where v.course_id = p_course order by a.id for update of a;
  select array_agg(a.id) into aids from public.assignments a
    join public.course_versions v on v.id = a.version_id where v.course_id = p_course;
  if cardinality(aids) > 0 and p_delete_assignments is not true then
    raise exception 'Curso possui atribuições. Marque a opção de apagar as atribuições ou use Arquivar para preservar o histórico.';
  end if;
  -- Restrictive FKs remain unchanged. Only this explicitly confirmed operation removes history.
  delete from public.completions where assignment_id = any(aids);
  delete from public.quiz_answers where attempt_id in
    (select id from public.quiz_attempts where assignment_id = any(aids));
  delete from public.quiz_attempts where assignment_id = any(aids);
  delete from public.slide_views where assignment_id = any(aids);
  delete from public.assignments where id = any(aids);
  delete from public.courses where id = p_course;
  insert into public.audit_events(actor_id,action,target_id)
    values(auth.uid(),case when cardinality(aids) > 0 then 'course.deleted_with_assignments' else 'course.deleted' end,p_course);
end $$;
revoke execute on function public.admin_delete_course(uuid,boolean) from public, anon, authenticated;
grant execute on function public.admin_delete_course(uuid,boolean) to authenticated;
commit;
