# Statz 1.3.2

Chamadas WebRTC com escolha entre sala de duas pessoas (mídia direta sem TURN) e sala de grupo (TURN disponível). Frontend preservado da 1.3.1, API Node.js reconstruída e fonte Tauri v2.

Site: https://statz-ms.github.io/call/

Para executar a API e frontend local: `npm start`. Ela cria um administrador e mostra a senha somente na primeira inicialização. Dados privados ficam em `data/` e não devem ser publicados.

A API do teste publicado usa um túnel HTTPS temporário no computador do proprietário. Se ele parar, o login deixa de funcionar. Consulte [LEIA-ME](LEIA-ME.md) para hospedagem, desktop e limitações.

Verificações: testes de autenticação/admin, limites e configuração das salas. Teste local em navegadores separados com dispositivos de mídia simulados: chamada dupla nos dois sentidos, terceiro recusado e grupo com três participantes conectados entre si. O comportamento em redes diferentes ainda precisa ser testado.
