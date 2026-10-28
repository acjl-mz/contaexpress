# Desenvolvimento local

## Requisitos
- Node.js LTS compatível com Next.js 15.
- npm.
- Docker Desktop ou Docker Engine com Docker Compose.

## Preparar o ambiente
1. Copiar `.env.example` para `.env` e definir uma palavra-passe local forte.
2. Instalar dependências com `npm install`.
3. Iniciar PostgreSQL com `docker compose up -d db`.
4. Iniciar a aplicação com `npm run dev`.
5. Abrir `http://localhost:3000`.

## Verificações
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Estas instruções descrevem a configuração prevista; os comandos deverão ser executados num ambiente de desenvolvimento para confirmar a instalação. Não utilizar credenciais de exemplo em produção.
