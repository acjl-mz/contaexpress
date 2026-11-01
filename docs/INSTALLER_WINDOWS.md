# ContaExpress — Instalador Windows

## Objectivo

A primeira distribuição do ContaExpress será destinada a Windows 10 e Windows 11, em arquitectura local e autónoma. Cada instalação mantém a sua própria base de dados PostgreSQL e os seus ficheiros. O Supabase é exclusivamente um ambiente temporário de desenvolvimento e validação; não é dependência de execução nem destino obrigatório de dados do cliente.

## Princípios obrigatórios

- A aplicação deve funcionar na máquina do cliente sem depender de Supabase, Vercel ou de serviços cloud.
- O pacote de instalação deve incluir ou transportar todos os pré-requisitos necessários, sem exigir que o utilizador instale Node.js, PostgreSQL, Docker, Git ou ferramentas de desenvolvimento manualmente.
- PostgreSQL local é a base de dados de produção da instalação.
- Os dados e documentos permanecem no armazenamento local definido pelo instalador.
- A instalação, actualização e desinstalação não podem apagar dados do cliente sem confirmação explícita.
- Segredos e passwords são gerados ou introduzidos localmente e nunca incluídos no instalador, repositório ou logs.
- O instalador deve ser executado com os privilégios mínimos necessários e explicar quando precisar de elevação para configurar o serviço PostgreSQL ou atalhos.
- O funcionamento essencial não pode exigir Internet. A Internet pode ser necessária para descarregar actualizações ou validar licenças, caso esse modelo venha a ser aprovado.

## Componentes da distribuição

1. Aplicação ContaExpress compilada para produção.
2. Runtime Node.js compatível, distribuído com a aplicação ou incluído no pacote.
3. PostgreSQL numa versão suportada, instalado e configurado localmente como serviço Windows.
4. Migrações SQL versionadas do directório `database/migrations`.
5. Ferramentas de configuração inicial, diagnóstico, backup e restauro.
6. Atalhos do Menu Iniciar e opção de iniciar o ContaExpress no navegador.
7. Desinstalador que preserve a base de dados e documentos por omissão.

## Fluxo de instalação pretendido

1. Verificar Windows suportado, arquitectura, espaço em disco e permissões.
2. Seleccionar directório da aplicação e localização dos dados.
3. Instalar/configurar PostgreSQL local com serviço e credenciais próprias.
4. Criar a base de dados ContaExpress.
5. Aplicar todas as migrações pendentes por ordem numérica, registando a versão aplicada.
6. Gerar segredos locais e configurar a aplicação sem expor credenciais.
7. Criar o primeiro Super Admin através de um assistente local seguro; não guardar a password em ficheiros de texto ou logs.
8. Iniciar e validar o serviço da aplicação e a ligação à base de dados.
9. Criar atalhos e abrir a página de autenticação.

## Operação após instalação

- A aplicação deve arrancar automaticamente ou através de um atalho, conforme escolha do administrador.
- O acesso inicial será local, através do navegador, por endereço loopback. A exposição na rede local deverá ser uma opção explícita, protegida por configuração e documentação.
- Os serviços devem arrancar com o Windows e recuperar de reinícios.
- O administrador deve conseguir consultar o estado da aplicação e da base de dados.
- Backups devem ser guardados numa localização configurável, fora da pasta de instalação, com procedimento documentado de restauro.
- Actualizações devem fazer backup, validar compatibilidade, aplicar migrações e permitir recuperação em caso de falha.

## Segurança e dados

- Não expor PostgreSQL à rede por omissão; limitar a escuta a localhost.
- Não usar credenciais padrão em instalações reais.
- Restringir permissões NTFS nas pastas de dados, documentos, configuração e backups.
- Proteger segredos e credenciais com mecanismos apropriados do Windows, evitando plaintext em scripts e logs.
- Aplicar políticas de sessão e autorização da aplicação; a separação por empresa continua a ser obrigatória.
- Desinstalar a aplicação não deve remover a base de dados, documentos ou backups sem consentimento explícito.

## Estratégia de empacotamento

A distribuição deverá ser produzida com um instalador Windows (por exemplo, Inno Setup ou tecnologia equivalente) que orquestre os componentes locais. O instalador final só será considerado pronto quando puder ser executado numa máquina Windows limpa, sem ferramentas de desenvolvimento, sem acesso à Internet durante a instalação (excepto se uma dependência não puder legalmente ser redistribuída e isso for explicitamente documentado), e concluir um teste de login e persistência de dados após reinício.

A escolha exacta das versões do Node.js e PostgreSQL, licenças de redistribuição, mecanismo de serviço Windows, actualização e assinatura digital deverá ser fixada na fase de implementação e validada antes da distribuição pública.

## Critérios de aceitação

- Instalação concluída numa máquina Windows 10/11 limpa.
- Nenhum pré-requisito de desenvolvimento instalado manualmente pelo utilizador.
- Aplicação e PostgreSQL arrancam após reinício do Windows.
- Primeiro Super Admin consegue autenticar-se.
- Dados persistem após reinício e actualização.
- Teste de isolamento entre empresas aprovado.
- Backup e restauro comprovados numa instalação separada.
- Operações essenciais funcionam sem Internet.
- Desinstalação preserva dados por omissão e oferece uma opção clara de remoção definitiva.
- Nenhuma variável ou código de produção exige credenciais Supabase.
