# Validação do produto

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

1. **Acesso:** entre como administrador, crie dois gerentes sintéticos e teste senha incorreta, recuperação e nova senha. Confirme que nenhum cadastro público oferece acesso ativo.
2. **Publicação:** crie um curso sem questionário, envie PDF de duas páginas, publique e atribua ao gerente A. O gerente B não deve listar o curso nem obter seu PDF, inclusive tentando a API diretamente.
3. **Progresso:** como A, abra o curso e confira “Em andamento”. Veja uma página, saia e retorne; o último slide e a contagem devem permanecer. Repetir uma página não deve aumentar a contagem.
4. **Conclusão simples:** veja todas as páginas; o treinamento deve continuar em andamento até confirmar. Confirme duas vezes/reenvie a requisição: deve existir apenas uma conclusão.
5. **Questionário:** publique outro curso com nota mínima 70 e limite de duas tentativas. Antes de ver todos os slides, questões e submissão devem ser bloqueadas. Reprove uma vez e aprove na segunda: notas, respostas, tentativas e conclusão devem persistir. Em outra atribuição, reprove duas vezes e confirme bloqueio da terceira.
6. **Versionamento:** crie e publique nova versão do curso concluído. A conclusão e o PDF anteriores devem permanecer vinculados à versão original. Atribuir a nova versão cria outro treinamento sem remover o anterior.
7. **Relatórios:** compare painel e relatório para os três estados. Filtre por gerente, curso e situação. Exporte CSV e confira versão, datas, percentual, quantidade de tentativas e notas.
8. **Inativação:** mantenha a sessão de A aberta e desative o perfil pelo administrador. Novas requisições de leitura, progresso, prova e obtenção de PDF devem falhar. O histórico deve continuar disponível ao administrador.
9. **Arquivamento:** arquive um curso. Novas atribuições ficam bloqueadas; atribuições existentes continuam acessíveis e o histórico é mantido.
10. **Rede e celular:** em largura de 390 px, navegue entre telas, abra o menu, leia os slides e responda a prova. Interrompa a rede no salvamento e confirme aviso e repetição sem duplicação.

## Critérios que dependem do ambiente

Recuperação de senha por e-mail, entrega e expiração de tokens, relacionamentos PostgREST, CORS real do Storage e publicação/hospedagem precisam ser homologados no ambiente escolhido. Testes locais com contratos simulados não confirmam esses serviços.

## Decisões de teste

TDD foi aplicado inicialmente aos estados, validação de rascunho e CSV: testes foram criados antes do módulo e falharam por módulo ausente; depois passaram com a implementação. As verificações de banco e navegador foram adicionadas após a implementação para testar fronteiras reais, concorrência e fluxo visual. Essa exceção foi adotada para validar a migração executável e a interface integrada, sem alegar um ciclo RED/GREEN anterior para todo o produto.

## Exclusão de gerente com histórico preservado

Após aplicar a migração `202610230005_delete_manager_auth.sql` no ambiente de desenvolvimento autorizado:

1. Em Gerentes, clique em Excluir e cancele: o cadastro deve permanecer. Confirme a exclusão: ele deve sair da lista, inclusive após recarregar.
2. Consulte Relatórios: atribuições, slides, tentativas, respostas e conclusões devem permanecer. O gerente continua disponível no filtro histórico.
3. Com uma sessão anterior do gerente, confirme a negação de novas requisições à API e aos PDFs. A edição via API não deve reativá-lo. A auditoria deve conter um evento `user.deleted`.

4. Confirmar que a conta desaparece de Authentication → Users no Supabase. Cadastrar novamente o mesmo e-mail: o novo gerente deve ter outro UUID e nenhum treinamento antigo. Os relatórios devem manter o histórico no perfil anterior.
5. Perfis excluídos anteriormente devem aparecer como “Exclusão pendente”, sem opção de editar. “Concluir exclusão” deve remover a conta do Auth. Se essa etapa falhar, deve haver erro e possibilidade de repetir, sem reativar acesso.

Os testes de navegador usam HTTP simulado; `supabase/tests/delete_manager.sql` e `supabase/tests/delete_manager_auth.sql` verificam preservação dos registros, restrição a administrador, idempotência, bloqueio de reativação, remoção da identidade Auth e isolamento do novo perfil no PostgreSQL descartável. O contrato mínimo de Auth não substitui a homologação do serviço real. A API usa a [operação administrativa deleteUser do Supabase](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) exclusivamente no backend.

## Exclusão de cursos

Após aplicação autorizada da migração `202610230004_delete_course_assignments.sql`, validar como administrador usando cursos sintéticos descartáveis:

1. Em Cursos, clicar em Excluir em um curso sem atribuições. Cancelar deve manter o curso; confirmar deve removê-lo e mostrar sucesso. Recarregar deve manter a exclusão.
2. Tentar excluir um curso atribuído, inclusive arquivado, sem marcar o checkbox: deve exibir bloqueio e preservar curso, versões e histórico. Marcar e cancelar deve manter os dados; reabrir deve mostrar o checkbox desmarcado.
3. Arquivar um curso atribuído: deve continuar disponível no filtro Arquivado e manter os treinamentos existentes.
4. Marcar “Apagar também as atribuições” e confirmar: deve remover curso e todo o progresso/histórico associado. Atualizar a tela do gerente e os relatórios: o curso deve desaparecer. Outros cursos devem permanecer.

Os testes `supabase/tests/delete_course.sql` e `supabase/tests/delete_course_assignments.sql` usam banco descartável, incluindo falha simulada ao registrar auditoria para verificar rollback integral. `scripts/test-db.mjs` também verifica a exclusão concorrente com atualização de progresso. Os testes de navegador usam respostas simuladas. PDFs de cursos excluídos permanecem no Storage para limpeza controlada posterior; cópias já baixadas não são revogadas.
# Limpeza global dos relatórios

Em ambiente descartável com dados sintéticos e a migração `202610230006_clear_reports.sql` aplicada:

1. Como administrador, abra Relatórios. Clique em “Limpar dados” ao lado de “Exportar CSV” e cancele: os registros devem permanecer.
2. Selecione um filtro, clique novamente e confirme. A confirmação avisa que **todos** os registros serão excluídos, inclusive fora dos filtros. Atualize relatório, painel e histórico do gerente: atribuições, progresso e conclusões devem desaparecer. Cursos e contas devem permanecer; confira o evento `reports.cleared` na auditoria.
3. Atribua novamente um curso e confira que começa sem progresso. Gerentes não podem executar a limpeza. Tanto no erro quanto no sucesso, o modal fecha e somente o toast informa o resultado. Em caso de falha, os registros permanecem. Em ambiente com `safeupdate`, aplique também a migração `202610230007_clear_reports_safeupdate.sql` antes da homologação.

Cobertura automatizada: `npm test`, `npm run test:e2e -- --grep "limpeza global|dashboard administrativo"` e `npm run test:db` (PostgreSQL Docker descartável, sem leitura de `.env`). O teste de banco verifica autorização, confirmação, exclusão, preservação do catálogo, rollback se a auditoria falhar e espera por progresso em andamento.

