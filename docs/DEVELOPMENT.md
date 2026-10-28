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
5. Aplicar as migrações, pela ordem: `database/migrations/001_core_schema.sql` e `database/migrations/002_auth.sql`.
6. Criar o administrador inicial definindo `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` e, opcionalmente, `ADMIN_ORGANISATION` no ambiente. A palavra-passe deve ter pelo menos 14 caracteres. Executar `npm run bootstrap:admin` uma única vez.
7. Iniciar a aplicação com `npm run dev`.
8. Abrir `http://localhost:3000/login` e entrar com as credenciais criadas.

## Migrações
Aplicar os ficheiros SQL com um cliente PostgreSQL, por exemplo:
```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_core_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/002_auth.sql
```
A partir da raiz do repositório, depois de instalar o cliente PostgreSQL e configurar a variável `DATABASE_URL`.

## Verificações
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Segurança
- Não publicar `.env`, credenciais ou segredos de sessão.
- Usar uma `SESSION_SECRET` aleatória com pelo menos 32 caracteres.
- Usar HTTPS em produção e definir `DATABASE_SSL=true` quando a base de dados remota exigir TLS.
- O bootstrap recusa criar um utilizador quando o e-mail já existe; não é um mecanismo de recuperação de palavra-passe.
- Antes de produção, adicionar rate limiting no login, política de retenção de auditoria, backups e ensaios de restauração.
- A gestão de empresas está limitada a papéis de administração; autorização adicional por entidade deve ser testada antes de disponibilizar mais módulos.

Estas instruções descrevem a configuração prevista; os comandos deverão ser executados num ambiente de desenvolvimento para confirmar a instalação. Não utilizar credenciais de exemplo em produção.
