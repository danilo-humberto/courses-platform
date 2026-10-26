-- Apply only after explicit authorization for the target environment.
-- Installing this function does not delete data.
begin;
create or replace function public.admin_clear_reports(p_confirmation text) returns void
language plpgsql security definer set search_path = '' as $$
declare aids uuid[];
begin
  perform private.require_admin();
  if p_confirmation is distinct from 'EXCLUIR TUDO' then
    raise exception 'Confirme a exclusão de todos os dados do relatório';
  end if;
  -- Match the course -> assignment lock order of admin_assign/admin_delete_course.
  -- Block new assignments and in-flight progress writes; ordinary reads remain available.
  lock table public.courses in exclusive mode;
  lock table public.assignments in exclusive mode;
  select array_agg(id) into aids from public.assignments;
  delete from public.completions where assignment_id = any(aids);
  delete from public.quiz_answers where attempt_id in
    (select id from public.quiz_attempts where assignment_id = any(aids));
  delete from public.quiz_attempts where assignment_id = any(aids);
  delete from public.slide_views where assignment_id = any(aids);
  delete from public.assignments where id = any(aids);
  insert into public.audit_events(actor_id,action)
    values(auth.uid(),'reports.cleared');
end $$;
revoke execute on function public.admin_clear_reports(text) from public, anon, authenticated;
grant execute on function public.admin_clear_reports(text) to authenticated;
commit;
