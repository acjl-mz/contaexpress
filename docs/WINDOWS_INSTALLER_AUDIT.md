# Auditoria técnica — distribuição Windows do ContaExpress

**Data:** 1 de Novembro de 2026  
**Âmbito:** branch `main`, estrutura do repositório, configuração de execução, persistência documental, migrações, bootstrap, backup/restauro e CI.

## Conclusão executiva

O repositório contém uma aplicação web Next.js funcional em desenvolvimento, ligada directamente a PostgreSQL através de `pg`. A fundação de dados, autenticação, migrações SQL, criação inicial de administrador e operações de backup/restauro existem.

**O repositório ainda não contém um instalador Windows nem os mecanismos necessários para distribuir e operar a aplicação autonomamente numa máquina de cliente.** Não foi identificado Electron, Tauri, serviço Windows, wrapper de arranque, instalador Inno Setup/NSIS/WiX, runtime empacotado, provisionamento automatizado do PostgreSQL ou pipeline de testes Windows.

A documentação de desenvolvimento exige Node.js, npm e Docker Compose. Esses requisitos são de desenvolvimento e não podem ser transferidos para o utilizador final.

## Inventário do que já existe

| Área | Estado observado | Avaliação |
|---|---|---|
| Aplicação | Next.js 15, React 19 e TypeScript; scripts `dev`, `build` e `start` | Base reutilizável |
| Base de dados | PostgreSQL via pacote `pg`, ligação por `DATABASE_URL` | Compatível com PostgreSQL local |
| Migrações | 17 ficheiros SQL numerados, aplicados manualmente/na CI | Conteúdo existe; falta runner de instalação e controlo de versão robusto |
| Primeiro administrador | `scripts/bootstrap-admin.mjs`, transaccional, hash bcrypt e recusa e-mail existente | Reutilizável, mas requer execução manual e variáveis de ambiente |
| Documentos contabilísticos | Upload validado, hash SHA-256, metadados e bytes persistidos em coluna PostgreSQL `BYTEA` | Funciona localmente, mas não usa directório privado como a documentação de arquitectura afirma |
| Backup | `scripts/db-backup.sh`, pg_dump custom, checksum e metadados; cifragem GPG opcional | Funcional em ambiente Bash com ferramentas PostgreSQL |
| Restauro | `scripts/db-restore.sh`, checksum, confirmação explícita e pg_restore | Funcional em ambiente Bash; não é um fluxo Windows |
| Verificação | `scripts/db-verify.sh` verifica tabelas essenciais | Verificação estrutural básica |
| Desenvolvimento local | Docker Compose com PostgreSQL 16 | Útil para desenvolvimento; não é instalador |
| CI | GitHub Actions em Ubuntu, PostgreSQL 16, migrações, testes, typecheck, lint, build, smoke HTTP e ensaio backup/restauro | Boa base de validação, mas sem Windows |
| Configuração | `.env.example`, `lib/db.ts` com pool e SSL opcional | Precisa de configuração segura gerida pelo instalador |
| Documentação | Arquitectura, desenvolvimento, prontidão de produção e requisitos do instalador | Precisa de alinhamento com comportamento real |

## Lacunas e riscos identificados

### P0 — bloquear antes de distribuir

1. **Sem instalador ou empacotamento Windows.** Não existe configuração de Inno Setup, NSIS, WiX, Electron/Tauri ou equivalente.
2. **Sem serviço/launcher Windows.** O script `npm start` não instala serviço, não gere reinício automático, não verifica saúde nem apresenta um mecanismo operacional amigável.
3. **Sem runtime incluído.** A aplicação depende de Node.js instalado no sistema; não há runtime Node empacotado nem versão fixada para o instalador.
4. **Sem provisionamento do PostgreSQL.** O Docker Compose disponibiliza PostgreSQL para desenvolvimento; não instala/configura PostgreSQL como serviço Windows, não cria credenciais aleatórias nem prepara a base de dados no primeiro arranque.
5. **Migrações sem orquestrador de instalação.** Os 17 SQL são conhecidos, mas a aplicação das migrações é manual ou feita por passos codificados na CI. Falta um runner idempotente, com registo da versão, bloqueio de concorrência, logs e falha segura.
6. **Bootstrap incompatível com assistente.** O script actual lê `ADMIN_EMAIL`, `ADMIN_NAME` e `ADMIN_PASSWORD` do ambiente e falha se o e-mail já existir. Falta um assistente local seguro, validação e limpeza de segredos temporários.
7. **Backup/restauro não Windows-native.** Os scripts são Bash e usam utilitários POSIX (`sha256sum`, `chmod`, `sed`, `find` nos fluxos CI). Não há comandos PowerShell nem integração com os binários PostgreSQL no Windows.
8. **Sem teste em Windows.** A pipeline corre em `ubuntu-latest`; não valida instalação, caminhos, permissões NTFS, serviços, reinício, backup/restauro ou funcionamento offline em Windows 10/11.
9. **Sem ciclo de actualização e recuperação.** Não há instalador de actualização, backup prévio automático, compatibilidade de versão, rollback ou recuperação após migração falhada.

### P1 — resolver antes do piloto com clientes

1. **Armazenamento documental divergente da arquitectura.** `docs/ARCHITECTURE.md` descreve directório privado, mas `app/api/accounting/documents/route.ts` grava o ficheiro em `accounting_documents.file_data BYTEA`. É necessário escolher e documentar uma estratégia única. Para a distribuição local, recomenda-se armazenamento em directório privado configurável, com metadados e hash na base de dados, migração segura dos ficheiros existentes e backups coordenados.
2. **Configuração por variáveis de ambiente.** `.env.example` e `lib/db.ts` pressupõem configuração manual. A instalação necessita de um ficheiro de configuração protegido por ACL do Windows ou armazenamento seguro equivalente. Não se deve guardar passwords em texto simples acessível a utilizadores comuns.
3. **Dependência de serviços externos de e-mail.** A recuperação de palavra-passe depende de Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`). A operação contabilística local pode funcionar offline, mas a recuperação por e-mail não estará disponível sem conectividade e configuração. Deve existir um procedimento administrativo local seguro para recuperação, sem enfraquecer a autenticação.
4. **Falta de política de escuta de rede.** A aplicação deve escutar em loopback por omissão. A partilha na LAN, se for adicionada, precisa de opção explícita, firewall, autenticação e documentação.
5. **Ausência de assinatura digital e cadeia de confiança.** O instalador e os binários devem ser assinados antes da distribuição pública, com processo de actualização que valide origem e integridade.
6. **Sem verificação de espaço, permissões e compatibilidade.** O assistente deve validar Windows suportado, arquitectura, espaço, portas, permissões e colisões com instalações anteriores.

### P2 — robustez e manutenção

1. Não existe `package-lock.json` na árvore auditada. A distribuição deve fixar dependências através de lockfile e instalar/buildar de forma reproduzível.
2. A versão do PostgreSQL diverge entre desenvolvimento (Docker Compose 16), instância de validação Supabase (17) e ambiente local do utilizador (18). Deve ser definida uma versão suportada para o produto, com política de actualização e compatibilidade.
3. `docs/DEVELOPMENT.md` refere aplicação manual de migrações e bootstrap por ambiente; deve distinguir claramente o fluxo de programador do fluxo de instalação do cliente.
4. `docs/PRODUCTION_READINESS.md` é sobretudo orientado a produção web/cloud e menciona backups externos/GitHub Actions; a versão Windows necessita de checklist própria para backup local, cópia externa opcional, recuperação e suporte.
5. Não existe ainda um diagnóstico local para recolher versão da aplicação, estado do serviço, estado PostgreSQL, espaço disponível e resultado do último backup sem revelar segredos.

## Arquitectura recomendada para a primeira versão Windows

- **Modelo:** aplicação web local servida por um processo Node.js empacotado, aberta no navegador padrão. Não é necessário converter imediatamente o produto numa aplicação Electron.
- **Instalador:** Inno Setup (ou tecnologia equivalente), com pré-verificações, instalação de componentes, configuração e desinstalação controlada.
- **Runtime:** versão Node.js LTS fixada e empacotada, sem depender do Node.js global.
- **Base de dados:** PostgreSQL Windows Service, versão suportada e fixada, escuta apenas em localhost, utilizador dedicado e password gerada no momento da instalação.
- **Aplicação:** build Next.js de produção; avaliar `output: "standalone"` e dependências nativas para distribuição, sem assumir que a configuração actual já suporta esse modo.
- **Processo:** serviço Windows para aplicação (ou supervisor equivalente) com arranque automático, recuperação após falha, logs com rotação e encerramento gracioso. O PostgreSQL mantém o seu próprio serviço.
- **Dados:** separar directório de programa (actualizável) do directório persistente de dados, configuração, documentos e backups. Usar permissões NTFS restritas.
- **Configuração:** gerar `SESSION_SECRET`, credenciais da base e portas localmente; nunca colocar segredos no instalador, no Git ou nos logs.
- **Instalação inicial:** executar migrações por runner idempotente e apresentar um assistente local para criar o primeiro Super Admin.
- **Acesso:** abrir `http://127.0.0.1:<porta>`; não expor na rede por omissão.
- **Backup:** backup consistente da base e documentos, checksum e cifragem opcional, destino fora da pasta da aplicação. Restauro assistido com confirmação do destino.
- **Actualização:** verificar compatibilidade, criar backup, parar serviço, aplicar actualização/migrações, verificar saúde e reverter para versão anterior quando seguro.
- **Desinstalação:** remover binários e serviços, mas preservar base de dados, documentos e backups por omissão; remoção dos dados só mediante escolha clara e confirmação.

## Plano de implementação proposto

### Fase 1 — preparar a aplicação
- Fixar Node.js e PostgreSQL suportados.
- Criar lockfile e build reproduzível.
- Configurar Next.js para empacotamento de produção e validar os recursos dinâmicos.
- Centralizar configuração e caminhos persistentes.
- Definir contrato de saúde local e encerramento gracioso.

### Fase 2 — persistência e migrações
- Criar runner de migrações com tabela de controlo, transacção quando possível, lock e logs.
- Criar camada de armazenamento documental local e migração de BYTEA para ficheiros sem perda de dados.
- Implementar backup/restauro Windows-native para base de dados e documentos.

### Fase 3 — serviços Windows
- Criar scripts PowerShell idempotentes para provisionar PostgreSQL, serviço da aplicação, ACLs, firewall/loopback e diagnóstico.
- Implementar geração de credenciais e configuração inicial segura.
- Implementar assistente de primeiro arranque para o Super Admin.

### Fase 4 — instalador e actualizações
- Construir instalador assinado.
- Implementar instalação, reparação, actualização, rollback e desinstalação com preservação de dados.
- Criar atalhos e abertura do navegador.

### Fase 5 — validação Windows
- Adicionar CI em Windows.
- Testar instalação limpa em Windows 10 e 11.
- Testar reinício, funcionamento offline, permissões, actualização, backup, restauro e desinstalação.
- Fazer ensaio numa máquina virtual limpa sem Node.js, Docker, Git ou PostgreSQL previamente instalados.

## Decisões que ficam fixadas nesta auditoria

- A primeira distribuição é Windows 10/11.
- A instalação é local e autónoma; Supabase não é dependência de execução.
- Docker Compose mantém-se apenas para desenvolvimento/validação.
- PostgreSQL local é a base de dados do produto instalado.
- O navegador é a interface inicial; não se introduz Electron sem necessidade funcional comprovada.
- Os dados dos clientes nunca são removidos automaticamente por actualização ou desinstalação.

## Critério para declarar o instalador pronto

Só considerar a distribuição pronta depois de instalar numa máquina Windows limpa, sem ferramentas de desenvolvimento e sem Internet, iniciar a aplicação, criar o primeiro administrador, autenticar, persistir dados, reiniciar o Windows, executar backup e restauro, actualizar a aplicação e desinstalar preservando os dados.
