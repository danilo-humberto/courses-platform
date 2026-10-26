begin;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin
    perform public.admin_delete_course(gen_random_uuid());
    raise exception 'UNEXPECTED';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
reset role;
do $$
declare d jsonb; cid uuid; vid uuid; assigned uuid; published boolean;
begin
  foreach published in array array[false,true] loop
    d := public.admin_save_draft(null,'{"title":"Delete synthetic","quiz_enabled":true,"pass_score":70,"max_attempts":2,"questions":[{"prompt":"Q","options":["A","B"],"correct_index":0}]}');
    cid := (d->>'course_id')::uuid; vid := (d->>'version_id')::uuid;
    if published then
      perform public.set_draft_pdf(auth.uid(),vid,'synthetic/delete.pdf',1);
      perform public.admin_publish(vid);
      begin
        delete from public.course_versions where id=vid;
        raise exception 'UNEXPECTED';
      exception when raise_exception then
        if sqlerrm <> 'Versão publicada é imutável' then raise; end if;
      end;
    end if;
    perform public.admin_delete_course(cid);
    if exists(select 1 from public.courses where id=cid)
      or exists(select 1 from public.course_versions where course_id=cid)
      or exists(select 1 from public.questions where version_id=vid) then
      raise exception 'Course contents remain';
    end if;
    if not exists(select 1 from public.audit_events where target_id=cid and action='course.deleted') then
      raise exception 'Missing deletion audit';
    end if;
  end loop;
  select v.course_id into assigned from public.assignments a join public.course_versions v on v.id=a.version_id limit 1;
  if assigned is null then raise exception 'Missing assignment fixture'; end if;
  begin
    perform public.admin_delete_course(assigned);
    raise exception 'UNEXPECTED';
  exception when raise_exception then
    if sqlerrm <> 'Curso possui atribuições. Marque a opção de apagar as atribuições ou use Arquivar para preservar o histórico.' then raise; end if;
  end;
  perform public.admin_archive(assigned);
  begin
    perform public.admin_delete_course(assigned);
    raise exception 'UNEXPECTED';
  exception when raise_exception then
    if sqlerrm <> 'Curso possui atribuições. Marque a opção de apagar as atribuições ou use Arquivar para preservar o histórico.' then raise; end if;
  end;
end $$;
rollback;

