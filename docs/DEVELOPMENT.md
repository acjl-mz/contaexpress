# Desenvolvimento local

## Requisitos
- Node.js LTS compatível com Next.js 15.
- npm.
- Docker Desktop ou Docker Engine com Docker Compose.

## Preparar o ambiente
1. Copiar `.env.example` para `.env` e substituir as credenciais de exemplo.
2. Gerar uma chave de sessão com pelo menos 32 caracteres aleatórios e defini-la em `SESSION_SECRET`.
3. Instalar dependências com `npm install`.
4. Iniciar PostgreSQL com `docker compose up -d db`.
5. Aplicar as migrações, pela ordem: `001_core_schema.sql`, `002_auth.sql`, `003_posting_controls.sql`, `004_entity_access.sql`, `005_reversal_controls.sql`, `006_login_rate_limit.sql` `007_accounting_documents.sql` `008_accounting_tasks.sql` e `009_monthly_close.sql` e `010_password_reset.sql` e `011_treasury_tax.sql`.
6. Criar o administrador inicial definindo `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` e, opcionalmente, `ADMIN_ORGANISATION` no ambiente. A palavra-passe deve ter pelo menos 14 caracteres. Executar `npm run bootstrap:admin` uma única vez.
7. Iniciar a aplicação com `npm run dev`.
8. Abrir `http://localhost:3000/login` e entrar com as credenciais criadas.

## Migrações
Aplicar os ficheiros SQL com um cliente PostgreSQL, por exemplo:
```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_core_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/002_auth.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/003_posting_controls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/004_entity_access.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/005_reversal_controls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/006_login_rate_limit.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/007_accounting_documents.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/008_accounting_tasks.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/009_monthly_close.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/010_password_reset.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/011_treasury_tax.sql
```
A partir da raiz do repositório, depois de instalar o cliente PostgreSQL e configurar a variável `DATABASE_URL`.

- O fecho mensal usa uma checklist padrão por período e só permite encerrar quando os itens obrigatórios estão concluídos, não existem lançamentos em rascunho e os débitos igualam os créditos.

## Preparação para produção
- Seguir a checklist em `docs/PRODUCTION_READINESS.md` antes de disponibilizar o sistema a utilizadores reais.
- O workflow de backup cifrado está inactivo até definir a variável de repositório `BACKUP_ENABLED=true`; sem os segredos de acesso e cifragem, não existe cópia externa automática.

## Verificações
- `npm run test:unit` — testes puros de validação de datas, cálculos dos relatórios e geração estrutural de PDF.
- `npm run test:all` — executa primeiro todos os testes unitários e depois os testes de integração PostgreSQL, incluindo a confirmação concorrente de um lançamento.
- `npm run test:integration` — testes PostgreSQL de lançamentos, relatórios, estornos, permissões, isolamento multempresa e idempotência do fecho mensal; requer `DATABASE_URL` e todas as migrações aplicadas. As suites criam dados de teste em transacções e revertem-nos no final.
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run backup:db` — cria backup PostgreSQL em formato customizado, checksum SHA-256 e metadados; requer `pg_dump`, `pg_restore` e `DATABASE_URL`.
- `RESTORE_DATABASE_URL=... RESTORE_CONFIRM=YES_RESTORE_DATABASE npm run restore:db -- ./backups/ficheiro.dump` — restaura para a base explicitamente indicada, verifica checksum e exige confirmação explícita. Nunca aponte para a base de produção sem plano de recuperação aprovado.
- `RESTORE_DATABASE_URL=... npm run verify:db-restore` — verifica a presença das tabelas essenciais e estrutura mínima depois da restauração. O CI executa um ensaio de backup/restauro numa base de dados descartável.

## Recuperação de palavra-passe
- Configurar `APP_BASE_URL`, `RESEND_API_KEY` e `RESEND_FROM_EMAIL` para activar o envio de links de recuperação através da API Resend. O endpoint responde sempre com uma mensagem genérica para não revelar se o e-mail existe.
- Os links expiram em 30 minutos, são de uso único e o token é armazenado apenas como hash. A redefinição incrementa `session_version`, invalidando sessões anteriores. Aplicar a migração `010_password_reset.sql`.

## Segurança
- Não publicar `.env`, credenciais ou segredos de sessão.
- Usar uma `SESSION_SECRET` aleatória com pelo menos 32 caracteres.
- Usar HTTPS em produção e definir `DATABASE_SSL=true` quando a base de dados remota exigir TLS.
- O bootstrap recusa criar um utilizador quando o e-mail já existe; não é um mecanismo de recuperação de palavra-passe.
- O login limita tentativas falhadas por e-mail e endereço IP numa janela de 15 minutos; aplicar a migração `006_login_rate_limit.sql`. A identificação do IP depende dos cabeçalhos confiáveis do proxy/plataforma de alojamento.
- O arquivo documental aceita PDF, JPG, PNG, CSV, XLSX e DOCX até 8 MB, exige acesso à empresa e guarda os ficheiros em PostgreSQL; aplicar `007_accounting_documents.sql`.
- O módulo de tarefas mantém histórico de criação e actualizações, estados, prioridade e prazo; aplicar `008_accounting_tasks.sql`.
- O backup utiliza `pg_dump` em formato customizado e gera checksum SHA-256 e metadados. Opcionalmente, `BACKUP_GPG_RECIPIENT` cifra o ficheiro com GPG; `BACKUP_REMOTE` envia apenas backups cifrados com `rclone`; `BACKUP_RETENTION_DAYS` define a retenção remota (por omissão, 30 dias). Configure uma chave GPG de recuperação fora do servidor de aplicação e teste a desencriptação. O workflow `.github/workflows/database-backup.yml` agenda o backup diariamente às 02:17 UTC. Para o activar, defina a variável de repositório `BACKUP_ENABLED=true` e os segredos `DATABASE_URL`, `BACKUP_GPG_PUBLIC_KEY`, `BACKUP_GPG_RECIPIENT`, `BACKUP_REMOTE` e `RCLONE_CONFIG_BASE64` (configuração `rclone` codificada em Base64). O workflow não envia cópias sem cifragem; faça um ensaio de desencriptação e restauração antes de activar a rotina.
- Antes de produção, definir agendamento, retenção, armazenamento externo cifrado, alertas de falha e RPO/RTO; realizar ensaios de restauração periódicos num destino isolado.
- A API contabilística valida a associação à empresa, período aberto e contas movimentáveis; a confirmação exige igualdade entre débitos e créditos.
- O plano de contas disponibilizado é apenas uma estrutura inicial de referência e deve ser validado por um profissional antes de utilização contabilística real.
- O diário geral, o razão e o balancete incluem lançamentos confirmados e estornos formais; validar os totais com dados de teste antes de utilização produtiva.
- Os cálculos de balancete, demonstração de resultados e balanço estão isolados em funções puras testáveis em `lib/accounting/report-calculations.mjs`; os testes unitários cobrem totais e equação contabilística com dados controlados. Os testes unitários não substituem a integração com PostgreSQL.
- A página `/relatorios` disponibiliza balancete, balanço, demonstração de resultados, diário e razão por conta; a exportação está disponível em CSV e PDF gerado no servidor. O balanço usa saldos acumulados até à data final e a demonstração de resultados usa o intervalo seleccionado.
- O balanço e a demonstração de resultados são uma primeira implementação técnica e devem ser reconciliados com saldos conhecidos antes de utilização oficial.
- O estorno cria um novo lançamento inverso num período aberto e preserva o original no histórico. Aplicar a migração `005_reversal_controls.sql` antes de usar a funcionalidade.

Estas instruções descrevem a configuração prevista; os comandos deverão ser executados num ambiente de desenvolvimento para confirmar a instalação. Não utilizar credenciais de exemplo em produção.

 
## Tesouraria e fiscalidade
- Aplicar a migração `011_treasury_tax.sql` depois das migrações 001–010.
- `/tesouraria` permite registar contas de caixa/banco/carteira móvel, movimentos de entrada/saída e marcar movimentos como reconciliados. O movimento líquido é apenas um total dos movimentos registados; não equivale ao saldo real de caixa/banco nem inclui automaticamente o saldo inicial.
- `/fiscalidade` mantém um calendário manual de obrigações fiscais e estados de preparação, submissão e pagamento. Os tipos disponíveis incluem IVA, IRPS, IRPC, ISPC, INSS e outros.
- Estes módulos não geram ainda lançamentos contabilísticos automáticos, não calculam impostos nem submetem declarações. A aplicação de taxas e prazos deve ser validada face à legislação e às instruções vigentes em Moçambique.


## Integração de Tesouraria com Contabilidade
- Aplicar as migrações `011_treasury_tax.sql` e `012_treasury_accounting_integration.sql` depois das migrações 001–010.
- Em `/tesouraria`, configure um mapeamento por conta de tesouraria, direcção (entrada/saída) e categoria. Associe uma conta do razão para tesouraria e uma conta de contrapartida; ambas devem pertencer à mesma empresa e permitir movimentos.
- A acção **Preparar lançamento** cria um rascunho no diário geral, usando o período aberto que contém a data do movimento. Para entradas, debita a conta de tesouraria e credita a contrapartida; para saídas, faz o inverso.
- O movimento guarda o identificador do lançamento e uma referência de origem única, para que repetição do pedido não crie um segundo lançamento. O rascunho não é confirmado automaticamente: um contabilista autorizado deve revê-lo e confirmá-lo no diário geral.
- Se não houver mapeamento, diário geral ou período aberto, a API devolve um erro de validação em vez de criar um lançamento incompleto.


## Reconciliação bancária assistida
- Aceder a /tesouraria/reconciliacao ou usar o atalho na Tesouraria.
- Importar CSV de uma conta bancária activa. Cabeçalhos aceites: data (date/data), descrição (description/descricao), valor (amount/valor); referência e direcção são opcionais. Datas aceites: AAAA-MM-DD ou DD/MM/AAAA; valores negativos são saídas e positivos entradas, excepto quando a direcção está explicitamente indicada.
- Limites actuais: 5 MB por ficheiro e 1.000 linhas por importação. A importação guarda o ficheiro, as linhas e um evento de auditoria; não cria movimentos de tesouraria automaticamente.
- O sistema sugere movimentos da mesma conta com o mesmo valor e sentido, até três dias de diferença e sem conflito de referência. A confirmação é manual, transaccional e impede que um movimento seja associado a duas linhas.
- Linhas sem correspondência permanecem pendentes para investigação. Não se devem reconciliar divergências apenas para limpar a lista.
