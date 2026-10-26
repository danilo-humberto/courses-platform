-- Apply only after explicit authorization for the target environment.
-- Installing this function does not delete data.
begin;
create function public.admin_clear_reports(p_confirmation text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_confirmation is distinct from 'EXCLUIR TUDO' then
    raise exception 'Confirme a exclusão de todos os dados do relatório';
  end if;
  -- Match the course -> assignment lock order of admin_assign/admin_delete_course.
  -- Block new assignments and in-flight progress writes; ordinary reads remain available.
  lock table public.courses in exclusive mode;
  lock table public.assignments in exclusive mode;
  delete from public.completions;
  delete from public.quiz_answers;
  delete from public.quiz_attempts;
  delete from public.slide_views;
  delete from public.assignments;
  insert into public.audit_events(actor_id,action)
    values(auth.uid(),'reports.cleared');
end $$;
revoke execute on function public.admin_clear_reports(text) from public, anon, authenticated;
grant execute on function public.admin_clear_reports(text) to authenticated;
commit;
