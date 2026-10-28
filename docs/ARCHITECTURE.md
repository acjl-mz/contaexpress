# Arquitectura inicial

## Componentes
- **Web:** Next.js App Router + TypeScript.
- **Persistência:** PostgreSQL.
- **Infraestrutura local:** Docker Compose.
- **Regras de negócio:** módulos de servidor independentes da interface.
- **Documentos:** armazenamento em directório privado, com metadados na base de dados.
- **Auditoria:** eventos append-only para operações críticas.

## Modelo multempresa
Os dados operacionais devem ser associados a uma entidade contabilística. O servidor deve verificar a associação e as permissões do utilizador em cada operação. Ocultar dados apenas na interface não constitui controlo de acesso.

## Integridade contabilística
- Lançamentos em rascunho podem ser editados por utilizadores autorizados.
- Um lançamento só pode ser confirmado se tiver pelo menos duas linhas válidas e o total de débitos for igual ao total de créditos.
- Lançamentos confirmados não devem ser silenciosamente alterados ou eliminados; correcções são efectuadas por estorno e novo lançamento.
- Períodos encerrados bloqueiam novas confirmações, salvo processo explícito e auditado de reabertura.

## Segurança
- Segredos apenas em variáveis de ambiente.
- Não expor caminhos físicos de documentos.
- Aplicar autorização no servidor e, quando adequado, políticas adicionais na base de dados.
- Registar alterações de permissões, confirmações, estornos, fechos e exportações.
- Criar cópias de segurança fora do disco primário e testar restauração.

## Operação offline
A instalação local pode funcionar na rede interna sem Internet depois de instalar as dependências e preparar a infraestrutura. Actualizações, instalação inicial e integrações externas podem exigir conectividade.

## Limites da primeira fundação
A fundação não é um sistema contabilístico pronto para produção, não confirma conformidade legal e não certifica facturação. Estas capacidades serão entregues por fases, com testes e validação profissional.
