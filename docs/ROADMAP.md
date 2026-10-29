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
- [x] Teste HTTP de rate limiting: após oito tentativas falhadas para o mesmo e-mail, novas tentativas são limitadas com HTTP 429.
- [ ] Testes concorrentes do rate limiting e limitação distribuída sob múltiplas instâncias.
- [x] Fluxo de pedido e confirmação de recuperação de palavra-passe com token de uso único, expiração de 30 minutos e invalidação de sessões anteriores (migração 010).
- [ ] Fluxo de convite e alteração de palavra-passe autenticada.
- [x] Teste de integração PostgreSQL para isolamento multempresa e concessão/revogação de acesso explícito por entidade.
- [x] Teste de integração PostgreSQL para impedir confirmação por auditores e validar numeração sequencial por diário.
- [x] Testes HTTP de fumo para login, credenciais inválidas, sessão, acesso à listagem de empresas e logout.
- [x] Testes HTTP de permissões por função e isolamento multempresa (auditor não confirma lançamentos; entidade de outra organização não pode ser consultada).
- [x] Teste PostgreSQL concorrente para confirmar o mesmo lançamento em duas sessões e garantir uma única confirmação/numeração.
- [ ] Testes concorrentes reais para estornos simultâneos e rate limiting.

## Etapa 3 — Núcleo contabilístico
- [x] Estrutura inicial de plano de contas e API de consulta/criação.
- [x] Inicialização de exercício fiscal, 12 períodos e diário geral.
- [x] Criação de rascunhos de lançamentos com múltiplas linhas via API.
- [x] Confirmação de lançamento com validação transaccional de débitos = créditos, período aberto e contas movimentáveis.
- [x] Bloqueio de alteração e eliminação de lançamentos confirmados através de triggers.
- [x] Primeira interface para plano de contas e diário geral.
- [x] Teste de integração PostgreSQL para confirmação de lançamentos equilibrados, rejeição de lançamentos desequilibrados e imutabilidade após confirmação.
- [ ] Revisão contabilística do plano de contas e ampliação dos testes de integração.
- [x] Fluxo formal de estorno com lançamento inverso, referência ao original, auditoria e bloqueio de duplicação.
- [x] Teste de integração PostgreSQL para estorno ligado ao original, inversão de linhas, efeito líquido nulo, bloqueio de duplicação e recusa de confirmação em período fechado.
- [ ] Testes de concorrência para estornos simultâneos e numeração dos lançamentos.
- [x] API e interface inicial do razão por conta e balancete de verificação, com filtros por data e exportação CSV.
- [x] Diário geral detalhado com conta, descrição, estado, diário, débitos e créditos; exportação CSV.
- [x] API de balanço e demonstração de resultados com filtros de data e cálculo de saldos a partir de lançamentos confirmados.
- [x] Interface de relatórios com balancete, balanço, demonstração de resultados, diário e razão por conta.
- [x] Exportação CSV dos relatórios apresentados.
- [x] Validação reutilizável de datas e testes unitários para datas impossíveis e intervalos invertidos.
- [x] Testes unitários dos cálculos do balancete, demonstração de resultados e reconciliação do balanço com dados controlados.
- [x] Teste de integração PostgreSQL para validar saldos do balancete, demonstração de resultados, balanço, saldos de abertura e filtros por período com lançamentos confirmados e rascunhos.
- [ ] Testes de integração para estornos, períodos fechados, isolamento entre empresas e concorrência.

## Etapa 4 — Documentos e acompanhamento
- [x] Arquivo documental com metadados, hash SHA-256 e acesso controlado por empresa.
- [x] Associação opcional de documentos a lançamentos contabilísticos.
- [x] Interface de arquivo e descarga autenticada de ficheiros.
- [x] Registo de tarefas com categorias, prioridade, prazo, estado e auditoria.
- [x] Filtros por estado e indicadores de tarefas pendentes, atrasadas e concluídas.
- [x] Modelo de fecho mensal com checklist padrão por período e bloqueios de encerramento.
- [x] Interface de checklist com progresso, requisitos obrigatórios e confirmação explícita do encerramento.
- [x] Bloqueio de encerramento com itens obrigatórios pendentes, lançamentos em rascunho ou totais desequilibrados.
- [x] Teste de integração PostgreSQL para idempotência da criação de fechos mensais por empresa e período.
- [ ] Testes de integração HTTP e concorrência real para permissões, fecho e encerramento simultâneo.

## Etapa 5 — Relatórios e robustez
- [x] Primeira versão técnica do balanço e demonstração de resultados (requer validação contabilística com dados de teste antes de uso externo).
- [x] Exportação CSV do razão e do balancete.
- [x] Impressão com layout optimizado para A4 horizontal e opção de guardar como PDF pelo navegador.
- [x] Exportação PDF gerada no servidor com validação de sessão/permissões através da API de relatórios.
- [x] Testes unitários da estrutura PDF, paginação, escape de texto e presença de totais/valores contabilísticos.
- [x] Procedimentos de backup PostgreSQL com checksum e restauração protegida por confirmação explícita.
- [x] Ensaio automatizado de backup/restauração e verificação estrutural no CI.
- [ ] Validação contabilística independente dos relatórios com saldos de referência aprovados por profissional.
- Testes de isolamento, integridade e permissões.
- [x] Scripts operacionais de backup e restauração com verificação SHA-256.
- [x] Ensaio de restauração numa base descartável na pipeline CI.

## Etapa 6 — Expansão
- Fiscalidade moçambicana com regras versionadas e fontes normativas validadas.
- Tesouraria, compras, facturação e salários.
- Integrações e expansão de infraestrutura.

## Critérios de passagem
Nenhuma etapa é considerada concluída apenas porque a interface existe. Exige validação funcional, testes e documentação. Cálculos fiscais, processamento salarial e emissão de facturas oficiais requerem validação especializada e confirmação dos requisitos legais aplicáveis.
