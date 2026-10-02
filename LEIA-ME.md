# Statz 1.3.2 — reconstrução

Frontend preservado da versão 1.3.1 do GitHub, com seleção de sala P2P/grupo, API de autenticação reconstruída e projeto desktop Tauri v2. Os originais do backend e do Rust não estavam no ZIP. Esta entrega não é uma cópia integral do projeto perdido.

## Iniciar a versão web

Instale Node.js LTS (22 ou superior). Abra `INICIAR_WEB.bat` ou rode `npm start` nesta pasta. Acesse http://localhost:3030. Na primeira inicialização, o terminal mostra o usuário `admin` e uma senha aleatória: guarde-a. Opcionalmente, defina `STATZ_ADMIN_PASSWORD` antes da primeira execução. Ela não altera um administrador já existente.

No painel de administração, crie uma KEY. Cadastre uma conta com essa KEY e aprove a conta no painel. O banco e a chave de assinatura são criados em `data/`; preserve essa pasta em backups e não a publique. Senhas são armazenadas com scrypt; tokens são assinados com RSA e expiram em 24 horas. Contas bloqueadas são recusadas pela API, inclusive com token ainda válido.

## Desktop Windows

Instale Node.js LTS, Rust estável e Visual Studio Build Tools com C++ e Windows SDK, conforme https://v2.tauri.app/start/prerequisites/. O WebView2 deve estar disponível no Windows.

Execute `COMPILAR_DESKTOP.bat`. O instalador NSIS fica em `src-tauri/target/release/bundle/nsis`. Para desenvolvimento: `npm install` e `npm run desktop:dev`.

O desktop empacota o frontend. A API é um serviço separado: rode `npm start` no computador servidor. Por padrão, o desktop usa http://localhost:3030; altere `web/config.js` antes de compilar para apontar para sua API HTTPS. A build não contém um servidor embutido.

## Uso entre computadores

Ao criar a sala, escolha **Duas pessoas** (anfitrião + um convidado, WebRTC direto com STUN e sem TURN para a mídia) ou **Grupo** (mais participantes, mantendo STUN/TURN). O anfitrião confirma o modo antes do início da mídia e recusa um terceiro participante na sala de duas pessoas. O link e a reentrada preservam o modo; ao entrar pelo código, o convidado recebe a configuração do anfitrião. O modo direto pode falhar em redes que exigem TURN. Grupo continua com a malha PeerJS original, sem servidor SFU; o consumo de banda cresce com os participantes. Para mudar o modo, crie outra sala.

Para hospedar a web/API, configure `HOST=0.0.0.0` e coloque o serviço atrás de HTTPS. O navegador permite microfone/câmera em localhost ou HTTPS. Configure `STATZ_ALLOWED_ORIGINS` com as origens exatas do frontend, separadas por vírgulas, se a API estiver em outro domínio. `STATZ_API_URL` altera a configuração servida pela versão web. `PORT` altera a porta do serviço (3030 por padrão).

As salas e chamadas mantêm o código PeerJS/WebRTC original, com sinalização pública do PeerJS e servidores STUN/TURN do frontend recuperado. A API fornece contas e administração; ela não controla a autorização de entrada nas salas PeerJS. Um código de sala pode permitir conexão por clientes externos. Para salas privadas com autorização forte, é necessário reconstruir também a sinalização autenticada. Serviços externos e conectividade entre redes ainda precisam de teste real com dois computadores.

## Limitações desta entrega

- Captura nativa isolada de áudio por processo (WASAPI) não foi recuperada nem reimplementada. Esse controle fica oculto no desktop; compartilhamento via navegador mantém o código original.
- Atualização automática do instalador não está habilitada: requer nova implementação e chave de assinatura controlada por você. Os manifests antigos não devem assinar esta reconstrução.
- O instalador não foi compilado nesta máquina: Rust/Cargo não estão instalados. A fonte Tauri e o ícone estão incluídos.
- Não houve teste de chamada real, microfone, câmera ou compartilhamento entre dispositivos. A inspeção visual automatizada também não foi concluída porque o ambiente impediu a execução do navegador.
- A API usa arquivo JSON e atende uma única instância. Não execute várias instâncias sobre o mesmo `data/`.

## Verificação

`npm test` verifica autenticação, autorização de administrador, KEY de uso único, aprovação, bloqueio de sessão, token adulterado, proteção dos dados e leitura do banco persistido. O frontend também pode ser verificado diretamente em http://localhost:3030.

## Teste publicado em 02/10/2026

Site: https://statz-ms.github.io/call/. A API está em um túnel HTTPS temporário, hospedado no computador do proprietário. Se o processo ou computador parar, o login fica indisponível. Ao reiniciar um Quick Tunnel, o endereço muda e `config.js` do site precisa ser atualizado. As contas novas não recuperam o banco antigo. As senhas e a chave privada não estão neste repositório.

O frontend consulta `/api/ice-config` após o login. `STATZ_ICE_SERVERS` pode conter um JSON com servidores TURN próprios; sem essa variável, a API entrega os servidores públicos OpenRelay usados no backup. Credenciais antigas da Metered não foram recuperadas. A sala dupla filtra os servidores TURN da configuração da mídia.
