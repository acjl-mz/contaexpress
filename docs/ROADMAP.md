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
- [x] Convites de organização com token de uso único, expiração, criação de conta, associação segura, auditoria e controlo de perfis (migração 015); testes HTTP de acesso anónimo e rejeição de tokens inválidos.\n- [ ] Alteração de palavra-passe autenticada pelo próprio utilizador.
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

 
## Etapa 6 — Tesouraria e fiscalidade
- [x] Registo de contas de caixa, bancos e carteiras móveis por empresa.
- [x] Registo de entradas e saídas, categorias, contraparte, referência e estado de reconciliação.
- [x] Calendário de obrigações fiscais com tipo, período, prazo, valor previsto, referência e estado.
- [x] Controlo de acesso por sessão e empresa, validação dos dados e auditoria das operações.
- [x] Interfaces de tesouraria e fiscalidade e ligação à navegação principal.
- [x] Mapeamento por conta de tesouraria, direcção e categoria para contas do razão.
- [x] Preparação transaccional de rascunhos contabilísticos equilibrados, com ligação ao movimento original e prevenção de duplicação.
- [x] Testes de schema para o vínculo contabilístico e smoke tests de autenticação dos endpoints de mapeamento e preparação.
- [x] Preparação de rascunho contabilístico a partir da tesouraria com sessão autenticada, bloqueio sem mapeamento, validação das contas, lançamento equilibrado, prevenção de duplicação e auditoria; cobertura HTTP no CI.\n- [ ] Confirmação final do lançamento a partir da tesouraria (continua deliberadamente no diário geral, após revisão).
- [x] Importação CSV de extractos bancários com validação de linhas, limite de tamanho e registo de auditoria.
- [x] Sugestões de correspondência por conta, valor, sentido, referência e proximidade de datas.
- [x] Confirmação manual transaccional, prevenção de correspondências duplicadas e histórico de importações.
- [x] Testes HTTP ponta a ponta de importação e reconciliação com utilizador autenticado, validação de datas, divergência de valores, prevenção de repetição e isolamento entre empresas.
- [x] Estrutura do registo de regras fiscais versionadas, fonte HTTPS, vigência, workflow de revisão/aprovação, auditoria e motor de cálculo parametrizado sem taxas pré-carregadas (migração 014).
- [x] API de simulação limitada a regra activa e data de vigência, com fonte e data de validação devolvidas; sem criação de obrigações ou lançamentos.
- [ ] Carregar e validar regras legais reais de Moçambique com fontes oficiais, exemplos aprovados e revisão profissional antes de activação.
- [x] Testes HTTP do workflow fiscal: rascunho, revisão independente, aprovação, activação, simulação e retirada; testes de acesso global e bloqueio de regras não aprovadas.\n- [ ] Ampliar os testes de integração fiscal com cenários legais moçambicanos validados por profissional.
- [ ] Testes de integração específicos e revisão das permissões de tesouraria e fiscalidade.

## Inventário funcional para planeamento das próximas versões

O núcleo actual cobre autenticação, organizações/empresas, plano de contas, lançamentos, estornos, períodos, relatórios iniciais, documentos, tarefas, fecho mensal, tesouraria, reconciliação bancária e infraestrutura técnica de regras fiscais. Os itens abaixo são módulos ou capacidades ainda não entregues como fluxo operacional completo.

### A. Contabilidade — completar
- [ ] Plano de contas de referência configurável por entidade e modelos de implantação para diferentes tipos de actividade.
- [ ] Diário de abertura, apuramentos, regularizações, acréscimos/diferimentos e lançamentos recorrentes.
- [ ] Imobilizado: cadastro, aquisição, depreciação, abates, alienações e mapas.
- [ ] Inventário e custo das mercadorias vendidas, com integração a compras/vendas.
- [ ] Consolidação e relatórios comparativos por período/centro de custo.
- [ ] Demonstrações financeiras e anexos com modelos legalmente aplicáveis e validação profissional.
- [ ] Aprovação em dois níveis, anexos obrigatórios e trilho de revisão para lançamentos sensíveis.

### B. Fiscalidade — operacionalizar
- [ ] Biblioteca de legislação e circulares oficiais, com fonte, artigo, publicação, vigência e histórico de alterações.
- [ ] Implementar e validar regras reais de IVA, IRPC, IRPS, ISPC, retenções na fonte e outros regimes aplicáveis.
- [ ] Apuramento fiscal a partir dos movimentos contabilísticos, reconciliação entre contabilidade e declarações.
- [ ] Calendário fiscal automático, alertas, preparação de declarações e dossiê de suporte.
- [ ] Exportação de mapas e ficheiros nos formatos exigidos pela Autoridade Tributária, quando aplicável.
- [ ] Histórico de submissão/pagamento e conciliação com comprovativos.
- [ ] Revisão fiscal independente e casos de teste oficiais antes de activar cada regra.

### C. Facturação, vendas e clientes — por criar
- [ ] Cadastro de clientes, artigos/serviços, preços, unidades, impostos e condições comerciais.
- [ ] Facturas, facturas-recibo, recibos, notas de crédito/débito, proformas e notas de encomenda.
- [ ] Sequências documentais, séries, anulação, cópias, arquivo e trilho de auditoria.
- [ ] Contas correntes de clientes, cobranças, antiguidade de saldos e recibos alocados.
- [ ] Requisitos de certificação, assinatura, comunicação e formatos fiscais validados antes de emissão legal.

### D. Compras, fornecedores e despesas — por criar
- [ ] Fornecedores, requisições, ordens de compra, recepção e facturas de fornecedor.
- [ ] Contas correntes, pagamentos parciais, adiantamentos e antiguidade de saldos.
- [ ] Circuitos de aprovação por montante, centro de custo e entidade.
- [ ] Despesas, reembolsos, adiantamentos e prestação de contas.

### E. Tesouraria — completar
- [ ] Previsão de tesouraria, fluxo de caixa projectado e cenários.
- [ ] Transferências entre contas com dupla perna contabilística e reconciliação.
- [ ] Pagamentos em lote, agendamento e aprovação por níveis.
- [ ] Integrações bancárias/API e importação de formatos adicionais, com gestão segura de credenciais.
- [ ] Confirmação contabilística a partir do fluxo de tesouraria após revisão e autorização.
- [ ] Relatórios de posição diária, liquidez e compromissos futuros.

### F. Salários e recursos humanos — por criar
- [ ] Cadastro de trabalhadores, contratos, departamentos, categorias e histórico laboral.
- [ ] Processamento salarial, remunerações, descontos, faltas, horas extra, férias e indemnizações.
- [ ] Cálculos de IRPS e INSS validados para legislação e períodos de vigência.
- [ ] Recibos de salário, mapas, ficheiros bancários e integração contabilística.
- [ ] Obrigações declarativas e comprovativos, com validação profissional.

### G. Administração da plataforma — completar
- [ ] Gestão self-service de utilizadores, perfis personalizados, MFA e políticas de sessão.
- [ ] Gestão de planos/subscrições, limites por empresa/utilizador e facturação do serviço SaaS.
- [ ] Centro de notificações, alertas configuráveis e modelos de e-mail.
- [ ] Registo de actividade pesquisável, exportação de auditoria e ferramentas de suporte.
- [ ] Importação assistida de saldos, plano de contas, clientes, fornecedores e movimentos históricos.

### H. Produto, operação e integrações — por criar
- [ ] Onboarding guiado por tipo de empresa e assistente de configuração contabilística.
- [ ] API pública documentada, webhooks e integrações com sistemas externos.
- [ ] Aplicação móvel/PWA e experiência optimizada para operações de campo.
- [ ] Multi-moeda, taxas de câmbio, diferenças cambiais e reavaliação.
- [ ] Centros de custo, projectos, departamentos e análise de rentabilidade.
- [ ] Orçamentação, controlo orçamental e comparação real versus orçamento.
- [ ] Indicadores de gestão, dashboards e relatórios personalizados.

### I. Qualidade e prontidão — obrigatório antes de produção
- [ ] Corrigir e aprovar toda a pipeline CI, incluindo smoke tests, typecheck, lint, build e restauração.
- [ ] Testes de autorização por endpoint, função, entidade, utilizador suspenso e membership revogada.
- [ ] Testes de concorrência para estornos, fecho de períodos, reconciliação e rate limiting distribuído.
- [ ] Testes de migração desde uma base vazia e actualização a partir de cada versão suportada.
- [ ] Validação contabilística independente com balancetes e demonstrações de referência.
- [ ] Testes de segurança, dependências, gestão de segredos, logs e resposta a incidentes.
- [ ] Monitorização, alertas, política RPO/RTO e ensaio de recuperação a partir de backup cifrado remoto.
- [ ] Homologação funcional com utilizadores-piloto e aprovação formal antes de abrir a plataforma ao público.

### J. Integração comercial — primeira versão implementada
- [x] Cadastro multi-tipo de clientes e fornecedores por empresa.
- [x] Configuração de contas de controlo de clientes/fornecedores, vendas/compras e impostos.
- [x] Registo de facturas de clientes e facturas de fornecedores com linhas e totais validados.
- [x] Criação transaccional de rascunhos contabilísticos equilibrados e vinculados aos documentos.
- [x] Registo de recebimentos e pagamentos na Tesouraria, com alocação parcial ou total ao documento.
- [x] Auditoria das operações comerciais e isolamento por empresa.
- [ ] Interface de utilizador para clientes, fornecedores, documentos, mapeamento e pagamentos.
- [ ] Aprovação/postagem do rascunho contabilístico e conciliação automática do pagamento com o documento.
- [ ] Notas de crédito/débito, proformas, recibos e séries documentais.
- [ ] Validação fiscal/legal de facturação em Moçambique e requisitos da Autoridade Tributária.
- [ ] Testes de integração e ponta a ponta de todo o ciclo comercial.
