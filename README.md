# ContaExpress

Plataforma proprietária de gestão contabilística, fiscal e financeira, com foco inicial na operação local da ALINVEST e no mercado moçambicano.

## Estado
Fundação e primeira versão do módulo de empresas em desenvolvimento na branch `feature/company-management-auth`. A validação de CI ainda precisa de ser executada.

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
A aplicação e os serviços de infraestrutura serão adicionados nas próximas etapas. Consulte `docs/ROADMAP.md` para o plano de implementação.

## Aviso
Esta fundação não constitui certificação fiscal nem autorização para emissão de facturas oficiais. Os requisitos aplicáveis em Moçambique deverão ser validados antes de disponibilizar essas funções.
