# CIFRA — Plano de implementação do MVP

Status: implementação local autorizada pelo usuário e executada. Integração remota e publicação continuam pendentes de ambiente e autorização específica. Consulte README.md e docs/VALIDATION.md para execução e validação.

## Escopo e arquitetura

- Frontend: React com TypeScript, Vite, Tailwind CSS e componentes shadcn/ui.
- Backend: Express com TypeScript e validação de entradas com Zod.
- Persistência: Supabase PostgreSQL, Auth e Storage privado para PDFs.
- Visualização: PDF.js, com apresentação em páginas individuais.
- Estrutura: `apps/web`, `apps/api`, `supabase/migrations` e `docs`.
- Hospedagem será definida separadamente; deploy não está autorizado nem faz parte desta execução local.

O frontend usa o Supabase Auth para login e recuperação de senha. Envia o token de acesso ao Express, que valida a identidade e o estado ativo do usuário em cada requisição protegida. Consultas comuns usam a identidade do usuário para manter as políticas RLS do banco. Operações privilegiadas de gestão de usuários ficam restritas ao backend, com verificação de administrador. Chaves privilegiadas nunca entram no frontend ou em logs.

## Decisões de implementação

1. Cursos publicados têm versões imutáveis contendo PDF, quantidade de páginas, questões, alternativas, nota mínima e limite de tentativas. Alterações produzem um novo rascunho e uma nova versão ao publicar.
2. Cada atribuição vincula um gerente a uma versão específica. Publicar uma versão nova não reinicia atribuições nem invalida conclusões anteriores. Treinamento na nova versão exige nova atribuição explícita.
3. A desativação bloqueia chamadas protegidas, inclusive para sessões já abertas. Recuperação de senha utiliza mensagens genéricas e o fluxo do Supabase Auth.
4. PDFs ficam em bucket privado. O acesso depende da atribuição ou do perfil administrador; links assinados têm duração curta. Arquivar um curso impede novas atribuições, preservando histórico e acesso às atribuições existentes.
5. Uma página conta como visualizada após ser renderizada. Isso registra navegação, sem alegar comprovação de leitura ou atenção.
6. O progresso corresponde às páginas distintas visualizadas. A API valida que a página pertence à versão atribuída. Acesso inicial registra início; conclusão é um estado separado de atingir 100% das páginas.
7. Questionários ficam disponíveis somente após todas as páginas. Todas as questões têm uma resposta correta e peso igual. Nota percentual é calculada no servidor sem arredondamento para aprovação. Tentativa enviada consome o limite; o cliente não recebe gabaritos.
8. Após esgotar tentativas, a atribuição permanece em andamento, com indicação de limite atingido. Reabertura de tentativas não integra o escopo inicial.
9. Conclusão e submissão de tentativa usam operações transacionais, idempotência e controle de concorrência para impedir duplicações ou ultrapassar o limite de tentativas.
10. Datas são persistidas em UTC e apresentadas no fuso do usuário. CSV deve escapar campos e neutralizar fórmulas de planilha.
11. O painel contabiliza treinamentos por atribuição. Percentual de conclusão de um curso usa atribuições concluídas sobre todas as atribuições desse curso, incluindo suas versões; o relatório identifica a versão.

## Modelo de dados previsto

- `profiles`: identidade vinculada ao Auth, nome, papel e estado ativo.
- `courses`: identidade do curso e estado de publicação/arquivamento.
- `course_versions`: conteúdo e critérios de cada versão.
- `questions`: perguntas com alternativas em JSON por versão; `private.quiz_keys`: gabarito inacessível aos gerentes. Alternativas são uma lista pequena (2 a 6) e não precisam de entidade independente no MVP.
- `assignments`: gerente, versão atribuída, início e último slide.
- `slide_views`: páginas distintas vistas por atribuição.
- `quiz_attempts` e `quiz_answers`: tentativas, respostas e notas calculadas.
- `completions`: registro imutável por atribuição com data e versão.
- `audit_events`: eventos administrativos e de conclusão, com autor, alvo e horário, sem senhas ou tokens.

Migrações serão preparadas como arquivos revisáveis. Aplicação em banco depende de identificar um ambiente de desenvolvimento separado, confirmar permissões e receber autorização específica. Não serão acessadas credenciais reais por padrão.

## Etapas e critérios de aceite

1. Estrutura local, configuração de exemplo e scripts de desenvolvimento, lint, tipagem e testes.
2. Migrações e políticas: isolamento por gerente, administração restrita, proteção de histórico e armazenamento privado.
3. Login, recuperação de senha e gestão de gerentes ativos/inativos.
4. Cadastro, edição de rascunhos, publicação, arquivamento, upload de PDF, questionários e atribuições.
5. Área do gerente: cursos atribuídos, visualizador, retomada, progresso salvo e histórico.
6. Conclusão sem questionário mediante confirmação; conclusão com questionário mediante nota mínima, respeitando tentativas.
7. Painel com os três estados, filtros por gerente/curso/situação e exportação CSV.
8. Verificação dos critérios do levantamento, documentação de execução e relatório com resultados reais e pendências.

## Verificação proporcional ao risco

- TDD nas regras de progresso, nota, limite de tentativas, conclusão e preservação de versões.
- Testes de integração da API para autenticação, usuário inativo, restrição de administrador, acesso entre gerentes e validação de entradas.
- Testes no banco descartável para RLS, imutabilidade, transações e requisições concorrentes. Mocks não comprovam segurança das políticas reais.
- Fluxos de navegador: administrador publica e atribui; gerente retoma, conclui ou reprova; relatório e histórico refletem os resultados.
- Lint, análise de tipos e build de ambos os aplicativos.
- Dados sintéticos; nenhum teste contra produção. Verificações sem ambiente disponível serão marcadas como pendentes.

## Autorizações necessárias para executar

- Instalar e configurar dependências locais do frontend, backend e testes (Vitest, Supertest e Playwright).
- Implementar autenticação, autorização e tratamento dos dados de usuários exigidos pelo MVP, incluindo preparar SQL e políticas RLS para revisão.

Não inclui aplicar migrações em serviço remoto, criar recursos externos, acessar produção, fazer commits, push, PR, merge ou deploy. Essas operações exigem autorização própria.

## Riscos e pendências

- Ainda não há projeto Supabase de desenvolvimento identificado; a integração real dependerá dele ou de ambiente local descartável disponível.
- O primeiro administrador precisa de procedimento de provisionamento controlado, sem cadastro público de administradores.
- Recuperação de senha depende da configuração de redirecionamento e envio do Auth; notificações automáticas de treinamentos continuam fora do escopo.
- Limites de PDF, armazenamento, tráfego e hospedagem devem ser configurados e conferidos antes da publicação. Não há garantia de operação inteiramente gratuita.
- Repositório Git inexistente nesta pasta; nenhuma branch ou histórico foi criado.
