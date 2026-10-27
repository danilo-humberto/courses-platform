-- Reviewed cleanup for cifra courses (retowsxcpngrruytkayu), executed on 2026-10-27 after explicit confirmation. Do not rerun.
-- Preserve manually created jobs and all professional_function values.
begin;
lock table public.job_positions, public.profiles, public.audit_events in share row exclusive mode;
create temporary table imported_jobs_cleanup on commit drop as
select j.id from public.job_positions j
where j.created_at = timestamptz '2026-10-27 13:14:29.408136+00'
and not exists (select 1 from public.audit_events a where a.target_id=j.id and a.action in ('job.created','job.updated'));
do $$
begin
  if (select count(*) from imported_jobs_cleanup) <> 72 then
    raise exception 'Expected exactly 72 imported jobs; cleanup cancelled';
  end if;
  if (select count(*) from public.profiles where job_id in (select id from imported_jobs_cleanup)) <> 734 then
    raise exception 'Expected exactly 734 imported links; cleanup cancelled';
  end if;
  if exists(select 1 from public.profiles p join public.job_positions j on p.job_id=j.id
    where j.id in (select id from imported_jobs_cleanup)
    and p.professional_function is distinct from btrim(j.name)) then
    raise exception 'Professional function differs; cleanup cancelled';
  end if;
end $$;
delete from public.job_positions where id in (select id from imported_jobs_cleanup);
-- The existing ON DELETE SET NULL foreign key clears job_id only.
insert into public.audit_events(action,target_id)
select 'job.import_cleanup',id from imported_jobs_cleanup;
commit;
