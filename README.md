# SquadCall — autenticação e whitelist

Este projeto separa o SquadCall em duas partes:

- `index.html`: frontend estático, compatível com GitHub Pages.
- `server.js`: API de login/admin, que precisa rodar em um servidor Node (ex.: Render).
- PostgreSQL: banco de usuários e sessões.

## 1. Backend no Render

O GitHub Pages não executa Node.js. Suba este projeto para um repositório e crie um **Web Service** no Render.

Configuração:
- Runtime: Node
- Build: `npm install`
- Start: `npm start`

Crie também um PostgreSQL e coloque sua `DATABASE_URL` nas variáveis do serviço.

Variáveis obrigatórias:
- `DATABASE_URL`
- `FRONTEND_ORIGIN` — ex.: `https://statz-ms.github.io`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

O servidor cria o administrador inicial automaticamente no primeiro deploy.

## 2. Banco

O `server.js` cria as tabelas automaticamente:
- `users`
- `sessions`

Senhas não são salvas em texto puro; são derivadas com `scrypt` + salt aleatório.

## 3. Frontend

No começo do `authScript` em `index.html`, troque:

`https://SEU-BACKEND.onrender.com`

pela URL real do seu backend.

Exemplo:

`https://squadcall-auth-api.onrender.com`

Depois faça commit do `index.html` no GitHub Pages.

## 4. Primeiro login

Use o `ADMIN_USERNAME` e `ADMIN_PASSWORD` configurados no Render.

Depois de entrar, aparecerá **⚙ Admin**. Pelo painel você pode:
- criar usuários;
- bloquear/ativar;
- alterar senha;
- excluir usuários.

## Importante

Não coloque `ADMIN_PASSWORD`, `DATABASE_URL` ou outras credenciais no `index.html` ou no GitHub.

O frontend contém apenas a URL pública da API.

## Segurança

Esta é uma base de autenticação real, mas para produção pública eu ainda recomendaria adicionar rate limiting, recuperação de senha e logs/auditoria antes de expor o serviço amplamente.
