# Validação do produto

## Funcionários, importação CSV e acesso por CPF — 27/10/2026

Baseline antes da alteração: `npm test`, 59 testes aprovados. A etapa RED do parser falhou por módulo ainda inexistente; após implementação, os cinco testes de limpeza passaram. A primeira suíte E2E encontrou status incorreto ao desativar funcionário sem senha, além de seletores/textos antigos; o status foi corrigido preservando a expectativa de desativação, e os textos foram ajustados ao requisito de função separada do cargo. A suíte completa seguinte passou em 30 cenários. A revisão independente identificou recuperação de senha ausente e mensagem de PDF em upload CSV; ambas receberam correções e testes específicos.

Verificações finais: `npm test` (74 testes), `npm run test:db` (PostgreSQL 17 descartável, incluindo importação, autorização, vínculo Auth, redefinição, rollback após promoção e token não reutilizável), `npm run build` (inclui tipagem) e `npm run lint` aprovados. Build mantém aviso de bundle acima de 500 kB. A migration foi posteriormente aplicada com autorização em 27/10/2026; estrutura e permissões foram verificadas no ambiente de desenvolvimento. A geração real de senha e a importação real não foram executadas.

Após a correção de recuperação, a execução final de `npm run test:e2e` teve **30 aprovações e um timeout** no cenário antigo “questionário reprova e depois conclui com aprovação”, aguardando “Progresso salvo”. Todos os cenários novos passaram, inclusive resposta perdida seguida de redefinição explícita. O trace mostrou worker PDF com resposta 200 em aproximadamente 3,8 s, gravação `/views` com 200 e consulta posterior com 200; o snapshot ainda mostrava “Salvando progresso”. `Training.tsx` não foi alterado nesta tarefa. O resultado é compatível com a instabilidade de PDF já registrada abaixo, mas a causa exata permanece pendente. Não houve retry para apresentar a suíte global como aprovada. Evidências em `test-results/`, incluindo trace do questionário e captura `employee-import.png` da importação com dados sintéticos.

A revisão independente em leitura aceitou as duas correções apontadas e não identificou novo bloqueio no fluxo de funcionários. A validação global mantém a ressalva E2E acima; o GoTrue instalado foi identificado como v2.197.0 e seu código transacional foi conferido antes da aplicação.

Inspeção local somente leitura do CSV informado, sem persistir dados pessoais no repositório: 4.473 registros, 3.736 desligados ignorados, 737 sem desligamento; 735 aptos após a limpeza e dois com duplicação (um CPF e um e-mail). Há 343 e-mails vazios entre os 737. A confirmação ainda verificará duplicações contra o banco de destino; não foi feita importação real.

Validação manual após aplicação autorizada em desenvolvimento:

1. Como admin, cadastrar pessoa sintética com CPF e e-mail vazio: conferir Funcionário, função separada e Sem senha.
2. Importar CSV sintético com desligado, CPF duplicado, e-mail vazio e cidade/UF: conferir prévia, exclusões e resultados. Reimportar não deve duplicar nem atualizar pessoas.
3. Gerar senha, entrar com CPF sem pontuação e conferir o acesso de funcionário. Fechar o modal descarta a senha da interface.
4. Gerar nova senha com confirmação: conferir login com a nova, recusa da anterior e ausência da ação em administradores.
5. Desativar/excluir funcionário e conferir bloqueio de acesso e preservação do histórico. Conferir login por e-mail de admin/supremo legados.

## Testes reproduzíveis

| Comando             | O que verifica                                                                                                          | Limite da evidência                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm test`          | Estados, validação de rascunhos, CSV, autenticação obrigatória e negação de rotas administrativas                       | Integrações externas são simuladas                         |
| `npm run test:db`   | Migração real, RLS, regras de slides, provas, histórico, inativação, Storage e concorrência                             | Schemas Auth/Storage mínimos; não inicia serviços Supabase |
| `npm run test:e2e`  | Interface, PDF.js real, retomada, conclusão, aprovação/reprovação, cadastro, upload com repetição, CSV e responsividade | HTTP e sessão Auth simulados; somente Chromium             |
| `npm run lint`      | Regras ESLint/TypeScript                                                                                                | Não substitui revisão                                      |
| `npm run typecheck` | Tipagem estrita                                                                                                         | Não valida configuração remota                             |
| `npm run build`     | Compilação de frontend, worker PDF e API                                                                                | Não publica a aplicação                                    |

Os testes usam e-mails `example.test` e dados sintéticos. O teste do banco não aceita uma URL externa e encerra seu container após a execução. O build de produção também pode ser testado pelo Playwright usando `CIFRA_E2E_PREVIEW=1`.

## Roteiro de homologação integrada

Preparação: projeto Supabase de desenvolvimento aprovado, migração aplicada pelo responsável, primeiro administrador provisionado e `.env` preenchido localmente.

1. **Acesso:** entre como administrador, crie dois usuários sintéticos e teste senha incorreta, recuperação e nova senha. Confirme que nenhum cadastro público oferece acesso ativo.
2. **Publicação:** crie um curso sem questionário, envie PDF de duas páginas, publique e atribua ao usuário A. O usuário B não deve listar o curso nem obter seu PDF, inclusive tentando a API diretamente.
3. **Progresso:** como A, abra o curso e confira “Em andamento”. Veja uma página, saia e retorne; o último slide e a contagem devem permanecer. Repetir uma página não deve aumentar a contagem.
4. **Conclusão simples:** veja todas as páginas; o treinamento deve continuar em andamento até confirmar. Confirme duas vezes/reenvie a requisição: deve existir apenas uma conclusão.
5. **Questionário:** publique outro curso com nota mínima 70 e limite de duas tentativas. Antes de ver todos os slides, questões e submissão devem ser bloqueadas. Reprove uma vez e aprove na segunda: notas, respostas, tentativas e conclusão devem persistir. Em outra atribuição, reprove duas vezes e confirme bloqueio da terceira.
6. **Versionamento:** crie e publique nova versão do curso concluído. A conclusão e o PDF anteriores devem permanecer vinculados à versão original. Atribuir a nova versão cria outro treinamento sem remover o anterior.
7. **Relatórios:** compare painel e relatório para os três estados. Filtre por usuário, curso e situação. Exporte CSV e confira versão, datas, percentual, quantidade de tentativas e notas.
8. **Inativação:** mantenha a sessão de A aberta e desative o perfil pelo administrador. Novas requisições de leitura, progresso, prova e obtenção de PDF devem falhar. O histórico deve continuar disponível ao administrador.
9. **Arquivamento:** arquive um curso. Novas atribuições ficam bloqueadas; atribuições existentes continuam acessíveis e o histórico é mantido.
10. **Rede e celular:** em largura de 390 px, navegue entre telas, abra o menu, leia os slides e responda a prova. Interrompa a rede no salvamento e confirme aviso e repetição sem duplicação.

## Critérios que dependem do ambiente

Recuperação de senha por e-mail, entrega e expiração de tokens, relacionamentos PostgREST, CORS real do Storage e publicação/hospedagem precisam ser homologados no ambiente escolhido. Testes locais com contratos simulados não confirmam esses serviços.

## Decisões de teste

TDD foi aplicado inicialmente aos estados, validação de rascunho e CSV: testes foram criados antes do módulo e falharam por módulo ausente; depois passaram com a implementação. As verificações de banco e navegador foram adicionadas após a implementação para testar fronteiras reais, concorrência e fluxo visual. Essa exceção foi adotada para validar a migração executável e a interface integrada, sem alegar um ciclo RED/GREEN anterior para todo o produto.

## Cargos e atribuição em lote

Após aplicação autorizada de `202610260001_job_positions.sql` em desenvolvimento:

1. Como administrador, abra Cargos, cadastre “Analista” e “Engenheiro” e edite nome/descrição. Nomes duplicados, inclusive com diferenças de maiúsculas ou espaços nas pontas, devem ser recusados.
2. Em Atribuir, selecione dois usuários ativos e confirme. Reabra: ambos devem aparecer marcados como “Já atribuído”. Confira o cargo na lista de Usuários.
3. Atribua o outro cargo a apenas um deles. O cargo anterior deve ser substituído somente para esse usuário. Filtrar a lista durante a seleção não deve apagar os selecionados.
4. Cancele uma exclusão e confirme que nada mudou; depois confirme. Usuários vinculados ficam sem cargo; contas e treinamentos permanecem.
5. Desative um usuário entre abrir a seleção e confirmar. O lote deve falhar sem atualizar nenhum usuário. Uma falha na consulta deve permitir tentar novamente, sem mostrar dados antigos como atuais.
6. Como usuário comum, confirme ausência do menu Cargos e negação das rotas administrativas. O cargo nunca concede privilégios. Confira eventos `job.created`, `job.updated`, `job.deleted` e `user.job_assigned` na auditoria.

## Exclusão de usuário com histórico preservado

Após aplicar a migração `202610230005_delete_manager_auth.sql` no ambiente de desenvolvimento autorizado:

1. Em Usuários, clique em Excluir e cancele: o cadastro deve permanecer. Confirme a exclusão: ele deve sair da lista, inclusive após recarregar.
2. Consulte Relatórios: atribuições, slides, tentativas, respostas e conclusões devem permanecer. O usuário continua disponível no filtro histórico.
3. Com uma sessão anterior do usuário, confirme a negação de novas requisições à API e aos PDFs. A edição via API não deve reativá-lo. A auditoria deve conter um evento `user.deleted`.

4. Confirmar que a conta desaparece de Authentication → Users no Supabase. Cadastrar novamente o mesmo e-mail: o novo usuário deve ter outro UUID e nenhum treinamento antigo. Os relatórios devem manter o histórico no perfil anterior.
5. Perfis excluídos anteriormente devem aparecer como “Exclusão pendente”, sem opção de editar. “Concluir exclusão” deve remover a conta do Auth. Se essa etapa falhar, deve haver erro e possibilidade de repetir, sem reativar acesso.

Os testes de navegador usam HTTP simulado; `supabase/tests/delete_manager.sql` e `supabase/tests/delete_manager_auth.sql` verificam preservação dos registros, restrição a administrador, idempotência, bloqueio de reativação, remoção da identidade Auth e isolamento do novo perfil no PostgreSQL descartável. O contrato mínimo de Auth não substitui a homologação do serviço real. A API usa a [operação administrativa deleteUser do Supabase](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) exclusivamente no backend.

## Exclusão de cursos

Após aplicação autorizada da migração `202610230004_delete_course_assignments.sql`, validar como administrador usando cursos sintéticos descartáveis:

1. Em Cursos, clicar em Excluir em um curso sem atribuições. Cancelar deve manter o curso; confirmar deve removê-lo e mostrar sucesso. Recarregar deve manter a exclusão.
2. Tentar excluir um curso atribuído, inclusive arquivado, sem marcar o checkbox: deve exibir bloqueio e preservar curso, versões e histórico. Marcar e cancelar deve manter os dados; reabrir deve mostrar o checkbox desmarcado.
3. Arquivar um curso atribuído: deve continuar disponível no filtro Arquivado e manter os treinamentos existentes.
4. Marcar “Apagar também as atribuições” e confirmar: deve remover curso e todo o progresso/histórico associado. Atualizar a tela do usuário e os relatórios: o curso deve desaparecer. Outros cursos devem permanecer.

Os testes `supabase/tests/delete_course.sql` e `supabase/tests/delete_course_assignments.sql` usam banco descartável, incluindo falha simulada ao registrar auditoria para verificar rollback integral. `scripts/test-db.mjs` também verifica a exclusão concorrente com atualização de progresso. Os testes de navegador usam respostas simuladas. PDFs de cursos excluídos permanecem no Storage para limpeza controlada posterior; cópias já baixadas não são revogadas.

# Limpeza global dos relatórios

Em ambiente descartável com dados sintéticos e a migração `202610230006_clear_reports.sql` aplicada:

1. Como administrador, abra Relatórios. Clique em “Limpar dados” ao lado de “Exportar CSV” e cancele: os registros devem permanecer.
2. Selecione um filtro, clique novamente e confirme. A confirmação avisa que **todos** os registros serão excluídos, inclusive fora dos filtros. Atualize relatório, painel e histórico do usuário: atribuições, progresso e conclusões devem desaparecer. Cursos e contas devem permanecer; confira o evento `reports.cleared` na auditoria.
3. Atribua novamente um curso e confira que começa sem progresso. Usuários não podem executar a limpeza. Tanto no erro quanto no sucesso, o modal fecha e somente o toast informa o resultado. Em caso de falha, os registros permanecem. Em ambiente com `safeupdate`, aplique também a migração `202610230007_clear_reports_safeupdate.sql` antes da homologação.

Cobertura automatizada: `npm test`, `npm run test:e2e -- --grep "limpeza global|dashboard administrativo"` e `npm run test:db` (PostgreSQL Docker descartável, sem leitura de `.env`). O teste de banco verifica autorização, confirmação, exclusão, preservação do catálogo, rollback se a auditoria falhar e espera por progresso em andamento.

### Validação da conta suprema

Testes automatizados usam somente identidades sintéticas e PostgreSQL descartável: `npm test`, `npm run test:db` e `npx playwright test -g "conta suprema|admin comum"`. Cobrem recusa para usuário/admin comum, promoção pela suprema, exclusividade, RLS, auditoria, relatório JSON/CSV com perfil oculto e confirmação na interface.

Após aplicação autorizada da migration em desenvolvimento:

1. Entrar novamente como GTI: conferir “Conta suprema” e a ação “Tornar administrador” em um participante sintético ativo. Cancelar deve preservar o papel; confirmar deve mostrar “Administrador”.
2. Entrar como o admin promovido: conferir os módulos administrativos, ausência do botão de promoção e das outras contas administrativas em Usuários.
3. Promover um participante sintético com histórico: conferir que relatórios/CSV continuam funcionando para outro admin e que o histórico permanece disponível para GTI.

A migration foi aplicada com autorização em 26/10/2026 no projeto de desenvolvimento conectado. Foram confirmadas a exclusividade da GTI, a auditoria, as permissões e a identificação “Conta suprema” com ação de promoção na interface. A promoção real de outra conta e o login como esse novo admin não foram executados; esses fluxos seguem cobertos pelos testes locais com dados sintéticos.

Resultado local em 26/10/2026: 59 testes de API/domínio aprovados, testes SQL aprovados, build/tipagem/lint aprovados e revisão independente sem apontamentos pendentes após corrigir relatórios com perfil oculto. A suíte E2E completa teve 26 aprovações e uma falha por timeout no carregamento inicial de PDF; o trace mostrou carregamento demorado do worker no Vite. O teste de PDF passou isoladamente, mas isso não elimina a instabilidade observada. Os dois cenários novos de conta suprema passaram tanto isolados quanto na suíte completa. A validação global E2E permanece com essa ressalva; não houve alteração no leitor de PDF.

## Filtros e seleção em lote de cursos

Validar na janela Atribuir: modal mais largo; Nome e Centro de custo em largura total; Estado, Cargo e Função lado a lado em desktop e empilhados em telas pequenas. Cargo usa o cadastro de cargos; Função usa valores únicos de usuários ativos elegíveis, após aplicar a migration de separação.

Combinar nome, estado, cargo, função e centro de custo; selecionar um usuário, trocar filtros e clicar Selecionar tudo. Apenas resultados elegíveis ainda não atribuídos devem ser adicionados, sem perder seleções anteriores. Usuários já atribuídos continuam bloqueados; limpar filtros não limpa a seleção. Nenhuma atribuição é enviada até clicar Atribuir.

Verificações automatizadas: testes de filtros/seleção e importação; typecheck; lint; banco local descartável via `npm run test:db`. Migration aplicada e conferida no ambiente de desenvolvimento em 27/10/2026; validação visual dos filtros pendente.

## Validação para commit — 27/10/2026

Executados npm test (80 testes aprovados), npm run build (aprovado, aviso de bundle acima de 500 kB), npm run lint e npm run test:db (PostgreSQL descartável; todas as verificações aprovadas). A primeira execução E2E terminou com 32 aprovados e 3 falhas de atribuição: a fixture não respondia ao novo GET /admin/jobs. Adicionada resposta sintética vazia, preservando todas as asserções, e reexecutados os três casos afetados.
Resultado da reexecução: 3/3 aprovados; typecheck e lint também aprovados após a correção da fixture.

# Validação de certificados opcionais

A migration `202610270004_certificates.sql` foi aplicada em 27/10/2026 ao projeto de desenvolvimento `cifra courses`, após autorização explícita. A estrutura e as permissões foram conferidas por consultas somente leitura; a homologação integrada do fluxo abaixo permanece pendente. Não reaplique nesse projeto. Outros ambientes exigem autorização específica.

1. Criar um curso e marcar “Gerar certificado ao concluir?”. Deve aparecer apenas o botão de largura total “Abrir prévia do certificado”, sem abrir o modal automaticamente. Abrir a prévia, desmarcar CPF e verificar que o texto e o rótulo desaparecem. Repetir com data, curso, carga horária e código; nome continua obrigatório. Ajustar a carga horária, baixar a prévia e conferir o modelo padrão sem rodapé de demonstração. Fechar com Esc e reabrir: escolhas, título, descrição e apresentação devem continuar preservados. Salvar/publicar pertence ao formulário do curso. Simular falha na prévia: mostrar erro e “Tentar novamente”, sem permitir baixar conteúdo desatualizado.
2. Publicar e atribuir a um participante sintético. Antes da conclusão não deve haver certificado. Concluir por confirmação ou aprovação no questionário e baixar o PDF. CPF ausente deve omitir o rótulo; curso sem certificado deve manter o comportamento anterior.
3. Alterar nome do participante após concluir e baixar novamente: arquivo e dados devem permanecer iguais. Outro participante e usuário inativo não podem acessar a emissão. Em ambiente descartável, excluir o curso ou limpar relatórios: a emissão continua em “Meu histórico”.

Cobertura automatizada: `certificates.test.ts` (PDF/configuração), `certificates-api.test.ts` (API/Storage simulados), `supabase/tests/certificates.sql` (PostgreSQL descartável, autorização e preservação), cenários “certificado:” em `tests/e2e/app.spec.ts` (PDF.js real, API simulada). Os testes de navegador não substituem homologação de Storage/Auth reais.

## Teste integrado isolado de certificado — 27/10/2026

Executado `node --import tsx scripts/test-certificate-flow.mjs`: cria um PostgreSQL 17 descartável no Docker, confirma banco e papel da conexão, aplica as migrations e usa a API Express real com RPCs e RLS reais. Não lê `.env` nem conecta ao Supabase remoto. Auth é sintética e Storage fica em memória; portanto, não substitui homologação de Auth/Storage hospedados.

Resultado: curso sintético criado, publicado e atribuído; conclusão bloqueada antes de visualizar os slides; conclusão repetida produz uma única emissão; participante baixa PDF com nome, curso, carga horária, data e código corretos, sem CPF desmarcado. Outro participante não lista nem baixa a emissão; usuário desativado recebe 403. Após alteração do nome e exclusão do curso, o histórico permanece e o download é idêntico byte a byte. O contêiner foi removido e sua ausência confirmada ao término.

Evidências locais: `output/certificate-isolated-test/resultado.json`, `certificado-recebido.pdf` e renderização PNG na mesma pasta. O arquivo é sintético e não corresponde a uma emissão no Supabase atual.

## Conferência antes do commit de certificados — 27/10/2026

- `npm test`: 96 testes aprovados. `npm run build` e `npm run lint`: aprovados; permanece o aviso de bundle acima de 500 kB.
- `npm run test:e2e`: 37/39 aprovados. Dois cenários (PDF e questionário) expiraram aguardando o worker PDF no servidor Vite de desenvolvimento; o trace mostra a requisição do worker sem resposta. Reexecutados no build de produção com `CIFRA_E2E_PREVIEW=1` e um worker: 2/2 aprovados. A instabilidade do ambiente de desenvolvimento não está considerada resolvida.
- `npm run test:db`: a nova tentativa não executou as migrations/testes, pois o Docker retornou erro 500 ao criar o contêiner `cifra-test-33ee9813`. Não houve conexão com o Supabase atual. A evidência anterior do fluxo integrado isolado permanece válida, mas não equivale a uma aprovação desta nova tentativa.
- Modelo final conferido visualmente: logo à esquerda do nome da empresa, bloco do treinamento elevado e assinatura somente com “Cifra Engenharia e Serviços LTDA”. PDF no índice Git comparado byte a byte com o arquivo local; atributo binário impede conversão de quebras de linha. Saídas geradas e rastros temporários ficam ignorados em `output/` e `tmp/`.
