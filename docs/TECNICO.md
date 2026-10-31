# Notas técnicas

`SITE` = endereço do site (ex.: `https://portal.seudominio.com.br`). `WORKER` = endereço do worker (ex.: `https://portaldomago-realtime.SEU-SUBDOMINIO.workers.dev`).

## Arquitetura

- **Site**: Next.js 16 (App Router) na Vercel. Arte 100% procedural (`lib/portal/art.ts`), sem assets de terceiros. Tokens de marca em `app/globals.css` (`--pm-*`), mascote em `public/mago.webp`.
- **Tempo real**: Cloudflare Worker `realtime/` com Durable Objects:
  - `Room`: uma instância por sala (`salao` é a principal, `teste` é a de ensaio; qualquer `?sala=nome` cria outra). WebSocket Hibernation API.
  - `Archive`: uma instância só; guarda os metadados das gravações e a fila de transcrição.
- **Live**: o navegador do Mago publica no Cloudflare Realtime SFU (proxy em `WORKER/sfu/*`, o segredo do app fica só no worker). TURN para quem está atrás de rede difícil.
- **Gravação**: o navegador do Mago compõe o que a sala vê (1280×720/30: câmera/tela/tela+câmera + mic + áudio da aba + convidados do palco), grava fMP4 (H.264/AAC; webm se o navegador não fizer mp4) em segmentos HLS e sobe a cada ~4 s para o R2 via `WORKER/lives/rec/*` (só chave host/admin). Áudio vai à parte em blocos de 5 min. Recarregar a página = parte nova da mesma live (o player emenda com `EXT-X-DISCONTINUITY`). A sala `teste` grava como **oculta**.
- **Transcrição + Oráculo**: ao encerrar, o `Archive` transcreve cada bloco com Workers AI (`@cf/openai/whisper-large-v3-turbo`, pt, 3 tentativas) e chama `SITE/api/lives/ingest` (sem segredo compartilhado: nonce de uso único conferido de volta no worker). A rota quebra em trechos de ~75 s, gera embeddings e5-small e grava como aula `n ≥ 1001` (módulo "Lives do Portal") + `curso.portal_lives`. Ocultar/apagar tira a aula do Oráculo; publicar/renomear reingere; **Reprocessar** refaz.
- **Oráculo**: busca híbrida (full-text português + vetores pgvector 384d, modelo `Xenova/multilingual-e5-small` rodando dentro da função da Vercel, baixado no `prebuild` por `cli/fetch-model.mjs`) em trechos e capítulos, resposta do Claude Haiku com citações. Limites por IP/navegador e disjuntor de gasto diário (`DAILY_BUDGET_USD`).
- **Membros**: `curso.portal_members` alimentada pelo webhook da Kiwify, pela sync da API da Kiwify, por CSV ou à mão em `/admin/membros`. Login por código de 6 dígitos por e-mail (Resend), cookie assinado de 30 dias; o site emite um token de membro (`m1.<payload>.<HMAC>`, 12 h) que o worker confere com `MEMBER_TOKEN_SECRET`.

## Papéis e links

- **host** (o Mago, selo MAGO dourado) e **admin** (selo ADMIN vermelho). Definidos no segredo `ADMIN_KEYS` do worker: `{"nome":{"key":"…","role":"host|admin"}}` (key com 12+ caracteres). `ADMIN_KEY` (legada) também é admin.
- Link pessoal: `SITE/?k=<key>` salva a chave no navegador e limpa a URL. `?k=off` remove. Com código: `SITE/?c=<ROOM_CODE>&k=<key>`.
- Link do grupo: `SITE/?c=<ROOM_CODE>` já preenche o código.
- Sala de ensaio: `SITE/?sala=teste`.
- Trocar uma chave: gerar outra, atualizar `ADMIN_KEYS` (`npx wrangler secret put ADMIN_KEYS`). A antiga para de valer na hora.

## Moderação

- Na sala (admin/host): clicar no nome → mutar / desmutar / expulsar (30 min). No chat: `/aviso texto` posta como Corvo Mensageiro, `/limpar` limpa o histórico.
- Por HTTP: `curl -X POST "WORKER/admin?room=salao" -d '{"key":"…","action":"kick","target":"Nome"}'` (actions: `stats`, `kick`, `mute`, `unmute`, `unban`, `clear`, `announce`).

## Endpoints do worker

`/ws?room=salao`, `/info` (inclui `live`, `sfu`, `online`, `mode`), `/check?c=`, `/ice`, `POST /admin`, `/sfu/*` (exige acesso à sala), `/lives/list`, `/lives/<id>/meta|token|admin|job`, `/lives/rec/*`.

## Modos de entrada

`AUTH_MODE` = `code` | `both` | `kiwify`, com exceções por sala em `KIWIFY_ONLY_ROOMS` e `BOTH_ROOMS` (listas com vírgula). O worker decide quem entra; a Vercel espelha as mesmas variáveis para as páginas de membros (`/links`, `/lives`). Mantenha os dois iguais. Chaves host/admin entram sempre.

## Teste de carga

```sh
cd realtime && npm ci
PORTAL_WS_URL=WORKER PORTAL_ROOM_CODE=<código> node loadtest.mjs --n 300 --secs 60 --room teste
# live: + PORTAL_ADMIN_KEY=<chave admin> e --live 1 (300 reagem, levantam a mão, tentam abrir o mic; vazamento de mic tem que ser 0)
# sala só de membros: + PORTAL_MEMBER_TOKEN_SECRET=<segredo> e --mt 1
```
Rode sempre na sala `teste`, nunca no `salao` com gente dentro.

## Next.js 16

Esta versão tem mudanças grandes em relação a versões antigas. Antes de mexer em código, leia o guia em `node_modules/next/dist/docs/`.
