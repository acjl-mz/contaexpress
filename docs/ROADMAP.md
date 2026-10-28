# ContaExpress — roteiro de implementação

## Etapa 1 — Fundação
- Estrutura Next.js e TypeScript.
- Layout inicial em português.
- Configuração de ambiente e Docker Compose para PostgreSQL.
- Documentação de arquitectura, segurança e execução local.

## Etapa 2 — Identidade e administração
- [x] Modelo de organizações, entidades e memberships.
- [x] Início e fim de sessão com cookie HTTP-only assinado.
- [x] Bootstrap controlado do primeiro administrador.
- [x] API inicial de registo e listagem de empresas com autorização no servidor.
- [x] Registo de auditoria para criação de empresa.
- [x] Rate limiting inicial para tentativas repetidas de login por e-mail e IP (requer migração 006).
- [ ] Testes automatizados de segurança e concorrência para o rate limiting.
- [ ] Fluxo de convite, recuperação e alteração de palavra-passe.
- [ ] Testes automatizados de autenticação e isolamento multempresa.

## Etapa 3 — Núcleo contabilístico
- [x] Estrutura inicial de plano de contas e API de consulta/criação.
- [x] Inicialização de exercício fiscal, 12 períodos e diário geral.
- [x] Criação de rascunhos de lançamentos com múltiplas linhas via API.
- [x] Confirmação de lançamento com validação transaccional de débitos = créditos, período aberto e contas movimentáveis.
- [x] Bloqueio de alteração e eliminação de lançamentos confirmados através de triggers.
- [x] Primeira interface para plano de contas e diário geral.
- [ ] Testes automatizados de integração com PostgreSQL e revisão contabilística do plano de contas.
- [x] Fluxo formal de estorno com lançamento inverso, referência ao original, auditoria e bloqueio de duplicação.
- [ ] Testes automatizados de integração PostgreSQL para confirmar estornos, períodos fechados e concorrência.
- [x] API e interface inicial do razão por conta e balancete de verificação, com filtros por data e exportação CSV.
- [x] Diário geral detalhado com conta, descrição, estado, diário, débitos e créditos; exportação CSV.
- [ ] Reconciliação independente dos saldos e testes automatizados dos relatórios.

## Etapa 4 — Documentos e acompanhamento
- [x] Arquivo documental com metadados, hash SHA-256 e acesso controlado por empresa.
- [x] Associação opcional de documentos a lançamentos contabilísticos.
- [x] Interface de arquivo e descarga autenticada de ficheiros.
- [x] Registo de tarefas com categorias, prioridade, prazo, estado e auditoria.
- [x] Filtros por estado e indicadores de tarefas pendentes, atrasadas e concluídas.
- [ ] Modelo de fecho mensal com checklist padrão por período e bloqueios de encerramento.

## Etapa 5 — Relatórios e robustez
- Balanço e demonstração de resultados, após validação contabilística.
- [x] Exportação CSV do razão e do balancete.
- [ ] Exportação PDF com layout imprimível e validação de totais.
- Testes de isolamento, integridade e permissões.
- Backups e ensaios de restauração.

## Etapa 6 — Expansão
- Fiscalidade moçambicana com regras versionadas e fontes normativas validadas.
- Tesouraria, compras, facturação e salários.
- Integrações e expansão de infraestrutura.

## Critérios de passagem
Nenhuma etapa é considerada concluída apenas porque a interface existe. Exige validação funcional, testes e documentação. Cálculos fiscais, processamento salarial e emissão de facturas oficiais requerem validação especializada e confirmação dos requisitos legais aplicáveis.
