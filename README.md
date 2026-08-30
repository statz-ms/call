# SquadCall + autenticação local

- `index.html`: SquadCall com login, cadastro por KEY, aprovação e painel admin.
- `api/server.js`: API local de cadastro/login/admin.
- O login gera JWT RS256; a chave pública é baixada e armazenada no navegador, permitindo validar a sessão sem a API depois do login.

## API

Na pasta `api`, execute `iniciar-api.bat`.

A URL pública usada no `index.html` neste pacote é o Quick Tunnel atual:
`https://discovery-plains-convicted-honolulu.trycloudflare.com`

Se o Quick Tunnel mudar, altere `AUTH_API` no `index.html` para a nova URL.

## Segurança

Não publique `data/`, `keys/private.pem` ou outras credenciais no GitHub. O banco local e as chaves são gerados pelo servidor.
