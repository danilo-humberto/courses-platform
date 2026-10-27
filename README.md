# Cifra Academy — Treinamentos corporativos

MVP com React + TypeScript, Express, Supabase Auth/PostgreSQL/Storage e PDF.js. A interface está em português e se adapta a computadores e celulares.

## Funcionalidades

- Administrador: cadastrar/editar nome e ativação de usuários, excluir usuários preservando o histórico; criar rascunhos, enviar PDFs, configurar perguntas, publicar versões, arquivar e atribuir treinamentos.
- Usuário: autenticar, recuperar senha, navegar pelos slides, retomar o último slide, responder questionários e consultar o histórico.
- Progresso salvo após renderização do slide, com feedback e repetição em caso de erro de rede.
- Conclusão validada pelo PostgreSQL: todos os slides e confirmação, ou todos os slides e aprovação no questionário.
- Painel com estados de treinamento, conclusão por curso, filtros de auditoria e CSV com proteção contra fórmulas de planilha.
- Versões publicadas imutáveis; novas versões não alteram conclusões nem atribuições anteriores.

## Executar localmente

Requisitos: Node.js 22.13 ou superior e npm. Docker é necessário somente para os testes descartáveis de banco.

```powershell
npm ci
Copy-Item .env.example .env
```

Preencha `.env` **localmente**, usando um projeto Supabase de desenvolvimento separado. Não envie credenciais no chat. `SUPABASE_SECRET_KEY` é exclusiva do backend. Somente a URL pública e a chave `publishable` podem ter prefixo `VITE_`.

Consulte [a configuração do Supabase](docs/SUPABASE.md). A migração já foi aplicada ao projeto de desenvolvimento autorizado em 23/10/2026; não a reaplique nesse banco. `npm run dev` não executa migrações.

```powershell
npm run dev
```

- Interface: http://localhost:5173
- API: http://localhost:3001/api/health

Use `localhost` consistentemente para corresponder a `WEB_ORIGIN` e aos redirecionamentos do Auth. Sem variáveis de ambiente, `npm run dev:web` permite visualizar a página de entrada com aviso de configuração pendente; não existe login de demonstração nem bypass de autenticação.

## Verificações

```powershell
npm run lint
npm run typecheck
npm test
npm run test:db
npx playwright install chromium
npm run test:e2e
npm run build
```

`test:db` cria um PostgreSQL 17 descartável em Docker, com porta aleatória vinculada a `127.0.0.1`, dados sintéticos e contrato mínimo dos schemas Auth/Storage. Executa a migração e verifica RLS, RPCs, isolamento, conclusão, versionamento, armazenamento privado e concorrência. Encerra e remove o container ao finalizar. Nunca lê `.env` ou recebe URL de banco remoto.

Os testes Playwright usam o PDF.js real e respostas HTTP simuladas para a interface. Eles **não substituem** a homologação integrada de Supabase Auth, PostgREST, Storage e envio de recuperação de senha. Veja [a matriz e o roteiro de validação](docs/VALIDATION.md).

Para verificar também os arquivos de produção em navegador:

```powershell
$env:CIFRA_E2E_PREVIEW = '1'
npm run test:e2e
Remove-Item Env:CIFRA_E2E_PREVIEW
```

As capturas e rastros de falhas ficam em `test-results/`, ignorado pelo Git. O build desse teste usa configuração sintética; gere um novo build com a configuração do ambiente antes de qualquer publicação.

## Estrutura

| Local                 | Responsabilidade                                 |
| --------------------- | ------------------------------------------------ |
| `apps/web/src`        | Interface React, autenticação e visualizador     |
| `apps/api/src`        | API Express, autorização, validação e upload     |
| `supabase/migrations` | Tabelas, políticas RLS e operações transacionais |
| `supabase/tests`      | Contrato de testes e invariantes no PostgreSQL   |
| `scripts/test-db.mjs` | Banco local descartável e testes concorrentes    |
| `tests/e2e`           | Fluxos de navegador com dados sintéticos         |

## Regras importantes

- **Certificados opcionais:** marque “Gerar certificado ao concluir?” e clique em “Abrir prévia do certificado”. O modelo padrão fica em `assets/certificado-modelo.pdf` e é usado pelo servidor em todos os novos salvamentos. Na prévia, escolha CPF, curso, carga horária, data e código por checkboxes; nome é obrigatório. A prévia atualiza automaticamente com dados fictícios. Fechar ou Esc preserva as escolhas, salvas junto com o curso. Não há upload nem ajuste de posições. Certificados já emitidos mantêm seu modelo original. Execute a API a partir da raiz do projeto e inclua a pasta `assets` na distribuição. Textos longos reduzem a fonte até 8 pontos e podem ocupar até três linhas; caracteres incompatíveis são recusados.
- O modelo pertence à versão do curso e fica imutável após publicar. A conclusão oficial, inclusive por questionário, registra nome, CPF (somente se usado), curso, carga horária, data de conclusão em São Paulo e código UUID. O PDF é gerado no primeiro download e armazenado sem sobrescrita; falhas permitem nova tentativa sem desfazer a conclusão. Não há emissão retroativa para conclusões anteriores à ativação do recurso.
- “Baixar certificado” aparece na conclusão de cursos configurados; “Meu histórico” lista emissões mesmo após excluir o curso ou limpar relatórios. O participante ativo acessa somente seus certificados; administradores ativos têm acesso pela API. O bucket `certificate-pdfs` é privado e sem acesso direto do navegador. Arquivos e registros de certificados emitidos não entram na limpeza de relatórios; eventual remoção exige uma política específica futura.
- O recurso depende da migration `202610270004_certificates.sql`, aplicada em 27/10/2026 ao projeto de desenvolvimento `cifra courses`, após autorização explícita. Não reaplique nesse projeto. Outros ambientes exigem autorização específica; veja o registro em `docs/SUPABASE.md`. Não há nova dependência de pacote.

- **Cargos:** administradores podem cadastrar, consultar, editar e excluir cargos em `/cargos`, com nome único (sem diferenciar maiúsculas/minúsculas) e descrição opcional. Cada usuário tem no máximo um cargo. “Atribuir” permite selecionar até 200 usuários ativos por operação; uma nova atribuição substitui o cargo anterior apenas dos selecionados. O lote é transacional: qualquer usuário inválido impede a alteração inteira. Usuários já vinculados aparecem marcados; a busca mantém a seleção. O cargo aparece na lista de usuários e não altera permissões. Excluir exige confirmação, deixa os usuários sem aquele cargo e preserva contas, treinamentos e histórico. As operações são auditadas.
- Cargos requerem a migration `202610260001_job_positions.sql`, após as anteriores. Ela foi aplicada ao projeto de desenvolvimento autorizado em 26/10/2026; não a reaplique nesse banco. Consulte o registro em `docs/SUPABASE.md`. Outros ambientes exigem autorização específica. A gestão de usuários existente continua disponível antes da migration, mas o CRUD de cargos depende dela.

- A interface usa “Usuários” para os participantes da empresa. A gestão fica em `/usuarios`; o endereço antigo `/gerentes` redireciona para essa tela. O papel interno `manager`, os campos da API e as permissões existentes permanecem compatíveis nesta etapa de nomenclatura. Mensagens legadas do banco são adaptadas pela API para “usuário”.

- Ao abrir “Atribuir”, a plataforma consulta os vínculos da versão selecionada. Usuários ativos já vinculados aparecem marcados e identificados como “Já atribuído”; somente novos selecionados são enviados. Essa janela não remove atribuições. Se a consulta falhar, a seleção fica indisponível até tentar novamente com sucesso.

- Ações administrativas de criação, edição, exclusão, publicação, arquivamento e atribuição exibem um toast de sucesso; conclusão e envio de avaliações também recebem confirmação. Erros de operações, carregamento, autenticação e progresso exibem um toast vermelho e permanecem no formulário para correção. O toast pode ser fechado manualmente e desaparece após 6 segundos sem interação; erros em modais continuam visíveis e acessíveis acima do fundo da janela. Repetir uma ação que falha exibe o aviso novamente.

- O percentual mostra slides distintos, não aprovação. Ver 100% não conclui automaticamente cursos sem questionário.
- Cada questão tem uma alternativa correta e peso igual. A nota é comparada sem arredondamento; a interface arredonda somente a exibição.
- Uma atribuição possui limite próprio de tentativas. O limite não é reiniciado por atualização do curso.
- Uma nova versão exige novo PDF e nova atribuição explícita. Usuários com versões anteriores continuam acessando essas versões.
- Arquivar bloqueia novas atribuições; não apaga o histórico nem cancela atribuições existentes.
- Excluir curso exige confirmação. O checkbox “Apagar também as atribuições” vem desmarcado; sem ele, cursos atribuídos ficam protegidos. Marcado, a exclusão remove curso, versões, questões, atribuições, progresso, respostas e conclusões em uma única transação. O curso desaparece dos treinamentos e do histórico dos usuários após atualização da tela; requisições seguintes deixam de ter acesso. Arquivar preserva as atribuições e o histórico. A auditoria permanece e registra a exclusão. PDFs ficam no Storage para limpeza controlada posterior, assim como PDFs substituídos de rascunhos.
- A exclusão com atribuições requer a migração `202610230004_delete_course_assignments.sql`, após `202610230003_delete_course.sql`. Sua aplicação no ambiente exige autorização específica. Nenhuma migração remota é aplicada automaticamente.
- Questionários ficam bloqueados até visualizar todos os slides. Gabaritos são mantidos em schema privado e nunca retornados ao usuário.
- Contagem de páginas é obtida pelo backend. PDFs: até 20 MB, 500 páginas, sem criptografia por senha.
- Os PDFs são baixados integralmente antes de renderizar, para que um link assinado expirado não interrompa uma sessão longa. Um arquivo já baixado não pode ser revogado retroativamente.
- Desativar bloqueia novas requisições à API, banco e Storage, inclusive com token ainda válido. Não apaga informações já exibidas no navegador.
- Excluir usuário exige confirmação, desativa o perfil e remove a conta de login do Supabase Auth pelo backend, liberando o e-mail. Nome, e-mail e identidade histórica do perfil permanecem nos relatórios; um novo cadastro com o mesmo e-mail recebe outro identificador e não herda treinamentos. A edição comum não permite reativar cadastros excluídos.
- Banco e Auth são duas etapas: se a remoção do Auth falhar, o acesso fica desativado, o e-mail pode continuar reservado e a lista exibe “Exclusão pendente” para repetir a operação. Perfis excluídos pelo fluxo antigo também aparecem com essa indicação até concluir a remoção da conta. Nenhuma conta antiga é apagada automaticamente pela migração.
- A exclusão do Auth requer `202610230005_delete_manager_auth.sql`, após a migração de exclusão lógica `202610230002_delete_manager.sql`. A aplicação exige autorização específica do ambiente. A implementação local não aplica migrações ao Supabase automaticamente.
- A auditoria comprova navegação e cumprimento dos critérios; não comprova atenção ou leitura humana.
- Em Relatórios, “Limpar dados” exige confirmação e exclui **todas** as atribuições, visualizações, respostas, tentativas e conclusões, independentemente dos filtros. Os treinamentos também desaparecem do painel e do histórico dos usuários após atualização. Cursos, versões, PDFs, contas e eventos de auditoria permanecem; a operação registra `reports.cleared`. É possível atribuir os cursos novamente depois da limpeza.
- A limpeza requer `supabase/migrations/202610230006_clear_reports.sql`. Instalar a função não apaga dados; somente a confirmação pelo administrador executa a exclusão. A aplicação da migração no ambiente requer autorização específica e não é feita automaticamente.
- Em conexões com `safeupdate`, aplique também `202610230007_clear_reports_safeupdate.sql`: a exclusão usa condições pelos identificadores das atribuições, sem desativar a proteção. O modal fecha ao concluir a tentativa e o resultado aparece somente no toast, tanto no erro quanto no sucesso.

## Build e hospedagem

`npm run build` produz `dist/web` e `dist/api`. `npm start` inicia somente o Express, em loopback. A hospedagem precisa servir o frontend com fallback para `index.html`, encaminhar `/api` ao Express e configurar TLS, origem e URLs do Auth. O worker de PDF é um arquivo estático do build. Nenhuma infraestrutura ou deploy foi criado.

O MVP mantém consultas administrativas em memória; é adequado a equipes pequenas. O backend pagina as listas de usuários, cursos e atribuições para não truncar silenciosamente no limite padrão do Supabase. Em escala maior, relatórios devem migrar para agregações e exportação por lotes. PDFs substituídos de rascunhos não são apagados automaticamente: a limpeza de arquivos órfãos exige manutenção controlada, sem tocar em arquivos referenciados por versões publicadas.

## Cadastro e importação de funcionários

Pendências de limpeza bloqueiam o cadastro na interface e na API. O card “Com pendências” filtra a tabela; “Ignorar pendências”, ao lado de “Mostrar todos”, autoriza cadastrar somente os aptos. Os registros problemáticos continuam visíveis como ignorados. “Reconsiderar pendências” restaura o bloqueio, e trocar de arquivo descarta a escolha. Também é possível corrigir e reenviar a base.

A migration `202610270001_employee_import.sql` foi aplicada com autorização ao Supabase de desenvolvimento em 27/10/2026. Usuários aceita cadastro manual e importação CSV (até 8 MB e 10.000 registros), com prévia antes da confirmação. São mantidos Nome, E-mail de contato opcional, Estado extraído de `Cidade / UF`, CPF, Centro de Custo e Cargo Atual como função profissional. Registros com Data de desligamento preenchida são ignorados. CPF é obrigatório, normalizado para 11 dígitos; a limpeza verifica formato, não titularidade nem dígitos verificadores. Duplicações de CPF/e-mail no arquivo e no cadastro são informadas e não sobrescrevem pessoas. Dados inválidos ficam fora da importação; corrija o arquivo e reimporte. Os demais campos do CSV não são persistidos.

Todo novo cadastro tem papel interno `manager`, exibido como Funcionário, separado da função (`job_positions`). Inicialmente existe apenas o perfil, sem conta Auth ou senha. Admin e supremo geram a senha pela coluna Ações; somente então é criado o acesso interno `cpf@cifraengenharia.com.br`. O funcionário informa CPF sem pontuação e senha. O e-mail do RH continua sendo apenas contato. Contas antigas preservam login por e-mail e suas permissões.

A senha aleatória é exibida no modal e não fica armazenada em texto aberto na aplicação. Ao fechar, ela é descartada da interface. “Gerar nova senha” exige confirmação e substitui a anterior, permitindo recuperação administrativa inclusive após perda de resposta. A recuperação por e-mail não se aplica aos endereços técnicos de CPF. Redefinição é restrita a funcionários ativos com CPF; contas administrativas não podem ser alvo. Uma autorização de uso único é conferida no banco durante a transação do Auth, incluindo mudança concorrente de papel.

## Referências de implementação

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — Database functions](https://supabase.com/docs/guides/database/functions)
- [PDF.js — Exemplos oficiais](https://mozilla.github.io/pdf.js/examples/)
