-- Apply only to an explicitly approved development Supabase project.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id), name text not null default '',
  email text not null, role text not null default 'manager' check (role in ('admin','manager')),
  active boolean not null default false, created_at timestamptz not null default now()
);
create table public.courses (
  id uuid primary key default gen_random_uuid(), status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now()
);
create table public.course_versions (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id),
  version integer not null check (version > 0), title text not null check (length(title) between 1 and 150),
  description text not null default '', pdf_path text, page_count integer not null default 0 check (page_count between 0 and 500),
  quiz_enabled boolean not null default false, pass_score numeric not null default 70 check (pass_score between 1 and 100),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20), published_at timestamptz,
  unique(course_id,version)
);
create unique index one_draft on public.course_versions(course_id) where published_at is null;
create table public.questions (
  id uuid primary key default gen_random_uuid(), version_id uuid not null references public.course_versions(id),
  position integer not null, prompt text not null check (length(prompt) between 1 and 2000),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  unique(version_id,position)
);
create table private.quiz_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_index integer not null check (correct_index between 0 and 5)
);
create table public.assignments (
  id uuid primary key default gen_random_uuid(), manager_id uuid not null references public.profiles(id),
  version_id uuid not null references public.course_versions(id), assigned_at timestamptz not null default now(),
  started_at timestamptz, last_slide integer not null default 1, unique(manager_id,version_id)
);
create table public.slide_views (
  assignment_id uuid not null references public.assignments(id), page integer not null check(page > 0),
  viewed_at timestamptz not null default now(), primary key(assignment_id,page)
);
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments(id),
  request_id uuid not null, attempt integer not null, score numeric not null, passed boolean not null,
  submitted_at timestamptz not null default now(), unique(assignment_id,request_id), unique(assignment_id,attempt)
);
create table public.quiz_answers (
  attempt_id uuid not null references public.quiz_attempts(id), question_id uuid not null references public.questions(id),
  selected_index integer not null, primary key(attempt_id,question_id)
);
create table public.completions (
  assignment_id uuid primary key references public.assignments(id), completed_at timestamptz not null default now(),
  attempt_id uuid references public.quiz_attempts(id)
);
create table public.audit_events (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id),
  action text not null, target_id uuid, created_at timestamptz not null default now()
);
create index assignments_manager on public.assignments(manager_id);
create index assignments_version on public.assignments(version_id);
create index attempts_assignment on public.quiz_attempts(assignment_id);

create function private.active_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active)
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active and role = 'admin')
$$;
create function private.require_admin() returns void language plpgsql security definer set search_path = '' as $$
begin if not private.is_admin() then raise exception 'Acesso negado' using errcode = '42501'; end if; end $$;
create function private.owns_assignment(aid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.active_user() and exists(select 1 from public.assignments where id = aid and manager_id = auth.uid())
$$;
create function private.can_read_version(vid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (private.active_user() and exists(select 1 from public.assignments where version_id = vid and manager_id = auth.uid()))
$$;
-- An Auth signup never grants application access. Admin activation is required.
create function private.on_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email) values(new.id, coalesce(new.email,'')); return new;
end $$;
create trigger cifra_auth_user after insert on auth.users for each row execute function private.on_auth_user();

-- Published material and completion records are immutable even to normal administrators.
create function private.immutable_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.published_at is not null then raise exception 'Versão publicada é imutável'; end if;
  return new;
end $$;
create trigger immutable_version before update or delete on public.course_versions for each row execute function private.immutable_version();
create function private.immutable_question() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.course_versions where id = coalesce(new.version_id,old.version_id) and published_at is not null)
  then raise exception 'Questões publicadas são imutáveis'; end if;
  return coalesce(new,old);
end $$;
create trigger immutable_question before insert or update or delete on public.questions for each row execute function private.immutable_question();

-- No direct client writes. All mutations below validate identity and invariants.
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_versions enable row level security;
alter table public.questions enable row level security;
alter table public.assignments enable row level security;
alter table public.slide_views enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.completions enable row level security;
alter table public.audit_events enable row level security;
alter table private.quiz_keys enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (private.is_admin() or (id = auth.uid() and active));
create policy courses_read on public.courses for select to authenticated using (private.is_admin() or exists(select 1 from public.course_versions v where v.course_id = courses.id and private.can_read_version(v.id)));
create policy versions_read on public.course_versions for select to authenticated using (private.can_read_version(id));
create policy questions_read on public.questions for select to authenticated using (private.is_admin() or exists(
  select 1 from public.assignments a join public.course_versions v on v.id = a.version_id
  where a.version_id = questions.version_id and private.owns_assignment(a.id)
  and (select count(*) from public.slide_views s where s.assignment_id = a.id) = v.page_count
));
create policy assignments_read on public.assignments for select to authenticated using (private.is_admin() or private.owns_assignment(id));
create policy views_read on public.slide_views for select to authenticated using (private.is_admin() or private.owns_assignment(assignment_id));
create policy attempts_read on public.quiz_attempts for select to authenticated using (private.is_admin() or private.owns_assignment(assignment_id));
create policy answers_read on public.quiz_answers for select to authenticated using (private.is_admin() or exists(select 1 from public.quiz_attempts t where t.id = attempt_id and private.owns_assignment(t.assignment_id)));
create policy completions_read on public.completions for select to authenticated using (private.is_admin() or private.owns_assignment(assignment_id));
create policy audit_read on public.audit_events for select to authenticated using (private.is_admin());
revoke all on public.profiles, public.courses, public.course_versions, public.questions, public.assignments, public.slide_views, public.quiz_attempts, public.quiz_answers, public.completions, public.audit_events from anon, authenticated;
grant select on public.profiles, public.courses, public.course_versions, public.questions, public.assignments, public.slide_views, public.quiz_attempts, public.quiz_answers, public.completions, public.audit_events to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.active_user(), private.is_admin(), private.owns_assignment(uuid), private.can_read_version(uuid) to authenticated;

create function public.admin_save_profile(p_id uuid, p_name text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if length(trim(p_name)) not between 1 and 120 then raise exception 'Nome inválido'; end if;
  update public.profiles set name = trim(p_name), active = p_active where id = p_id and role = 'manager';
  if not found then raise exception 'Gerente não encontrado'; end if;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'user.updated',p_id);
end $$;

create function public.admin_save_draft(p_course_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cid uuid; vid uuid; q jsonb; qid uuid; pos integer := 0;
begin
  perform private.require_admin();
  cid := p_course_id;
  if cid is null then insert into public.courses default values returning id into cid; end if;
  perform 1 from public.courses where id = cid for update;
  if not found then raise exception 'Curso não encontrado'; end if;
  if jsonb_typeof(p_data->'questions') <> 'array' or jsonb_array_length(p_data->'questions') > 50 then raise exception 'Questões inválidas'; end if;
  if (p_data->>'quiz_enabled')::boolean and jsonb_array_length(p_data->'questions') = 0 then raise exception 'Cadastre questões'; end if;
  select id into vid from public.course_versions where course_id = cid and published_at is null;
  if vid is null then
    insert into public.course_versions(course_id,version,title)
    select cid,coalesce(max(version),0)+1,p_data->>'title' from public.course_versions where course_id = cid returning id into vid;
  end if;
  update public.course_versions set title = trim(p_data->>'title'), description = coalesce(p_data->>'description',''),
    quiz_enabled = (p_data->>'quiz_enabled')::boolean, pass_score = (p_data->>'pass_score')::numeric,
    max_attempts = (p_data->>'max_attempts')::integer where id = vid;
  delete from public.questions where version_id = vid;
  for q in select value from jsonb_array_elements(p_data->'questions') loop
    if (q->>'correct_index')::integer not between 0 and jsonb_array_length(q->'options')-1
       or exists(select 1 from jsonb_array_elements_text(q->'options') o where length(trim(o)) not between 1 and 500)
    then raise exception 'Alternativas inválidas'; end if;
    insert into public.questions(version_id,position,prompt,options) values(vid,pos,q->>'prompt',q->'options') returning id into qid;
    insert into private.quiz_keys values(qid,(q->>'correct_index')::integer);
    pos := pos + 1;
  end loop;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'course.draft_saved',vid);
  return jsonb_build_object('version_id',vid,'course_id',cid);
end $$;

-- PDF page counts are established by the backend, never accepted from browser input.
create function public.set_draft_pdf(p_actor uuid, p_version uuid, p_path text, p_pages integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id = p_actor and active and role = 'admin') then raise exception 'Acesso negado'; end if;
  update public.course_versions set pdf_path = p_path, page_count = p_pages where id = p_version and published_at is null;
  if not found then raise exception 'Rascunho não encontrado'; end if;
  insert into public.audit_events(actor_id,action,target_id) values(p_actor,'course.pdf_uploaded',p_version);
end $$;

create function public.admin_publish(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.course_versions;
begin
  perform private.require_admin();
  select * into v from public.course_versions where id = p_version for update;
  if not found or v.published_at is not null then raise exception 'Rascunho não encontrado'; end if;
  if v.pdf_path is null or v.page_count < 1 then raise exception 'Envie um PDF antes de publicar'; end if;
  if v.quiz_enabled and not exists(select 1 from public.questions where version_id = v.id) then raise exception 'Cadastre questões'; end if;
  update public.course_versions set published_at = now() where id = v.id;
  update public.courses set status = 'published' where id = v.course_id;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'course.published',v.id);
end $$;
create function public.admin_archive(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.courses set status = 'archived' where id = p_course;
  if not found then raise exception 'Curso não encontrado'; end if;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'course.archived',p_course);
end $$;
create function public.admin_assign(p_version uuid, p_managers uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare mid uuid; aid uuid; cid uuid;
begin
  perform private.require_admin();
  select c.id into cid from public.course_versions v join public.courses c on c.id = v.course_id
  where v.id = p_version and v.published_at is not null and c.status = 'published' for update of c;
  if cid is null then raise exception 'Curso não publicado'; end if;
  if cardinality(p_managers) not between 1 and 200 then raise exception 'Selecione de 1 a 200 gerentes'; end if;
  foreach mid in array p_managers loop
    if not exists(select 1 from public.profiles where id = mid and role = 'manager' and active) then raise exception 'Gerente inativo ou inválido'; end if;
    insert into public.assignments(manager_id,version_id) values(mid,p_version) on conflict do nothing returning id into aid;
    if aid is not null then insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'training.assigned',aid); end if;
  end loop;
end $$;

create function public.training_start(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.owns_assignment(p_assignment) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update public.assignments set started_at = coalesce(started_at,now()) where id = p_assignment;
end $$;
create function public.training_view(p_assignment uuid, p_page integer) returns void
language plpgsql security definer set search_path = '' as $$
declare pages integer;
begin
  if not private.owns_assignment(p_assignment) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  perform 1 from public.assignments where id = p_assignment for update;
  select v.page_count into pages from public.assignments a join public.course_versions v on v.id = a.version_id where a.id = p_assignment;
  if p_page not between 1 and pages then raise exception 'Página inválida'; end if;
  insert into public.slide_views(assignment_id,page) values(p_assignment,p_page) on conflict do nothing;
  update public.assignments set started_at = coalesce(started_at,now()), last_slide = p_page where id = p_assignment;
end $$;
create function public.training_complete(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.course_versions;
begin
  if not private.owns_assignment(p_assignment) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  perform 1 from public.assignments where id = p_assignment for update;
  select cv.* into v from public.course_versions cv join public.assignments a on a.version_id = cv.id where a.id = p_assignment;
  if v.quiz_enabled then raise exception 'Este curso exige aprovação no questionário'; end if;
  if (select count(*) from public.slide_views where assignment_id = p_assignment) <> v.page_count then raise exception 'Visualize todos os slides'; end if;
  insert into public.completions(assignment_id) values(p_assignment) on conflict do nothing;
  if found then insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'training.completed',p_assignment); end if;
end $$;

create function public.training_submit(p_assignment uuid, p_request uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.course_versions; result public.quiz_attempts; q public.questions; total integer; correct integer := 0; n integer; chosen integer; grade numeric;
begin
  if not private.owns_assignment(p_assignment) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  perform 1 from public.assignments where id = p_assignment for update;
  select * into result from public.quiz_attempts where assignment_id = p_assignment and request_id = p_request;
  if found then return to_jsonb(result); end if;
  if exists(select 1 from public.completions where assignment_id = p_assignment) then raise exception 'Treinamento já concluído'; end if;
  select cv.* into v from public.course_versions cv join public.assignments a on a.version_id = cv.id where a.id = p_assignment;
  if not v.quiz_enabled then raise exception 'Curso sem questionário'; end if;
  if (select count(*) from public.slide_views where assignment_id = p_assignment) <> v.page_count then raise exception 'Visualize todos os slides'; end if;
  select count(*) into n from public.quiz_attempts where assignment_id = p_assignment;
  if n >= v.max_attempts then raise exception 'Limite de tentativas atingido'; end if;
  select count(*) into total from public.questions where version_id = v.id;
  if jsonb_typeof(p_answers) <> 'object' or (select count(*) from jsonb_object_keys(p_answers)) <> total then raise exception 'Responda todas as questões'; end if;
  for q in select * from public.questions where version_id = v.id loop
    chosen := (p_answers->>q.id::text)::integer;
    if chosen is null or chosen not between 0 and jsonb_array_length(q.options)-1 then raise exception 'Resposta inválida'; end if;
    if chosen = (select correct_index from private.quiz_keys where question_id = q.id) then correct := correct + 1; end if;
  end loop;
  grade := 100.0 * correct / total;
  insert into public.quiz_attempts(assignment_id,request_id,attempt,score,passed)
  values(p_assignment,p_request,n+1,grade,grade >= v.pass_score) returning * into result;
  insert into public.quiz_answers(attempt_id,question_id,selected_index)
  select result.id, key::uuid, value::text::integer from jsonb_each(p_answers);
  if result.passed then
    insert into public.completions(assignment_id,attempt_id) values(p_assignment,result.id);
    insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'training.completed',p_assignment);
  end if;
  insert into public.audit_events(actor_id,action,target_id) values(auth.uid(),'quiz.submitted',result.id);
  return to_jsonb(result);
end $$;

create function public.admin_questions(p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('correct_index',k.correct_index) order by q.position)
    from public.questions q join private.quiz_keys k on k.question_id = q.id where q.version_id = p_version),'[]'::jsonb);
end $$;

-- Private storage: only backend can upload; readers require current active access.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('training-pdfs','training-pdfs',false,20971520,array['application/pdf']);
create policy training_pdf_read on storage.objects for select to authenticated using (
  bucket_id = 'training-pdfs' and exists(select 1 from public.course_versions v where v.pdf_path = name and private.can_read_version(v.id))
);

-- Explicit function allow-list; helpers remain unavailable through the public API.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.active_user(), private.is_admin(), private.owns_assignment(uuid), private.can_read_version(uuid) to authenticated;
revoke execute on function public.admin_save_profile(uuid,text,boolean), public.admin_save_draft(uuid,jsonb), public.set_draft_pdf(uuid,uuid,text,integer), public.admin_publish(uuid), public.admin_archive(uuid), public.admin_assign(uuid,uuid[]), public.training_start(uuid), public.training_view(uuid,integer), public.training_complete(uuid), public.training_submit(uuid,uuid,jsonb), public.admin_questions(uuid) from public, anon, authenticated;
grant execute on function public.admin_save_profile(uuid,text,boolean), public.admin_save_draft(uuid,jsonb), public.admin_publish(uuid), public.admin_archive(uuid), public.admin_assign(uuid,uuid[]), public.training_start(uuid), public.training_view(uuid,integer), public.training_complete(uuid), public.training_submit(uuid,uuid,jsonb), public.admin_questions(uuid) to authenticated;
grant execute on function public.set_draft_pdf(uuid,uuid,text,integer) to service_role;
commit;
