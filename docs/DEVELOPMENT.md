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
5. Aplicar as migrações, pela ordem: `001_core_schema.sql`, `002_auth.sql`, `003_posting_controls.sql`, `004_entity_access.sql`, `005_reversal_controls.sql`, `006_login_rate_limit.sql` `007_accounting_documents.sql` `008_accounting_tasks.sql` e `009_monthly_close.sql`.
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
```
A partir da raiz do repositório, depois de instalar o cliente PostgreSQL e configurar a variável `DATABASE_URL`.

- O fecho mensal usa uma checklist padrão por período e só permite encerrar quando os itens obrigatórios estão concluídos, não existem lançamentos em rascunho e os débitos igualam os créditos.

## Verificações
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Segurança
- Não publicar `.env`, credenciais ou segredos de sessão.
- Usar uma `SESSION_SECRET` aleatória com pelo menos 32 caracteres.
- Usar HTTPS em produção e definir `DATABASE_SSL=true` quando a base de dados remota exigir TLS.
- O bootstrap recusa criar um utilizador quando o e-mail já existe; não é um mecanismo de recuperação de palavra-passe.
- O login limita tentativas falhadas por e-mail e endereço IP numa janela de 15 minutos; aplicar a migração `006_login_rate_limit.sql`. A identificação do IP depende dos cabeçalhos confiáveis do proxy/plataforma de alojamento.
- O arquivo documental aceita PDF, JPG, PNG, CSV, XLSX e DOCX até 8 MB, exige acesso à empresa e guarda os ficheiros em PostgreSQL; aplicar `007_accounting_documents.sql`.
- O módulo de tarefas mantém histórico de criação e actualizações, estados, prioridade e prazo; aplicar `008_accounting_tasks.sql`.
- Antes de produção, validar a política de retenção de auditoria, backups e ensaios de restauração.
- A API contabilística valida a associação à empresa, período aberto e contas movimentáveis; a confirmação exige igualdade entre débitos e créditos.
- O plano de contas disponibilizado é apenas uma estrutura inicial de referência e deve ser validado por um profissional antes de utilização contabilística real.
- O diário geral, o razão e o balancete incluem lançamentos confirmados e estornos formais; validar os totais com dados de teste antes de utilização produtiva.
- A página `/relatorios` disponibiliza balancete, balanço, demonstração de resultados, diário e razão por conta; a exportação é CSV. O balanço usa saldos acumulados até à data final e a demonstração de resultados usa o intervalo seleccionado.
- O balanço e a demonstração de resultados são uma primeira implementação técnica e devem ser reconciliados com saldos conhecidos antes de utilização oficial.
- O estorno cria um novo lançamento inverso num período aberto e preserva o original no histórico. Aplicar a migração `005_reversal_controls.sql` antes de usar a funcionalidade.

Estas instruções descrevem a configuração prevista; os comandos deverão ser executados num ambiente de desenvolvimento para confirmar a instalação. Não utilizar credenciais de exemplo em produção.
