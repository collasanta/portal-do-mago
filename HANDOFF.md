# HANDOFF: colocando o Portal do Mago na sua infraestrutura

Guia completo, em ordem. Cada passo diz **o que é**, **quem faz** (🤖 agente / 🧙 Mago), os **comandos** e **como conferir**.

> Para o agente: siga o [AGENTS.md](AGENTS.md). Um passo por vez, você roda os comandos, o Mago só clica e cola chaves. Anote o andamento em `SETUP-PROGRESSO.md` (fora do git, sem segredos).

Tempo total: umas 2 a 3 horas, a maior parte esperando contas e DNS.

**Nomes usados abaixo**
- `SITE` = endereço do site (no começo `https://<projeto>.vercel.app`, depois o seu domínio).
- `WORKER` = endereço do worker de tempo real (`https://portaldomago-realtime.<subdominio>.workers.dev`).
- `.env.local` = arquivo de variáveis do site na raiz do projeto (copiado de `.env.example`).
- `realtime/.dev.vars` = arquivo de segredos do worker (copiado de `realtime/.dev.vars.example`).
Os dois ficam **só no seu computador** e já estão no `.gitignore`.

---

## Passo 0 — Preparar o computador e o seu repositório

**Quem:** 🤖 (o 🧙 cria a conta no GitHub se não tiver).

1. Conferir ferramentas: `node -v` (precisa 20 ou mais; 22 recomendado), `npm -v`, `git --version`. No Mac, se faltar: `brew install node git`. Para o passo 5 (opção C) também `ffmpeg`.
2. 🧙 Ter uma conta no **GitHub** (github.com). Criar um repositório **privado** vazio, por exemplo `portal-do-mago`.
3. 🤖 Trazer o código para o repositório privado dele (sem fork público):
   ```sh
   git clone https://github.com/collasanta/portal-do-mago.git
   cd portal-do-mago
   git remote rename origin upstream          # de onde vêm atualizações
   git remote add origin https://github.com/<usuario-do-mago>/portal-do-mago.git
   git push -u origin main
   ```
4. 🤖 Instalar dependências e criar os arquivos de variáveis:
   ```sh
   npm ci
   cp .env.example .env.local
   (cd realtime && npm ci && cp .dev.vars.example .dev.vars)
   ```

**Conferir:** `git remote -v` mostra `origin` (do Mago, privado) e `upstream`. `npm run build` pode falhar aqui por falta de variáveis reais; tudo bem.

---

## Passo 1 — Criar as contas

**Quem:** 🧙 (o 🤖 explica cada uma e espera).

| Conta | Para quê | Plano | Observação |
|---|---|---|---|
| **Cloudflare** (dash.cloudflare.com) | Salas em tempo real, vídeo da live, gravações, transcrição | **Workers Paid, US$ 5/mês** (Workers & Pages → Plans) | Necessário: Durable Objects com 300 pessoas por 2 h passam do plano grátis. Pede cartão. |
| **Vercel** (vercel.com) | O site | Hobby (grátis) funciona; **Pro (US$ 20/mês)** é o indicado para uso comercial | Entrar com o GitHub facilita. |
| **Supabase** (supabase.com) | Banco de dados (Postgres + pgvector) | Free serve para começar; Pro US$ 25/mês se crescer | Região **East US (N. Virginia)**, a mesma das funções da Vercel. |
| **Anthropic** (console.anthropic.com) | Respostas do Oráculo | Pré-pago (créditos) | Colocar **limite de gasto mensal** (Settings → Limits), ex.: US$ 20. |
| **Resend** (resend.com) | E-mail com o código de login dos membros | Free (3.000 e-mails/mês, 100/dia) | Precisa de um **domínio próprio** para enviar para qualquer pessoa (passo 8). |
| **Kiwify** | Já existe (onde o curso é vendido) | — | Usada no passo 11. |

Domínio (opcional, recomendado): um domínio seu, ex. `seudominio.com.br`, para o site (`portal.seudominio.com.br`) e para o remetente dos e-mails.

**Conferir:** o Mago consegue entrar nas 5 contas no navegador.

---

## Passo 2 — Gerar os segredos

**Quem:** 🤖

```sh
npm run secrets -- admin mago
```
Imprime valores aleatórios e diz onde vai cada um. O 🤖 preenche direto (sem colar na conversa):
- no `.env.local`: `PORTAL_SESSION_SECRET`, `ORACULO_SESSION_SECRET`, `PORTAL_MEMBER_TOKEN_SECRET`;
- no `realtime/.dev.vars`: `ROOM_CODE`, `ADMIN_KEY`, `ADMIN_KEYS` (JSON numa linha), `MEMBER_TOKEN_SECRET` (**o mesmo valor** de `PORTAL_MEMBER_TOKEN_SECRET`), `LIVES_SECRET`.

As duas **chaves pessoais** (admin e mago) viram os links mágicos no passo 9. Peça ao 🧙 para guardar o conteúdo dos dois arquivos num gerenciador de senhas (1Password, Bitwarden): se o computador sumir, é dali que tudo se recupera.

**Conferir:** `grep -c GERAR .env.local` dá 0 nas linhas de segredo; `realtime/.dev.vars` tem `ADMIN_KEYS={"admin":{...},"mago":{...}}` numa linha só.

---

## Passo 3 — Banco de dados (Supabase)

**Quem:** 🧙 cria o projeto e copia a URL; 🤖 roda as migrações.

1. 🧙 Supabase → **New project**: nome `portal-do-mago`, senha forte do banco (guardar), região **East US (N. Virginia)**.
2. 🧙 No projeto: botão **Connect** (topo) → **Connection string** → **Transaction pooler** (porta **6543**). Copiar e trocar `[YOUR-PASSWORD]` pela senha.
3. 🤖 Gravar em `.env.local` como `ORACULO_DATABASE_URL=...`.
4. 🤖 Criar todas as tabelas (Oráculo + Portal) e semear o mural de links:
   ```sh
   npm run db:migrate -- --seed-links
   ```
   Cria, no schema `curso`: `courses`, `lessons`, `segments`, `chunks`, `chapters`, `conversations`, `messages`, `usage`, `questions`, `inflight`, `portal_members`, `portal_login_codes`, `portal_member_events`, `portal_links`, `portal_lives`, e as extensões `vector` e `unaccent`. Pode rodar de novo quando quiser (não apaga nada).

**Conferir:** a saída lista as 15 tabelas e `extensões: vector@extensions, unaccent@extensions`.

> Outro Postgres (Neon, por exemplo) também serve, desde que tenha `vector` e `unaccent`. As migrações criam um schema `extensions` e instalam as extensões nele.

---

## Passo 4 — Chave da Anthropic

**Quem:** 🧙 cria; 🤖 grava.

1. 🧙 console.anthropic.com → **API Keys** → **Create Key** (nome `portal-do-mago`). Colocar créditos (Billing) e o **limite mensal** (Limits).
2. 🤖 Gravar em `.env.local` como `ANTHROPIC_API_KEY=...`.

O Oráculo também tem um disjuntor próprio: `DAILY_BUDGET_USD` (padrão US$ 3/dia) e limites por pessoa (20 perguntas/dia). Ajuste no `.env.local` se quiser.

**Conferir:** a chave aparece em console.anthropic.com → API Keys. A prova real é a pergunta ao Oráculo no passo 10.

---

## Passo 5 — Carregar o conteúdo do curso no Oráculo

**Quem:** 🤖 (com o arquivo que o 🧙 recebe em privado).

O conteúdo do curso **não está no repositório** (é pago). Tudo fica na pasta `course-data/`, que o git ignora. Escolha **uma** opção:

**Opção A — arquivo pronto (recomendada).** O Victor entrega em privado um `curso.jsonl.gz` com as aulas já transcritas, quebradas em trechos, com vetores e capítulos (exportado de outro banco com `npm run course:export`).
```sh
mkdir -p course-data   # coloque o curso.jsonl.gz aqui
npm run course:import -- course-data/curso.jsonl.gz
```

**Opção B — transcrições em JSON.** Se você tem as transcrições (`NN.json` do Whisper):
1. `course-data/lessons.tsv`, uma aula por linha, separado por TAB, sem cabeçalho:
   `NN<TAB>Módulo<TAB>Título<TAB>duração em segundos[<TAB>kiwify_path opcional]`
   Ex.: `01	Nichos e Modelagem	Live 1 - Minerando nichos	8474.8`
2. `course-data/transcripts/01.json`, `02.json`, ...: `{"segments":[{"start":0,"end":4.2,"text":"..."}]}`
3. Rodar:
   ```sh
   npm run course:ingest            # trechos + vetores, local, sem custo (baixa o modelo de 120 MB uma vez)
   npm run course:chapters          # capítulos e resumos com Claude Haiku (~US$ 0,02–0,05 por aula)
   ```

**Opção C — só tem os vídeos/áudios.** Transcrever primeiro e depois seguir a opção B:
- Pela Cloudflare (mesmo Whisper das lives, ~US$ 0,03 por hora de áudio): 🧙 cria um token em dash.cloudflare.com → My Profile → API Tokens → **Create Token** → modelo **Workers AI** e copia também o **Account ID** (Workers & Pages, coluna da direita). 🤖 grava `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_API_TOKEN` no `.env.local` e roda:
  ```sh
  brew install ffmpeg   # se faltar
  npm run course:transcribe -- course-data/audio/01.mp4 course-data/audio/02.mp4
  ```
  O nome do arquivo (`01`, `02`) tem que bater com a 1ª coluna do `lessons.tsv`.
- Ou local e grátis (Mac com Apple Silicon): `pip install mlx-whisper` e transcrever com o modelo `mlx-community/whisper-large-v3-turbo`, `language="pt"`, `condition_on_previous_text=False`, salvando `{"segments":[{start,end,text}]}` em `course-data/transcripts/NN.json`.

**Links para a aula na Kiwify (opcional):** as citações do Oráculo podem abrir a aula na área de membros. Preencha `kiwify_path` por aula (5ª coluna do TSV, ou já vem no arquivo da opção A) e a base do curso:
```sql
update curso.courses set kiwify_base = 'https://members.kiwify.com/<id-da-area>', kiwify_club = '<club-id ou null>' where slug = 'grimorio';
```
(Supabase → SQL Editor.) O link final é `kiwify_base/kiwify_path?club=kiwify_club`. Sem isso, as citações mostram só aula e minuto.

**Conferir:** `course:import` ou `course:ingest` termina com o total de trechos e quantos têm vetor (devem ser iguais).

---

## Passo 6 — Cloudflare: worker de tempo real

**Quem:** 🧙 faz login e ativa o R2; 🤖 faz o resto.

1. 🤖 `cd realtime && npx wrangler login` → 🧙 autoriza no navegador.
2. 🧙 Ativar o plano **Workers Paid** (se ainda não fez) e o **R2** (dashboard → R2 → *Purchase/Enable*; tem cota grátis de 10 GB, pede cartão).
3. 🤖 Criar o bucket das gravações:
   ```sh
   npx wrangler r2 bucket create portaldomago-lives
   ```
4. 🤖 Primeiro deploy (cria o worker, os Durable Objects `Room` e `Archive` pelas migrations `v1`/`v2` do `wrangler.jsonc`, liga o R2 e o Workers AI):
   ```sh
   npx wrangler deploy
   ```
   Anotar o endereço que aparece no fim: esse é o `WORKER` (`https://portaldomago-realtime.<subdominio>.workers.dev`). Na primeira vez a Cloudflare pode pedir para escolher o subdomínio `workers.dev`.
5. 🤖 Enviar os segredos do worker (do `realtime/.dev.vars`; os de SFU/TURN entram no passo 7):
   ```sh
   npx wrangler secret bulk .dev.vars
   ```
   Se o `bulk` reclamar do formato, um por um: `npx wrangler secret put ROOM_CODE` (cola o valor), e assim para `ADMIN_KEYS`, `ADMIN_KEY`, `MEMBER_TOKEN_SECRET`, `LIVES_SECRET`, `AUTH_MODE`.
6. 🤖 Gravar `NEXT_PUBLIC_REALTIME_URL=<WORKER>` no `.env.local`.

**Conferir:**
```sh
curl -s <WORKER>/info
```
Responde algo como `{"codeRequired":true,"mode":"code","room":"salao","online":0,"live":false,"sfu":false}`. (`sfu` vira `true` no passo 7.) `npx wrangler secret list` mostra os nomes.

---

## Passo 7 — Cloudflare Realtime: vídeo da live (SFU) e TURN

**Quem:** 🧙 clica no painel (ou passa um token); 🤖 grava os segredos.

1. 🧙 dashboard → **Realtime** → **Serverless SFU** → **Create** (nome `portal-do-mago`). Copiar **App ID** e **App Token**.
2. 🧙 **Realtime** → **TURN Server** → **Create** (nome `portal-do-mago`). Copiar **Turn Token ID** e **API Token**.
   - Alternativa via API (se o 🧙 criar um token com permissão *Calls: Edit*): `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/calls/apps` com `{"name":"portal-do-mago"}` devolve `uid` (App ID) e `secret`; `POST .../calls/turn_keys` com `{"name":"portal-do-mago"}` devolve `uid` e `key`.
3. 🤖 Gravar no `realtime/.dev.vars` e enviar:
   ```sh
   cd realtime
   npx wrangler secret put CALLS_APP_ID
   npx wrangler secret put CALLS_APP_SECRET
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_TOKEN
   ```

**Conferir:** `curl -s <WORKER>/info` agora mostra `"sfu":true`. `curl -s <WORKER>/ice` devolve `iceServers` com `turn:` (TURN ok).

---

## Passo 8 — E-mail (Resend + domínio)

**Quem:** 🧙 (DNS); 🤖 grava a chave.

1. 🧙 resend.com → **Domains** → **Add Domain** (ex.: `seudominio.com.br`). O Resend mostra registros DNS (MX, TXT de SPF e DKIM). Criar esses registros onde o domínio é gerenciado (Registro.br, Cloudflare, Hostinger...). Esperar ficar **Verified** (minutos a algumas horas).
2. 🧙 **API Keys** → **Create API Key** (permissão *Sending access*).
3. 🤖 No `.env.local`: `RESEND_API_KEY=...` e `PORTAL_EMAIL_FROM=Portal do Mago <acesso@seudominio.com.br>`.

Sem domínio verificado o Resend só entrega para o próprio dono da conta. Isso só importa quando ligar o acesso por e-mail (passo 11); o salão com código funciona sem e-mail.

**Conferir:** o domínio aparece como *Verified* no Resend. O teste real é no passo 11.

---

## Passo 9 — Site na Vercel

**Quem:** 🧙 faz login; 🤖 faz o resto.

1. 🤖 `npx vercel login` → 🧙 autoriza. Depois `npx vercel link` na raiz (criar projeto novo `portal-do-mago`, framework Next.js, sem mudar configurações).
2. 🧙 (recomendado) Na Vercel: projeto → **Settings → Git** → conectar ao repositório privado dele. Assim todo push na `main` publica sozinho.
3. 🤖 Enviar as variáveis preenchidas do `.env.local` para a Vercel (production), sem mostrar valores:
   ```sh
   npm run vercel:env -- --dry    # lista o que vai
   npm run vercel:env
   npx vercel deploy --prod
   ```
4. 🤖 Anotar o endereço do site (`SITE`). Se for usar domínio próprio: 🧙 Vercel → projeto → **Settings → Domains** → adicionar `portal.seudominio.com.br` e criar o CNAME que a Vercel pedir.
5. 🤖 Dizer ao worker onde está o site (o worker chama o site para mandar as lives para o Oráculo): editar `realtime/wrangler.jsonc`, trocar `"NEXT_URL": "https://SEU-SITE.vercel.app"` pelo `SITE` final, commitar e:
   ```sh
   cd realtime && npx wrangler deploy
   ```

Importante: `NEXT_PUBLIC_REALTIME_URL` entra no build. Se o endereço do worker mudar, atualize na Vercel e faça redeploy do site.

**Conferir:** abrir `SITE` → aparece "Monte seu personagem" e "1 mago no salão agora" (ou o número de pessoas). Abrir `SITE/oraculo` → a página carrega.

---

## Passo 10 — Links mágicos, primeiro teste completo

**Quem:** 🤖 monta os links; 🧙 testa no navegador.

1. 🤖 Montar (e entregar ao 🧙 por um canal privado, nunca no grupo):
   - Link do Mago: `SITE/?c=<ROOM_CODE>&k=<chave pessoal do mago>`
   - Link do admin: `SITE/?c=<ROOM_CODE>&k=<chave pessoal do admin>`
   - Link da turma: `SITE/?c=<ROOM_CODE>`
2. 🧙 Abrir o link pessoal no **Chrome ou Edge do computador** → montar o boneco → entrar. O nome aparece com o selo **MAGO**.
3. 🧙 Fazer uma pergunta no **Oráculo** (mesa do Oráculo na sala, ou `SITE/oraculo`) sobre algo das aulas. A resposta deve citar aula e minuto.
4. 🧙 Ensaiar uma live em `SITE/?sala=teste` (ver [docs/GUIA-DO-MAGO.md](docs/GUIA-DO-MAGO.md)): Live → Iniciar → Ligar câmera → falar 1 minuto → Encerrar. Abrir em outra janela anônima como aluno para ver o que a turma vê.
5. 🤖 Conferir a gravação: `SITE/lives` (com a chave de admin aparece a live oculta da sala teste). Uns minutos depois a transcrição termina; se a live for publicada, ela entra no Oráculo.

**Conferir:** os 5 itens acima funcionaram. `npx wrangler tail` (em `realtime/`) mostra os eventos sem erros.

---

## Passo 11 — Kiwify: entrada pelo e-mail da compra

**Quem:** 🧙 no painel da Kiwify; 🤖 grava e liga.

Siga [docs/KIWIFY.md](docs/KIWIFY.md). Resumo:
1. 🧙 Kiwify → Apps → **Webhooks** → criar com URL `SITE/api/kiwify/webhook`, os 6 eventos, e copiar o **token**.
2. 🧙 Kiwify → Apps → **API** → criar chave e copiar **Client ID**, **Client Secret** e **Account ID**.
3. 🤖 No `.env.local`: `KIWIFY_WEBHOOK_TOKEN`, `KIWIFY_CLIENT_ID`, `KIWIFY_CLIENT_SECRET`, `KIWIFY_ACCOUNT_ID`, e o produto: `KIWIFY_PRODUCT_IDS` (o ID do produto aparece na URL do produto no painel da Kiwify; na dúvida, `KIWIFY_SYNC_ALL_PRODUCTS=1` + `npm run kiwify:sync -- --dry` mostra o que a sync faria). Depois `npm run vercel:env` e `npx vercel deploy --prod`.
4. 🤖 Primeira sincronização (traz quem já comprou): `npm run kiwify:sync`. Ou o botão **Sincronizar** em `SITE/admin/membros`.
5. 🤖 Deixar a sala de ensaio só para membros: `KIWIFY_ONLY_ROOMS=teste` no worker (`npx wrangler secret put KIWIFY_ONLY_ROOMS`) **e** na Vercel (mesmo valor), redeploy.
6. Virada do salão principal, sem susto para a turma:
   - **`code` → `both`**: todo mundo continua com o código e quem quiser já entra pelo e-mail.
     ```sh
     cd realtime && printf both | npx wrangler secret put AUTH_MODE
     cd .. && printf both | npx vercel env add AUTH_MODE production --force && npx vercel deploy --prod
     ```
   - 🧙 avisa no grupo a data da troca.
   - **`both` → `kiwify`**: mesmo comando com `kiwify`. O código da sala deixa de valer. Os links pessoais (host/admin) sempre entram.
   Mantenha `AUTH_MODE` **igual** no worker e na Vercel.

**Conferir:** em `SITE/?sala=teste`, numa janela anônima, entrar com o e-mail de um comprador real (ou liberado à mão em `/admin/membros`) → chega o código por e-mail → entra. O botão **Testar Webhook** da Kiwify faz aparecer `johndoe@example.com` em `/admin/membros` (apague depois).

---

## Passo 12 — Antes de cada live

Use [docs/CHECKLIST-DA-LIVE.md](docs/CHECKLIST-DA-LIVE.md). O essencial: ensaio em `?sala=teste`, `curl <WORKER>/info` com `"sfu":true`, saldo da Anthropic, link reserva no YouTube.

---

## Custos (aproximados; confira os preços atuais em cada site)

**Fixo por mês**
| Item | Valor |
|---|---|
| Cloudflare Workers Paid | US$ 5 |
| Vercel | US$ 0 (Hobby) ou US$ 20 (Pro) |
| Supabase | US$ 0 (Free) ou US$ 25 (Pro) |
| Resend | US$ 0 até 3.000 e-mails/mês |
| Domínio | ~R$ 40/ano (.com.br) |

**Por live de 2 h com ~300 pessoas**
| Item | Valor |
|---|---|
| Vídeo (Realtime SFU/TURN) | ~400 GB de saída. A Cloudflare dá **1 TB grátis por mês**; acima disso ~US$ 0,05/GB. Na prática, 1–2 lives por semana ficam perto de zero; em qualidade "alta" ou com muitas lives, passa da cota. |
| Durable Objects (salas, chat) | dentro dos US$ 5 do plano na maioria dos meses |
| Gravação no R2 | ~1,4 GB por live (~US$ 0,02/mês guardado; 10 GB grátis; download grátis) |
| Transcrição (Whisper) | ~US$ 0,06 |

**Oráculo**: Claude Haiku, menos de US$ 0,01 por pergunta. Teto pelo disjuntor `DAILY_BUDGET_USD` (US$ 3/dia padrão) e pelo limite mensal na Anthropic.

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Tela de entrada não mostra "no salão agora" / não conecta | `NEXT_PUBLIC_REALTIME_URL` errado ou site não foi rebuildado depois de mudar | Conferir na Vercel e fazer redeploy. `curl <WORKER>/info` tem que responder. |
| "Código da sala incorreto" | `ROOM_CODE` diferente do link | `npx wrangler secret put ROOM_CODE` com o valor certo. |
| Live não abre câmera para ninguém / `"sfu":false` | Segredos `CALLS_APP_ID`/`CALLS_APP_SECRET` faltando | Passo 7. |
| Alguns alunos não veem o vídeo (rede de empresa/4G) | TURN faltando | Passo 7 (TURN). `curl <WORKER>/ice` tem que ter `turn:`. |
| Aluno não ouve | Bloqueio de autoplay | Ele clica **🔊 Clique pra ouvir**. |
| Gravação não aparece em `/lives` | R2 não criado / sala teste grava oculta | `npx wrangler r2 bucket list`; entrar com a chave de admin para ver as ocultas. |
| Live gravada não entra no Oráculo | `NEXT_URL` do worker errado, ou erro em `/api/lives/ingest` | Passo 9, item 5. Ver logs da Vercel (função `/api/lives/ingest`) e `npx wrangler tail`. Em `/lives`, admin → **Reprocessar**. |
| Oráculo: "descansando" | `DAILY_BUDGET_USD` atingido, `CHAT_ENABLED=false` ou sem crédito na Anthropic | Ver créditos; ajustar variável e redeploy. |
| Oráculo erra o banco / timeout | URL do banco sem pooler ou região longe | Usar a URL do **Transaction pooler** (porta 6543), Supabase em East US. |
| "Não chegou o código" no login | Domínio não verificado no Resend, spam, ou e-mail diferente da compra | Passo 8; liberar o e-mail à mão em `/admin/membros`. |
| Webhook da Kiwify não libera ninguém | Token diferente ou produto fora do filtro | `KIWIFY_WEBHOOK_TOKEN` igual ao da Kiwify; `KIWIFY_PRODUCT_IDS` certo; ver eventos em `/admin/membros`. |
| Build da Vercel falha no `prebuild` | Falha ao baixar o modelo do Hugging Face | Tentar o deploy de novo (é rede). |

Logs: `cd realtime && npx wrangler tail` (worker) e Vercel → projeto → **Logs** (site).

---

## Como atualizar

- **Mudanças suas**: commit e push na `main` → a Vercel publica sozinha. Se mexeu em `realtime/`: `cd realtime && npx wrangler deploy`.
- **Atualizações do código original**:
  ```sh
  git fetch upstream && git merge upstream/main
  npm ci && npm run build && (cd realtime && npm ci && npx tsc --noEmit)
  npm run db:migrate          # se vieram tabelas novas (é idempotente)
  git push origin main && (cd realtime && npx wrangler deploy)
  ```
  Leia o histórico de commits do `upstream` antes: pode haver variável nova no `.env.example` / `realtime/.dev.vars.example`.
- **Trocar uma chave pessoal** (link vazou): `npm run secrets`, pegar uma chave nova, atualizar `ADMIN_KEYS` (`npx wrangler secret put ADMIN_KEYS`) e mandar o link novo.

---

## Lista completa de variáveis

Site (Vercel e `.env.local`): ver [.env.example](.env.example), com o que é cada uma, onde pegar e se é obrigatória.
Worker (`wrangler secret put`): ver [realtime/.dev.vars.example](realtime/.dev.vars.example). Variável não secreta do worker: `NEXT_URL` em `realtime/wrangler.jsonc`.

| Onde | Obrigatórias | Opcionais |
|---|---|---|
| Vercel | `NEXT_PUBLIC_REALTIME_URL`, `ORACULO_DATABASE_URL`, `ANTHROPIC_API_KEY`, `ORACULO_SESSION_SECRET`, `PORTAL_SESSION_SECRET`, `PORTAL_MEMBER_TOKEN_SECRET` | `RESEND_API_KEY`, `PORTAL_EMAIL_FROM` (obrigatórias para login por e-mail), `KIWIFY_*`, `AUTH_MODE`, `KIWIFY_ONLY_ROOMS`, `BOTH_ROOMS`, `PORTAL_TRUSTED_EMAILS` (só para testes), `PORTAL_WORKER_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_WORKSPACE_ID`, `CHAT_ENABLED`, `DAILY_BUDGET_USD`, `DAILY_MAX_MESSAGES`, `IP_DAILY_LIMIT`, `IP_MINUTE_LIMIT`, `VISITOR_DAILY_LIMIT` |
| Worker | `ROOM_CODE` (vazio = sem código), `ADMIN_KEYS`, `MEMBER_TOKEN_SECRET`, `CALLS_APP_ID`, `CALLS_APP_SECRET` | `ADMIN_KEY`, `TURN_KEY_ID`, `TURN_KEY_TOKEN` (muito recomendadas), `AUTH_MODE`, `KIWIFY_ONLY_ROOMS`, `BOTH_ROOMS`, `LIVES_SECRET` |
| Só scripts locais | — | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (transcrição) |

---

## Anexo — para quem entrega o conteúdo do curso (Victor)

Gerar o arquivo da opção A a partir do banco atual, sem lives, conversas nem membros:
```sh
ORACULO_DATABASE_URL='<banco de origem>' npm run course:export -- course-data/curso.jsonl.gz
```
Enviar o arquivo **em privado** (link com expiração). Ele contém a transcrição completa das aulas.
