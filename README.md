# ContaExpress

Plataforma proprietária de gestão contabilística, fiscal e financeira, com foco inicial na operação local da ALINVEST e no mercado moçambicano.

## Estado
Os módulos de empresas, contabilidade, arquivo documental, tarefas, fecho mensal, relatórios, tesouraria, calendário fiscal e reconciliação bancária estão implementados no MVP. Está em revisão a cobertura ponta a ponta da integração Tesouraria–Contabilidade e a nova base de regras fiscais versionadas.

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
Consulte `docs/DEVELOPMENT.md` para preparar o ambiente, aplicar as migrações 001–014 e criar o primeiro administrador. Consulte `docs/ROADMAP.md` para o plano de implementação.

## Aviso
O registo fiscal versionado e a simulação são uma fundação técnica, não uma interpretação legal validada. Não existem taxas legais pré-carregadas; a gestão do registo global exige uma concessão explícita em `platform_administrators`. Regras reais só devem ser activadas após confirmação de fonte normativa oficial, vigência e aprovação profissional. O sistema não constitui certificação fiscal nem autorização para emissão de facturas oficiais.
