# ContaExpress — checklist de prontidão para produção

Este documento é um controlo operacional. A conclusão do CI não substitui a validação do ambiente de produção, a revisão contabilística nem os ensaios de recuperação.

## Antes de activar utilizadores
- [ ] Configurar domínio definitivo e HTTPS.
- [ ] Definir `SESSION_SECRET` aleatório com pelo menos 32 caracteres e guardá-lo num gestor de segredos.
- [ ] Configurar `DATABASE_URL` para a base de produção e validar TLS com `DATABASE_SSL=true` quando aplicável.
- [ ] Aplicar as migrações 001–015 pela ordem documentada e guardar o registo da versão aplicada.
- [ ] Confirmar que o bootstrap de administrador não está exposto como endpoint público e que as credenciais iniciais não são reutilizadas.
- [ ] Configurar `APP_BASE_URL`, `RESEND_API_KEY` e `RESEND_FROM_EMAIL`; validar entrega, domínio autenticado e tratamento de falhas de e-mail.
- [ ] Rever a origem confiável dos cabeçalhos de IP no proxy. Não aceitar `X-Forwarded-For` arbitrário de clientes directos.
- [ ] Fazer testes de autorização para cada função e empresa, incluindo utilizadores desactivados, sessões expiradas e memberships revogadas.
- [ ] Validar os relatórios com um conjunto de lançamentos de referência aprovado por contabilista: balancete, razão, diário, balanço, demonstração de resultados e estornos.
- [ ] Documentar quem pode confirmar lançamentos, estornar e encerrar períodos; validar os controlos com o responsável contabilístico.
- [ ] Confirmar que o registo global de regras fiscais só está acessível a operadores formalmente designados em `platform_administrators`; um `superadmin` de uma organização não deve obter acesso global automaticamente.
- [ ] Antes de activar regras fiscais, comprovar a fonte normativa, a vigência, o método de cálculo e os casos de referência; exigir revisão por uma pessoa diferente do autor e aprovação profissional registada.
- [ ] Validar a API de simulação fiscal com dados de referência aprovados e confirmar que não existem taxas pré-carregadas nem cálculo por omissão.

## Backups e recuperação
- [ ] Definir RPO (perda máxima de dados aceitável) e RTO (tempo máximo de recuperação).
- [ ] Criar chave GPG de cifragem e guardar a chave privada de recuperação separada da aplicação e do repositório.
- [ ] Configurar o destino remoto `rclone` com permissões mínimas e credenciais próprias.
- [ ] Definir `BACKUP_ENABLED=true`, `DATABASE_URL`, `BACKUP_GPG_PUBLIC_KEY`, `BACKUP_GPG_RECIPIENT`, `BACKUP_REMOTE` e `RCLONE_CONFIG_BASE64` como variável/segredos do GitHub Actions.
- [ ] Executar manualmente o workflow `ContaExpress encrypted database backup` e verificar no destino remoto os ficheiros cifrados, checksum e metadados.
- [ ] Desencriptar uma cópia com a chave privada de recuperação e restaurar para uma base isolada; executar `scripts/db-verify.sh`.
- [ ] Confirmar que a retenção remota corresponde à política aprovada (`BACKUP_RETENTION_DAYS`, por omissão 30 dias).
- [ ] Configurar alerta para falha do workflow e confirmar que pelo menos um responsável recebe a notificação.
- [ ] Repetir o ensaio de recuperação periodicamente e registar a duração real.

## Critérios mínimos de aceitação
- Pipeline CI integral aprovada no commit a publicar.
- Nenhum segredo no repositório nem nos logs.
- Recuperação de palavra-passe testada com e-mail real e sessão anterior invalidada.
- Pelo menos uma restauração verificada a partir de backup cifrado no armazenamento remoto.
- Aprovação escrita dos totais contabilísticos de referência.
- RPO/RTO, responsáveis operacionais e procedimento de incidente documentados.

## Limitações conhecidas
- O workflow de backups depende da configuração de segredos e do destino remoto; não se considera activo apenas por estar no repositório.
- O limite de login actual é baseado em PostgreSQL, mas ainda precisa de testes de concorrência e de avaliação sob múltiplas instâncias.
- A revisão de relatórios contabilísticos tem de ser feita por um profissional independente com dados de referência; os testes automatizados não certificam conformidade legal ou contabilística.
- O motor fiscal é uma base técnica de regras versionadas. Não existem taxas legais pré-carregadas; nenhuma regra deve ser activada sem validação da fonte e aprovação profissional. A gestão do registo é global e deve ser atribuída explicitamente na tabela `platform_administrators`.
