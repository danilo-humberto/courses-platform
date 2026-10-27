insert into auth.users(id,email) values
('10000000-0000-4000-8000-000000000001','admin@example.test'),
('10000000-0000-4000-8000-000000000002','ana@example.test'),
('10000000-0000-4000-8000-000000000003','bia@example.test');
update public.profiles set active=true, name='Synthetic';
update public.profiles set role='admin' where email='admin@example.test';
create function public.test_assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.admin_save_draft(null,'{"title":"Curso inicial","description":"","quiz_enabled":false,"pass_score":70,"max_attempts":2,"questions":[]}');
reset role;
select public.set_draft_pdf('10000000-0000-4000-8000-000000000001',(select id from public.course_versions),'test/file.pdf',2);
set role authenticated;
select public.admin_publish((select id from public.course_versions));
select public.admin_assign((select id from public.course_versions),array['10000000-0000-4000-8000-000000000002'::uuid]);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.test_assert((select count(*) from public.assignments)=0,'other manager cannot see assignments');
select public.test_assert((select count(*) from public.course_versions)=0,'other manager cannot see content');
select public.test_assert(not has_function_privilege('authenticated','public.set_draft_pdf(uuid,uuid,text,integer)','EXECUTE'),'only service can establish page counts');
select public.test_assert(not has_function_privilege('anon','public.training_submit(uuid,uuid,jsonb)','EXECUTE'),'anonymous RPC denied');
select public.test_assert(not has_table_privilege('authenticated','private.quiz_keys','SELECT'),'answer keys inaccessible');
do $$ begin
  begin perform public.admin_archive(gen_random_uuid()); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
  begin insert into public.completions(assignment_id) values(gen_random_uuid()); raise exception 'UNEXPECTED'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$ declare aid uuid := (select id from public.assignments); begin
  begin perform public.training_complete(aid); raise exception 'UNEXPECTED'; exception when raise_exception then if sqlerrm <> 'Visualize todos os slides' then raise; end if; end;
  begin perform public.training_view(aid,3); raise exception 'UNEXPECTED'; exception when raise_exception then if sqlerrm <> 'Página inválida' then raise; end if; end;
  perform public.training_start(aid);
  perform public.training_view(aid,1); perform public.training_view(aid,1);
  perform public.test_assert((select count(*) from public.slide_views)=1,'unique pages');
  perform public.training_view(aid,2);
  perform public.test_assert((select count(*) from public.completions)=0,'100% is not completion');
  perform public.training_complete(aid); perform public.training_complete(aid);
  perform public.test_assert((select count(*) from public.completions)=1,'completion is idempotent');
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.admin_save_draft((select id from public.courses),'{"title":"Curso atualizado","quiz_enabled":true,"pass_score":70,"max_attempts":2,"questions":[{"prompt":"Escolha A","options":["A","B"],"correct_index":0}]}');
reset role;
select public.set_draft_pdf('10000000-0000-4000-8000-000000000001',(select id from public.course_versions where version=2),'test/new.pdf',1);
set role authenticated;
select public.admin_publish((select id from public.course_versions where version=2));
select public.admin_assign((select id from public.course_versions where version=2),array['10000000-0000-4000-8000-000000000002'::uuid]);
select public.test_assert((select count(*) from public.completions)=1,'new version preserves history');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
select public.test_assert((select count(*) from public.questions)=0,'quiz locked before viewing');
do $$ declare aid uuid := (select a.id from public.assignments a join public.course_versions v on v.id=a.version_id where v.version=2); qid uuid; rid uuid := gen_random_uuid(); r jsonb; begin
  perform public.training_view(aid,1);
  select id into qid from public.questions;
  r := public.training_submit(aid,rid,jsonb_build_object(qid,1));
  perform public.test_assert((r->>'score')::numeric=0,'wrong answer scored zero');
  perform public.training_submit(aid,rid,jsonb_build_object(qid,1));
  perform public.test_assert((select count(*) from public.quiz_attempts)=1,'retry is idempotent');
  perform public.test_assert((select count(*) from public.completions)=1,'failed quiz not complete');
  r := public.training_submit(aid,gen_random_uuid(),jsonb_build_object(qid,0));
  perform public.test_assert((r->>'passed')::boolean,'correct answer passes');
  perform public.test_assert((select count(*) from public.completions)=2,'quiz completes automatically');
end $$;
reset role;
do $$ begin
  begin update public.course_versions set title='tamper' where version=1; raise exception 'UNEXPECTED'; exception when raise_exception then if sqlerrm <> 'Versão publicada é imutável' then raise; end if; end;
end $$;
update public.profiles set active=false where email='ana@example.test';
set role authenticated;
select public.test_assert((select count(*) from public.assignments)=0,'inactive session loses access');
reset role;
insert into storage.objects(bucket_id,name) values('training-pdfs','test/file.pdf');
set role authenticated;
select public.test_assert((select count(*) from storage.objects)=0,'inactive manager cannot access PDFs');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.test_assert((select count(*) from storage.objects)=0,'unassigned manager cannot access PDFs');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.test_assert((select count(*) from storage.objects)=1,'active admin can access PDFs');
reset role;
drop function public.test_assert(boolean,text);
