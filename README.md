# SquadCall — contas + KEY + aprovação + sessão offline

Esta versão usa a API **somente para cadastro, login inicial e administração**.
Depois que o usuário faz login, o servidor entrega um JWT RS256 assinado. O `index.html` guarda o token no navegador e verifica a assinatura localmente com a chave pública embutida. Assim, a API pode ser desligada e o usuário continua usando o SquadCall enquanto o token estiver válido.

## Estrutura

- `index.html` — seu SquadCall atual, com tela de login/cadastro e painel admin.
- `api/server.js` — API local.
- `api/data/users.json` — banco local de usuários.
- `api/data/invites.json` — KEYs de cadastro.
- `api/keys/private.pem` — chave privada do servidor (NUNCA publique).
- `api/keys/public.pem` — chave pública correspondente.
- `api/iniciar-api.bat` — instala dependências e inicia a API.
- `api/iniciar-tunel.bat` — opcional, publica a API para pessoas fora do seu PC usando Cloudflare Tunnel.

## 1. Coloque a pasta no seu PC

Não publique `api/data` nem `api/keys/private.pem` no GitHub.

## 2. Primeira execução

Abra `api/iniciar-api.bat`.

Na primeira vez, digite a senha do administrador quando o arquivo pedir.
O usuário inicial é:

`admin`

A senha é a que você digitou.

Depois disso, o servidor cria os arquivos do banco automaticamente.

## 3. Para alguém de fora fazer cadastro

O `index.html` precisa conseguir acessar sua API. `localhost` só funciona no seu próprio PC.

A opção simples é usar Cloudflare Tunnel:

1. Instale o `cloudflared`.
2. Abra `iniciar-api.bat`.
3. Em outra janela, execute `iniciar-tunel.bat`.
4. O Cloudflare mostrará uma URL `https://...trycloudflare.com`.
5. No `index.html`, altere:

`const AUTH_API = window.SQUADCALL_AUTH_API || 'http://localhost:8787';`

para:

`const AUTH_API = window.SQUADCALL_AUTH_API || 'https://SUA-URL.trycloudflare.com';`

Enquanto o túnel estiver fechado, ninguém conseguirá cadastrar ou fazer o login inicial. Usuários que já possuem um token válido continuam usando o SquadCall sem consultar a API.

## 4. Fluxo

Você liga a API/túnel → gera KEY → envia KEY → pessoa cria conta → conta fica aguardando → você abre o painel Admin → Aprovar → pessoa faz login uma vez → token é salvo e pode continuar usando com a API desligada.

## Importante sobre bloqueio

Como o token funciona offline, bloquear uma conta depois de ela já ter recebido um token **não revoga instantaneamente o token que já está no navegador**. O token expira após `TOKEN_DAYS` (padrão: 30 dias). Para uma revogação imediata seria necessário consultar a API novamente.

## Segurança

- Senhas não são salvas em texto puro; usam `scrypt` + salt.
- A sessão é um JWT RS256.
- A chave privada fica somente no servidor local.
- Não publique `api/keys/private.pem` nem os arquivos de banco.
