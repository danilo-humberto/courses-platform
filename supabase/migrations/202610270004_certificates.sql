-- Apply only after explicit environment authorization. No remote execution by this change.
begin;
alter table public.course_versions add column certificate jsonb;
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique,
  owner_id uuid not null,
  completed_at timestamptz not null,
  course_title text not null,
  template jsonb not null,
  values jsonb not null
);
-- Deliberately no cascading foreign keys: issued certificates outlive report/course cleanup.
alter table public.certificates enable row level security;
create policy certificates_read on public.certificates for select to authenticated
  using (private.is_admin() or (private.active_user() and owner_id = auth.uid()));
revoke all on public.certificates from anon, authenticated;
grant select on public.certificates to authenticated;
grant select on public.certificates to service_role;

create function public.set_draft_certificate(p_actor uuid, p_version uuid, p_config jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare f jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_actor and active and role='admin') then
    raise exception 'Acesso negado' using errcode='42501';
  end if;
  if p_config is not null then
    if jsonb_typeof(p_config) <> 'object'
      or coalesce(p_config->>'path','') not like 'templates/' || p_version::text || '/%.pdf'
      or jsonb_typeof(p_config->'fields') is distinct from 'array'
      or length(coalesce(p_config->>'hours','')) > 60 then raise exception 'Modelo inválido'; end if;
    if jsonb_array_length(p_config->'fields') not between 1 and 20
      or not exists(select 1 from jsonb_array_elements(p_config->'fields') e where e->>'key'='nome')
      then raise exception 'Campos inválidos'; end if;
    for f in select value from jsonb_array_elements(p_config->'fields') loop
      if coalesce(f->>'key','') not in ('nome','cpf','curso','carga_horaria','data_conclusao','codigo_certificado')
        or coalesce((f->>'x')::numeric,-1) not between 0 and 1
        or coalesce((f->>'y')::numeric,-1) not between .05 and .95
        or coalesce((f->>'width')::numeric,-1) not between .05 and 1
        or (f->>'x')::numeric+(f->>'width')::numeric>1
        or coalesce((f->>'size')::numeric,-1) not between 8 and 72
        or coalesce(f->>'color','') !~ '^#[0-9a-fA-F]{6}$'
        or coalesce(f->>'align','') not in ('left','center','right') then raise exception 'Campo inválido'; end if;
    end loop;
  end if;
  update public.course_versions set certificate=p_config where id=p_version and published_at is null;
  if not found then raise exception 'Rascunho não encontrado'; end if;
  insert into public.audit_events(actor_id,action,target_id) values(p_actor,'certificate.template_saved',p_version);
end $$;
revoke execute on function public.set_draft_certificate(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_draft_certificate(uuid,uuid,jsonb) to service_role;

create function private.issue_certificate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.course_versions; p public.profiles; aid uuid := gen_random_uuid();
begin
  select cv.* into v from public.course_versions cv join public.assignments a on a.version_id=cv.id where a.id=new.assignment_id;
  if v.certificate is null then return new; end if;
  select pr.* into p from public.profiles pr join public.assignments a on a.manager_id=pr.id where a.id=new.assignment_id;
  insert into public.certificates(id,assignment_id,owner_id,completed_at,course_title,template,values)
  values(aid,new.assignment_id,p.id,new.completed_at,v.title,v.certificate,
    jsonb_build_object('nome',p.name,'cpf',case when exists(select 1 from jsonb_array_elements(v.certificate->'fields') f where f->>'key'='cpf') then p.cpf else null end,
      'curso',v.title,'carga_horaria',v.certificate->>'hours',
      'data_conclusao',to_char(new.completed_at at time zone 'America/Sao_Paulo','DD/MM/YYYY'), 'codigo_certificado',aid::text))
  on conflict(assignment_id) do nothing;
  return new;
end $$;
create trigger issue_certificate after insert on public.completions for each row execute function private.issue_certificate();
revoke execute on function private.issue_certificate() from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('certificate-pdfs','certificate-pdfs',false,20971520,array['application/pdf']);
-- No browser Storage policies: API authorizes every private download through RLS.
commit;
