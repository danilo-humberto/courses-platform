# Configuração do ambiente de desenvolvimento

## Migração aplicada em 27/10/2026: funcionários e acesso por CPF

Aplicada pelo SQL Editor com conexão `postgres`. Pré-verificação confirmou propriedade de `profiles`, criação nos schemas `public`/`private`, permissão de trigger em `auth.users`, migrations anteriores presentes e CPF ainda ausente. A primeira tentativa teve erro de sintaxe porque o editor preservou parte da consulta de verificação; nenhum DDL foi executado nessa tentativa. Após substituir todo o conteúdo e comparar com o arquivo local, a transação retornou sucesso.

A verificação posterior confirmou quatro colunas, duas funções `SECURITY DEFINER`, trigger ativo e índice de CPF. Anônimos não podem executar as funções; `anon` e `authenticated` não podem ler nem escrever na tabela privada, e `profiles` mantém RLS. Resultado: cinco perfis existentes, uma conta Auth, zero cadastros pendentes. Nenhuma base foi importada e nenhuma senha foi gerada. Evidência: `docs/evidence/employee-import-migration.png`. SHA-256 do arquivo aplicado: `09909AE72C87BCA4274B561257E458F6F3DDE48AF84E0ADCFFFFEF7F0C372FFD`. Não reaplicar: execução manual não registra histórico no Supabase CLI. Outros ambientes exigem autorização específica.

`supabase/migrations/202610270001_employee_import.sql` **foi aplicada com autorização explícita em 27/10/2026 ao projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`)**. Depende das migrations existentes, inclusive cargos e conta suprema. Adiciona CPF, UF, centro de custo e estado de credencial pendente; permite perfis sem Auth; cria importação transacional com duplicações ignoradas e papel fixo de funcionário. E-mail de contato vazio é armazenado como string vazia.

A geração inicial usa `auth.admin.createUser` com UUID do perfil e e-mail técnico `cpf@cifraengenharia.com.br`. O trigger vincula apenas o perfil pendente ativo correspondente. A redefinição usa `updateUserById`, com autorização privada de uso único e um trigger em `auth.users` que revalida ator e alvo, impede redefinição de administradores e registra auditoria. Nenhuma senha em texto aberto é persistida em tabelas da aplicação. Operações expiradas não autorizam alterações.

O guard depende de senha e app metadata serem gravadas na mesma transação Auth, mesmo em instruções separadas. Esse comportamento foi conferido no [código oficial de adminUserUpdate do Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/admin.go) e reproduzido no teste SQL, inclusive rollback após promoção do alvo e recusa de token reutilizado. O endpoint de saúde confirmou GoTrue `v2.197.0`; antes da aplicação, a transação foi conferida também no código dessa versão: https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go. Testes locais não substituem a validação da integração real com GoTrue.

Aplicar exige aprovação específica, confirmação do ambiente e permissões para alterar `public.profiles`, funções privadas e trigger de `auth.users`. A migração não importa a base real, não cria senhas e não converte contas antigas para CPF. O código atualizado depende dela para os novos cadastros. Para recuperação, preferir corrigir para frente; não remover colunas/perfis já importados nem reverter a restrição antiga enquanto existirem perfis pendentes.

Contas CPF posteriormente promovidas a administrador deixam de ser alvo da redefinição de funcionários. Como o endereço técnico não representa uma caixa postal, a recuperação dessas contas administrativas deve ser feita pelo responsável pelo Supabase. A tela não concede a um administrador o poder de redefinir a senha de outro.

Em 23/10/2026, a migração `202610230001_cifra.sql` foi aplicada pelo SQL Editor ao projeto `cifra courses` (`retowsxcpngrruytkayu`), após confirmação explícita de que é desenvolvimento e autorização do responsável. A conexão foi verificada como `postgres`, com banco inicialmente sem tabelas públicas ou usuários. Não reaplique essa migração nesse projeto; a execução manual não registra histórico no Supabase CLI.

Foram confirmados: dez tabelas públicas acessíveis ao backend, acesso anônimo a perfis negado, bucket `training-pdfs` privado (20 MB), cadastro público desativado e URLs locais configuradas. O administrador GTI Cifra (`gti@cifraengenharia.com.br`) está ativo e seu provisionamento foi registrado na auditoria. A senha deverá ser definida pelo responsável usando a recuperação de acesso. SMTP próprio não está configurado; entrega de e-mail e fluxos autenticados reais ainda precisam de homologação. Os passos abaixo servem como referência para novos ambientes.

1. Selecione um projeto **separado de produção**. Registre seu identificador e confirme as permissões efetivas no painel. Schemas diferentes no mesmo banco não representam isolamento de ambiente.
2. Revise `supabase/migrations/202610230001_cifra.sql`. A migração cria tabelas, funções, trigger de novos usuários e bucket privado `training-pdfs`. Use banco novo: os nomes devem estar livres. A migração é transacional e deve ser aplicada uma única vez pelo mecanismo de migrations da equipe.
3. No Auth, desabilite cadastro público. Configure Site URL `http://localhost:5173` e permita o redirecionamento exato `http://localhost:5173/redefinir-senha`. Ajuste a política de senha para ao menos 12 caracteres e confirme o funcionamento do envio de recuperação de senha no ambiente.
4. Depois da migração, crie o primeiro usuário no Auth pelo painel. O trigger cria um perfil **inativo**, sem privilégios. Use o exemplo de provisionamento abaixo para promover somente esse UUID revisado. Nunca use metadados fornecidos pelo usuário para definir administrador.
5. Copie as configurações de desenvolvimento para `.env` local: URL e chave publishable para `SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PUBLISHABLE_KEY`; chave secret para `SUPABASE_SECRET_KEY` no backend. A chave secret jamais pode ser usada em campos `VITE_*`. Prefira as chaves novas; os nomes antigos anon/service-role servem somente para projetos legados e precisam de mapeamento local.
6. Mantenha o schema `private` fora dos schemas expostos pelo PostgREST. O schema `public` contém somente as funções explicitamente liberadas; tabelas não aceitam escrita direta de clientes. Não crie políticas adicionais permissivas.
7. Confirme que `training-pdfs` está privado, com limite de 20 MB e MIME `application/pdf`. Não libere upload direto para usuários ou anônimos.
8. Execute a validação manual em `VALIDATION.md`, exclusivamente com dados sintéticos.

## Primeiro administrador

### Migration de cargos

`supabase/migrations/202610260001_job_positions.sql` cria `job_positions`, adiciona o vínculo opcional `profiles.job_id` e as funções administrativas de CRUD e atribuição em lote. É transacional, preserva os perfis existentes sem cargo e mantém o papel de acesso separado do cargo organizacional. Requer as migrations anteriores. Os testes automatizados aplicam a migration somente em PostgreSQL descartável local.

Em 26/10/2026, após autorização explícita do usuário, essa migration foi aplicada pelo SQL Editor ao projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`). Antes da execução, foram confirmados a conexão `postgres`, propriedade da tabela `profiles`, permissão de criação no schema `public`, presença de `private.require_admin()` e `profiles.deleted_at`, e ausência de `job_positions`. A execução retornou sucesso. A verificação posterior confirmou tabela e coluna criadas, RLS ativo, três funções administrativas `SECURITY DEFINER` e execução anônima de `admin_assign_job` negada. A tela `/cargos` carregou sem erro e habilitou “Cadastrar cargo”. Nenhum cargo ou atribuição foi criado nessa verificação. Não reaplique a migration nesse projeto: a execução manual não registra histórico no Supabase CLI. Outros ambientes continuam exigindo autorização específica.

### Provisionamento

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

O exemplo propositalmente não contém UUID válido: exige substituição consciente. Com a migration de conta suprema aplicada, a promoção de administradores fica disponível exclusivamente para GTI no frontend. Usuários anteriores à migração não são importados automaticamente; essa situação requer procedimento específico.

## Contrato de segurança

- O Express valida tokens com `auth.getUser`, consulta o perfil ativo e restringe `/api/admin`.
- Consultas e RPCs comuns usam a chave publishable e o JWT do usuário; as políticas RLS permanecem atuantes.
- Funções privilegiadas fixam `search_path` e verificam o autor. A função que estabelece PDF e número de páginas só pode ser chamada pelo backend.
- A chave secret é usada exclusivamente no backend para criar usuários e enviar PDFs/registrar seus metadados.
- As tabelas não concedem INSERT/UPDATE/DELETE a `authenticated`. Somente as RPCs validadas podem modificar progresso, provas, conclusões e cursos.
- O schema privado guarda os índices das alternativas corretas. O usuário pode ler apenas suas respostas enviadas e suas notas.
- Assinaturas de PDF duram 60 segundos; acesso ao objeto exige perfil ativo e atribuição ou perfil administrador.
- A API não registra corpos, tokens, senhas ou erros brutos do provedor. Limitação de requisições é aplicada no processo Express. Em múltiplas instâncias, é necessário armazenamento compartilhado do limite ou proteção equivalente no proxy.
- Alterações administrativas e conclusões geram eventos persistentes. A criação de usuário que falha na ativação deixa perfil inativo para recuperação pelo administrador.

## Operação posterior

Em 27/10/2026, após autorização explícita para aplicar a migration e pedido de nova tentativa, `202610270004_certificates.sql` foi aplicada em uma única transação pelo SQL Editor ao projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`). Antes da execução, foram confirmados conexão `postgres`, propriedade de `course_versions` e `completions`, CREATE nos schemas `public` e `private`, INSERT em `storage.buckets`, dependências de CPF e funções de acesso e ausência dos objetos da migration. O texto integral enviado ao editor foi comparado com o arquivo local antes da execução. A transação retornou sucesso.

A validação posterior somente leitura confirmou a coluna `course_versions.certificate`, a tabela `certificates` com RLS e política de proprietário ativo/administrador, leitura anônima negada, escrita direta negada para `authenticated`, RPC de configuração executável somente por `service_role` entre os papéis da aplicação, trigger de emissão habilitado e bucket `certificate-pdfs` privado com limite de 20 MB e tipo PDF. As duas funções são `SECURITY DEFINER` com `search_path` vazio. Permaneceram 740 perfis, 1 curso, 1 versão, 0 atribuições e 0 conclusões; a nova tabela tem 0 certificados. Nenhum certificado foi emitido e nenhum dado existente foi apagado. Evidência: `docs/evidence/certificates-migration.png`. Não reaplique: a execução manual não registra a migration no histórico do Supabase CLI. A validação funcional de upload, conclusão e download pela aplicação permanece pendente.

Em 27/10/2026, após autorização explícita, `202610230004_delete_course_assignments.sql` foi aplicada pelo SQL Editor ao projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres`. Antes da execução, foram confirmadas a propriedade da função antiga e a permissão de criação no schema `public`; a assinatura com dois parâmetros estava ausente. A transação retornou sucesso. A validação posterior confirmou `admin_delete_course(uuid,boolean)`, remoção da assinatura antiga, execução anônima negada, execução por `authenticated` e manutenção da verificação interna `private.require_admin()`. Permaneceram 1 curso, 2 versões, 0 atribuições e 0 conclusões. Nenhuma exclusão foi executada. Evidência: `docs/evidence/delete-course-assignments-migration.png`. Não reaplique a migração; a execução manual não registra histórico no Supabase CLI. A exclusão real pela interface permanece para validação do responsável.

Em 23/10/2026, o diagnóstico somente leitura de `pg_db_role_setting` confirmou `session_preload_libraries=supautils, safeupdate` para `authenticator`. A função de limpeza da migração 006 contém DELETE sem WHERE, incompatível com essa proteção. A correção local `202610230007_clear_reports_safeupdate.sql` delimita os DELETEs pelos identificadores das atribuições, preservando os bloqueios e a auditoria. Após autorização específica, a migração 007 foi aplicada pelo SQL Editor no mesmo projeto de desenvolvimento, com conexão postgres. A definição corrigida e a negação de execução anônima foram confirmadas. Antes e depois permaneceram 3 atribuições, 36 visualizações, 0 tentativas, 0 respostas, 3 conclusões, 1 curso e 4 perfis. Nenhuma limpeza foi executada. Evidência: `docs/evidence/clear-reports-safeupdate.png`. A validação funcional pelo botão permanece para o responsável. Não reaplique a migração; a execução manual não registra histórico no Supabase CLI. Os testes locais em PostgreSQL descartável passaram, mas esse ambiente não carrega a extensão `safeupdate`.

Em 23/10/2026, após autorização explícita, `202610230006_clear_reports.sql` foi aplicada pelo SQL Editor no projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres` e permissão de criação no schema `public` confirmadas. A função estava ausente antes da aplicação. Foram confirmados sua criação, execução anônima negada, `SECURITY DEFINER` e `search_path` vazio. As contagens permaneceram em 3 atribuições, 36 visualizações, 0 tentativas, 0 respostas, 3 conclusões, 1 curso e 4 perfis. A função de limpeza não foi executada; nenhum dado foi excluído. Evidência: `docs/evidence/clear-reports-migration.png`. Não reaplique a migração; a execução manual não registra histórico no Supabase CLI. A exclusão real pelo botão fica para validação do responsável.

Em 23/10/2026, após autorização explícita, `202610230005_delete_manager_auth.sql` foi aplicada pelo SQL Editor no projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres`. Foram confirmados a função `admin_prepare_manager_deletion`, execução anônima negada e o vínculo `auth_user_id` com `ON DELETE SET NULL`. Permaneceram 4 contas Auth, 4 perfis vinculados, 3 atribuições e 3 conclusões. Os 3 perfis anteriormente excluídos estão pendentes de remoção do Auth e podem ser tratados pela opção “Concluir exclusão”. Nenhuma conta foi apagada durante a aplicação. Não reaplique a migração; a execução manual não registra histórico no Supabase CLI.

Em 23/10/2026, após autorização explícita, a migração `202610230003_delete_course.sql` foi aplicada pelo SQL Editor ao projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres`. Foram confirmados a função `admin_delete_course`, execução anônima negada, cascatas de versões e questões e a chave estrangeira restritiva das atribuições. As contagens antes e depois permaneceram em 1 curso, 2 versões, 3 atribuições e 3 conclusões. Nenhum curso foi excluído durante a aplicação. Não reaplique essa migração; a execução manual não registra histórico no Supabase CLI. A exclusão pela interface permanece para homologação do responsável.

Em 23/10/2026, após autorização explícita, a migração `202610230002_delete_manager.sql` foi aplicada pelo SQL Editor ao mesmo projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), com conexão `postgres`. Foram confirmados a função `admin_delete_profile`, a coluna `deleted_at`, a restrição de perfil excluído inativo, a negação de execução anônima e o bloqueio de reativação em `admin_save_profile`. As contagens permaneceram em 4 perfis, 3 atribuições e 3 conclusões, sem perfis excluídos durante a aplicação. Não reaplique essa migração; a execução manual não registra histórico no Supabase CLI. O fluxo de exclusão real pela interface fica para validação do responsável.

Não publique sem homologar recuperação de senha, políticas reais, relações retornadas pelo PostgREST, upload/assinatura de PDFs e invalidação de acesso. Confira limites atuais de armazenamento, tráfego, e-mail e execução no plano contratado. Não há compromisso de funcionamento ilimitado em planos gratuitos.

### Conta suprema GTI

A migration `202610260002_supreme_account.sql` foi aplicada em 26/10/2026 ao projeto de desenvolvimento `cifra courses` (`retowsxcpngrruytkayu`), após autorização explícita. Outros ambientes exigem confirmação e autorização específicas. O bootstrap procura a conta administrativa ativa `gti@cifraengenharia.com.br`, conferindo o mesmo e-mail em `profiles` e `auth.users`, e fixa `is_supreme` nesse perfil. Revise o UUID correspondente antes de aplicar. Se não existir correspondência, nenhuma conta receberá o privilégio; duplicidades abortam a transação. Em instalação nova, o responsável deve provisionar explicitamente o UUID revisado da GTI após criar a conta. Não promova uma conta pelo nome de exibição ou por metadados do login.

O índice permite no máximo uma suprema. O privilégio não é atribuído automaticamente em cadastros futuros ou mudanças de e-mail. A suprema continua com `role=admin`, preservando os módulos existentes. Apenas ela pode executar `supreme_promote_admin` e visualizar todas as contas em Usuários. Admins comuns gerenciam participantes e os demais módulos, sem listar outras contas administrativas ou promover usuários. Cada promoção é auditada; contas inativas/excluídas e a própria suprema não são alvos válidos. Não há transferência de supremacia ou rebaixamento nesta entrega.

A promoção remove o vínculo organizacional de cargo e preserva os registros de treinamento. Relatórios da suprema mantêm esses registros; os relatórios dos demais admins omitem linhas cujo perfil ficou oculto pela RLS. Clientes autenticados continuam sem escrita direta em perfis. O novo botão só aparece após a migração e a atualização do perfil da sessão.

Na aplicação pelo SQL Editor, foram confirmados previamente: conexão `postgres`, propriedade de `profiles`, permissão de criação no schema `public`, ausência de `is_supreme` e uma única GTI ativa com e-mail correspondente no Auth. A execução transacional retornou sucesso. A consulta posterior confirmou exatamente uma suprema (GTI Cifra), índice de exclusividade, execução anônima da promoção negada, escrita direta de perfis negada para `authenticated` e um evento `supreme.bootstrapped`. Permaneceram 5 perfis e 1 atribuição. A interface local confirmou “Conta suprema” e o botão “Tornar administrador”. Nenhuma outra conta foi promovida na validação. Evidência: `docs/evidence/supreme-account-active.png`. Não reaplique essa migration no projeto: a execução manual não registra histórico no Supabase CLI.

## Separação de função profissional (aplicada em desenvolvimento)

A migration `202610270002_employee_function.sql` cria `profiles.professional_function`, copia o nome do cargo vinculado de cada perfil e preserva todos os vínculos e registros de cargos. Não é possível identificar retroativamente a origem dos cargos existentes; nenhum será apagado ou escondido por suposição.

Após a migração, cadastro manual e importação preenchem apenas Função profissional, sem criar cargos automaticamente. O campo de entrada `job_name` e a coluna CSV “Cargo atual” são mantidos por compatibilidade, mas passam a alimentar `professional_function`. O cadastro e a atribuição de cargos continuam na tela Cargos. Reimportações de CPF existente continuam sendo ignoradas como duplicadas.

Em 27/10/2026, após autorização explícita, a migration foi aplicada em transação no SQL Editor do projeto de desenvolvimento cifra courses (retowsxcpngrruytkayu). A conexão postgres foi confirmada como proprietária de profiles, com CREATE no schema public; a coluna ainda não existia. Após COMMIT: 740 perfis, 734 funções preenchidas, 734 vínculos de cargo e 76 cargos preservados; zero divergências entre a função copiada e o nome do cargo vinculado. Confirmados bloqueio de execução anônima, gravação no novo campo e ausência de criação automática de cargos na RPC. Evidência: docs/evidence/employee-function-migration.png. Não reaplicar: a execução manual não registra a migration no histórico do Supabase CLI.

### Limpeza dos cargos originados da importação — concluída

Em 27/10/2026, após confirmação explícita, executado scripts/cleanup-imported-jobs.sql em transação no mesmo projeto de desenvolvimento. A auditoria identificou quatro cargos criados pela tela (job.created) e um lote de 72 cargos sem criação/edição manual, criado em 2026-10-27 13:14:29.408136+00. A limpeza verificou previamente 734 vínculos e igualdade entre cada função e o nome do cargo importado. Excluídos somente os 72 cargos desse lote; a FK limpou seus job_id. Registrados 72 eventos job.import_cleanup.

Conferência final: quatro cargos (Coordenador, Funcionário, Gerente, Supervisor), 734 funções preenchidas, zero vínculos com os cargos removidos e 740 perfis preservados. Função continua sendo o Cargo atual da planilha; Cargo contém apenas os registros criados pela tela. Esta limpeza substitui a decisão anterior de preservar os cargos importados. Evidência: docs/evidence/imported-jobs-cleanup-completed.png. Não reexecutar o script.
