# Configuração do ambiente de desenvolvimento

Em 23/10/2026, a migração `202610230001_cifra.sql` foi aplicada pelo SQL Editor ao projeto `cifra courses` (`retowsxcpngrruytkayu`), após confirmação explícita de que é desenvolvimento e autorização do responsável. A conexão foi verificada como `postgres`, com banco inicialmente sem tabelas públicas ou usuários. Não reaplique essa migração nesse projeto; a execução manual não registra histórico no Supabase CLI.

Foram confirmados: dez tabelas públicas acessíveis ao backend, acesso anônimo a perfis negado, bucket `training-pdfs` privado (20 MB), cadastro público desativado e URLs locais configuradas. O administrador GTI Cifra (`gti@cifraengenharia.com.br`) está ativo e seu provisionamento foi registrado na auditoria. A senha deverá ser definida pelo responsável usando a recuperação de acesso. SMTP próprio não está configurado; entrega de e-mail e fluxos autenticados reais ainda precisam de homologação. Os passos abaixo servem como referência para novos ambientes.

1. Selecione um projeto **separado de produção**. Registre seu identificador e confirme as permissões efetivas no painel. Schemas diferentes no mesmo banco não representam isolamento de ambiente.
2. Revise `supabase/migrations/202610230001_cifra.sql`. A migração cria tabelas, funções, trigger de novos usuários e bucket privado `training-pdfs`. Use banco novo: os nomes devem estar livres. A migração é transacional e deve ser aplicada uma única vez pelo mecanismo de migrations da equipe.
3. No Auth, desabilite cadastro público. Configure Site URL `http://localhost:5173` e permita o redirecionamento exato `http://localhost:5173/redefinir-senha`. Ajuste a política de senha para ao menos 12 caracteres e confirme o funcionamento do envio de recuperação de senha no ambiente.
4. Depois da migração, crie o primeiro usuário no Auth pelo painel. O trigger cria um perfil **inativo**, sem privilégios. Use o exemplo de provisionamento abaixo para promover somente esse UUID revisado. Nunca use metadados fornecidos pelo usuário para definir administrador.
5. Copie as configurações de desenvolvimento para `.env` local: URL e chave publishable para `SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PUBLISHABLE_KEY`; chave secret para `SUPABASE_SECRET_KEY` no backend. A chave secret jamais pode ser usada em campos `VITE_*`. Prefira as chaves novas; os nomes antigos anon/service-role servem somente para projetos legados e precisam de mapeamento local.
6. Mantenha o schema `private` fora dos schemas expostos pelo PostgREST. O schema `public` contém somente as funções explicitamente liberadas; tabelas não aceitam escrita direta de clientes. Não crie políticas adicionais permissivas.
7. Confirme que `training-pdfs` está privado, com limite de 20 MB e MIME `application/pdf`. Não libere upload direto para gerentes ou anônimos.
8. Execute a validação manual em `VALIDATION.md`, exclusivamente com dados sintéticos.

## Primeiro administrador

Execute manualmente somente após confirmar o ambiente e substituir o UUID pelo usuário criado no Auth. Não é necessário nem recomendado inserir senha em SQL.

```sql
begin;
do $$
declare target uuid := 'SUBSTITUA-PELO-UUID-DO-USUARIO';
begin
  update public.profiles
  set role = 'admin', active = true, name = 'Administrador CIFRA'
  where id = target;
  if not found then
    raise exception 'Perfil não encontrado: crie o usuário no Auth depois da migração';
  end if;
  insert into public.audit_events(actor_id,action,target_id)
  values(target,'admin.bootstrapped',target);
end $$;
commit;
```

O exemplo propositalmente não contém UUID válido: exige substituição consciente. Criação de administradores não é oferecida no frontend do MVP. Usuários anteriores à migração não são importados automaticamente; essa situação requer procedimento específico.

## Contrato de segurança

- O Express valida tokens com `auth.getUser`, consulta o perfil ativo e restringe `/api/admin`.
- Consultas e RPCs comuns usam a chave publishable e o JWT do usuário; as políticas RLS permanecem atuantes.
- Funções privilegiadas fixam `search_path` e verificam o autor. A função que estabelece PDF e número de páginas só pode ser chamada pelo backend.
- A chave secret é usada exclusivamente no backend para criar usuários e enviar PDFs/registrar seus metadados.
- As tabelas não concedem INSERT/UPDATE/DELETE a `authenticated`. Somente as RPCs validadas podem modificar progresso, provas, conclusões e cursos.
- O schema privado guarda os índices das alternativas corretas. O gerente pode ler apenas suas respostas enviadas e suas notas.
- Assinaturas de PDF duram 60 segundos; acesso ao objeto exige perfil ativo e atribuição ou perfil administrador.
- A API não registra corpos, tokens, senhas ou erros brutos do provedor. Limitação de requisições é aplicada no processo Express. Em múltiplas instâncias, é necessário armazenamento compartilhado do limite ou proteção equivalente no proxy.
- Alterações administrativas e conclusões geram eventos persistentes. A criação de usuário que falha na ativação deixa perfil inativo para recuperação pelo administrador.

## Operação posterior

Em 23/10/2026, o diagnóstico somente leitura de `pg_db_role_setting` confirmou `session_preload_libraries=supautils, safeupdate` para `authenticator`. A função de limpeza da migração 006 contém DELETE sem WHERE, incompatível com essa proteção. A correção local `202610230007_clear_reports_safeupdate.sql` delimita os DELETEs pelos identificadores das atribuições, preservando os bloqueios e a auditoria. Após autorização específica, a migração 007 foi aplicada pelo SQL Editor no mesmo projeto de desenvolvimento, com conexão postgres. A definição corrigida e a negação de execução anônima foram confirmadas. Antes e depois permaneceram 3 atribuições, 36 visualizações, 0 tentativas, 0 respostas, 3 conclusões, 1 curso e 4 perfis. Nenhuma limpeza foi executada. Evidência: `docs/evidence/clear-reports-safeupdate.png`. A validação funcional pelo botão permanece para o responsável. Não reaplique a migração; a execução manual não registra histórico no Supabase CLI. Os testes locais em PostgreSQL descartável passaram, mas esse ambiente não carrega a extensão `safeupdate`.

Em 23/10/2026, após autorização explícita, `202610230006_clear_reports.sql` foi aplicada pelo SQL Editor no projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres` e permissão de criação no schema `public` confirmadas. A função estava ausente antes da aplicação. Foram confirmados sua criação, execução anônima negada, `SECURITY DEFINER` e `search_path` vazio. As contagens permaneceram em 3 atribuições, 36 visualizações, 0 tentativas, 0 respostas, 3 conclusões, 1 curso e 4 perfis. A função de limpeza não foi executada; nenhum dado foi excluído. Evidência: `docs/evidence/clear-reports-migration.png`. Não reaplique a migração; a execução manual não registra histórico no Supabase CLI. A exclusão real pelo botão fica para validação do responsável.

Em 23/10/2026, após autorização explícita, `202610230005_delete_manager_auth.sql` foi aplicada pelo SQL Editor no projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres`. Foram confirmados a função `admin_prepare_manager_deletion`, execução anônima negada e o vínculo `auth_user_id` com `ON DELETE SET NULL`. Permaneceram 4 contas Auth, 4 perfis vinculados, 3 atribuições e 3 conclusões. Os 3 perfis anteriormente excluídos estão pendentes de remoção do Auth e podem ser tratados pela opção “Concluir exclusão”. Nenhuma conta foi apagada durante a aplicação. Não reaplique a migração; a execução manual não registra histórico no Supabase CLI.

Em 23/10/2026, após autorização explícita, a migração `202610230003_delete_course.sql` foi aplicada pelo SQL Editor ao projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres`. Foram confirmados a função `admin_delete_course`, execução anônima negada, cascatas de versões e questões e a chave estrangeira restritiva das atribuições. As contagens antes e depois permaneceram em 1 curso, 2 versões, 3 atribuições e 3 conclusões. Nenhum curso foi excluído durante a aplicação. Não reaplique essa migração; a execução manual não registra histórico no Supabase CLI. A exclusão pela interface permanece para homologação do responsável.

Em 23/10/2026, após autorização explícita, a migração `202610230002_delete_manager.sql` foi aplicada pelo SQL Editor ao mesmo projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres`. Foram confirmados a função `admin_delete_profile`, a coluna `deleted_at`, a restrição de perfil excluído inativo, a negação de execução anônima e o bloqueio de reativação em `admin_save_profile`. As contagens permaneceram em 4 perfis, 3 atribuições e 3 conclusões, sem perfis excluídos durante a aplicação. Não reaplique essa migração; a execução manual não registra histórico no Supabase CLI. O fluxo de exclusão real pela interface fica para validação do responsável.

Não publique sem homologar recuperação de senha, políticas reais, relações retornadas pelo PostgREST, upload/assinatura de PDFs e invalidação de acesso. Confira limites atuais de armazenamento, tráfego, e-mail e execução no plano contratado. Não há compromisso de funcionamento ilimitado em planos gratuitos.
