# ContaExpress — roteiro de implementação

## Etapa 1 — Fundação
- Estrutura Next.js e TypeScript.
- Layout inicial em português.
- Configuração de ambiente e Docker Compose para PostgreSQL.
- Documentação de arquitectura, segurança e execução local.

## Etapa 2 — Identidade e administração
- Autenticação de utilizadores.
- Organizações clientes e entidades contabilísticas.
- Associação utilizador–empresa e permissões no servidor.
- Registo de auditoria.

## Etapa 3 — Núcleo contabilístico
- Plano de contas configurável.
- Exercícios e períodos contabilísticos.
- Diários e lançamentos com múltiplas linhas.
- Validação de débitos = créditos.
- Confirmação, estorno e controlo de períodos.
- Diário, razão e balancete.

## Etapa 4 — Documentos e acompanhamento
- Arquivo com metadados e acesso controlado.
- Associação de documentos a lançamentos.
- Tarefas, pendências e estado do fecho mensal.

## Etapa 5 — Relatórios e robustez
- Balanço e demonstração de resultados, após validação contabilística.
- Exportações.
- Testes de isolamento, integridade e permissões.
- Backups e ensaios de restauração.

## Etapa 6 — Expansão
- Fiscalidade moçambicana com regras versionadas e fontes normativas validadas.
- Tesouraria, compras, facturação e salários.
- Integrações e expansão de infraestrutura.

## Critérios de passagem
Nenhuma etapa é considerada concluída apenas porque a interface existe. Exige validação funcional, testes e documentação. Cálculos fiscais, processamento salarial e emissão de facturas oficiais requerem validação especializada e confirmação dos requisitos legais aplicáveis.
