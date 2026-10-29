# ContaExpress

Plataforma proprietária de gestão contabilística, fiscal e financeira, com foco inicial na operação local da ALINVEST e no mercado moçambicano.

## Estado
Fundação, autenticação, gestão de empresas, núcleo contabilístico, relatórios, arquivo documental, tarefas, fecho mensal, tesouraria, calendário fiscal e reconciliação bancária assistida estão implementados no repositório. A aplicação continua em desenvolvimento: a próxima prioridade é concluir a validação funcional end-to-end da integração Tesouraria–Contabilidade e fechar as pendências de segurança, revisão contabilística e motor fiscal.

## Stack prevista
- Next.js + TypeScript
- PostgreSQL
- Docker Compose para operação local
- Armazenamento documental local com metadados na base de dados

## Princípios
- Isolamento de dados por entidade contabilística.
- Regras de negócio validadas no servidor.
- Lançamentos contabilísticos equilibrados e imutabilidade do histórico confirmado.
- Auditoria das operações relevantes.
- Operação essencial sem dependência da Internet na instalação local.
- Regras fiscais versionadas e sujeitas a validação profissional.

## Arranque
Consulte `docs/DEVELOPMENT.md` para preparar o ambiente, aplicar as migrações 001–013 e criar o primeiro administrador. Consulte `docs/ROADMAP.md` para o plano de implementação.

## Aviso
Esta fundação não constitui certificação fiscal nem autorização para emissão de facturas oficiais. Os requisitos aplicáveis em Moçambique deverão ser validados antes de disponibilizar essas funções.
