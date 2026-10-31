# Acesso ao Portal pela compra na Kiwify

Por padrão o Salão abre com o **código da sala** (o que está no grupo do WhatsApp). Com a Kiwify ligada, quem comprou o Grimório entra com o **e-mail da compra**: digita o e-mail, recebe um código de 6 números e pronto. Sem senha e sem cadastro.

Quem cancela, pede reembolso ou dá chargeback perde o acesso sozinho, porque a Kiwify avisa o Portal (webhook).

São 3 passos no painel da Kiwify (uns 10 minutos). As chaves vão para o seu agente de código (ou para quem cuida da parte técnica), que coloca no servidor.

`SITE` abaixo é o endereço do seu Portal (ex.: `https://portal.seudominio.com.br`).

---

## Passo 1 — Webhook (o mais importante)

O webhook é a Kiwify avisando o Portal toda vez que alguém compra, renova, cancela ou pede reembolso.

1. Entre em **dashboard.kiwify.com.br** com a conta onde o Grimório é vendido.
2. No menu da esquerda, clique em **Apps**.
3. Clique no quadro **Webhooks**.
4. Clique no botão roxo **Criar webhook** (canto direito).
5. Preencha a janela que abre:
   - **Nome:** `Portal do Mago`
   - **URL do Webhook:** `SITE/api/kiwify/webhook`
   - **Token:** a Kiwify já preenche sozinha (um código curto, tipo `ab12cd34ef5`). **Não mexa, mas copie esse token** — ele vai no passo 4.
   - **Produtos:** escolha o **Grimório do Mago** (se quiser que qualquer produto seu libere o Portal, deixe "Todos que sou produtor").
   - **Evento:** marque estes 6:
     - ☑ Compra aprovada
     - ☑ Reembolso
     - ☑ Chargeback
     - ☑ Assinatura cancelada
     - ☑ Assinatura atrasada
     - ☑ Assinatura renovada

     (Deixe desmarcados: Boleto gerado, Pix gerado, Carrinho abandonado, Compra recusada. O Portal ignora esses.)
6. Clique em **Criar**. Aparece "Integração adicionada".

**Testar (opcional):** na lista de webhooks, clique nos **⋮** do "Portal do Mago" → **Editar** → **Testar Webhook**. Na janelinha, escolha **Evento: Compra aprovada** e clique **Enviar teste**. A Kiwify manda uma compra de mentira (cliente `johndoe@example.com`). Esse teste só funciona depois que o token estiver no Portal (passo 4). Ele aparece no admin de membros; apague depois.

Para ver se a Kiwify está entregando: **⋮ → Ver logs**.

## Passo 2 — Chave da API (para o botão "Sincronizar")

Com isso o Portal busca na Kiwify todo mundo que **já comprou antes** de o webhook existir. Sem essa chave, só entra quem comprar daqui pra frente (ou quem for liberado à mão ou importado por CSV).

1. Em **Apps**, clique no quadro **API**.
2. Clique em **Criar API Key**.
3. Dê o nome `Portal do Mago` e confirme.
4. A Kiwify mostra **Client ID**, **Client Secret** e **Account ID**. Copie os três (o Client Secret só aparece uma vez). Eles vão no passo 4.

## Passo 3 — Qual é o produto

Anote **o nome exato do produto** do Grimório na Kiwify (e se há mais de um, por exemplo plano mensal e anual separados) e o ID de cada um (aparece no endereço da página do produto no painel). Os IDs vão em `KIWIFY_PRODUCT_IDS`, separados por vírgula.

## Passo 4 — Colocar no servidor

Entregue ao seu agente de código (no terminal, nunca em grupo):

- Token do webhook (passo 1) → `KIWIFY_WEBHOOK_TOKEN`
- Client ID, Client Secret e Account ID (passo 2) → `KIWIFY_CLIENT_ID`, `KIWIFY_CLIENT_SECRET`, `KIWIFY_ACCOUNT_ID`
- ID(s) do produto (passo 3) → `KIWIFY_PRODUCT_IDS`

Ele grava no `.env.local`, envia para a Vercel (`npm run vercel:env`), faz o redeploy, roda a primeira sincronização (`npm run kiwify:sync`) e confere a lista de membros (HANDOFF.md, passo 11).

---

## Ligar o modo "só membros" no Salão

Por padrão o Salão está no modo **código da sala**. Existem 3 modos:

| Modo | Quem entra |
|---|---|
| `code` (padrão) | quem tem o código da sala |
| `both` | quem tem o código **ou** quem comprou (e-mail da compra) |
| `kiwify` | só quem comprou (e-mail da compra) |

Em todos os modos, os **links pessoais** de anfitrião e admin (com `?k=`) sempre entram, mesmo sem compra.

Sugestão de virada, sem susto para a turma:

1. Depois do passo 4 e da primeira sincronização, ligue **`both`**: todo mundo continua entrando com o código, e quem quiser já testa o e-mail.
2. Avise no grupo: "a partir de [data] o Salão abre com o e-mail da compra do Grimório".
3. Na data, ligue **`kiwify`**. O código da sala deixa de valer.

Para trocar o modo, muda-se a variável `AUTH_MODE` no worker do Salão e na Vercel (instruções técnicas abaixo). Recomendado: deixar a sala de ensaio `?sala=teste` em modo só membros (`KIWIFY_ONLY_ROOMS=teste`).

---

## Dúvidas da turma

- **"Não chegou o código."** Olhar spam e promoções. O e-mail vem de *Portal do Mago*. Tem que ser **o mesmo e-mail usado na compra da Kiwify**. Se a pessoa comprou com outro e-mail, o Mago (ou um admin) libera o e-mail novo à mão no admin.
- **"Diz que minha compra não está ativa."** Assinatura atrasada ou cancelada. Quando a Kiwify renovar, o acesso volta sozinho em segundos.
- **O código vale 10 minutos**, e o login fica salvo no navegador por 30 dias.

## Admin de membros

`SITE/admin/membros` — abre para admins e para o Mago (host), no mesmo navegador em que abriram o link pessoal do Salão (ou colando a chave pessoal).

Lá dá para: ver e buscar membros, **Liberar** um e-mail à mão, **Desativar/Ativar/Remover**, **Importar CSV** (Kiwify → Vendas → Exportar), **Sincronizar** com a Kiwify, ver o modo de cada sala, a URL do webhook e os últimos eventos recebidos.

---

## Notas técnicas

- Webhook: `POST /api/kiwify/webhook?signature=<HMAC-SHA1(token, corpo)>` — formato e assinatura conferidos com o botão "Testar Webhook" da Kiwify em 2026-10-31. `KIWIFY_WEBHOOK_TOKEN` aceita lista separada por vírgula (ex.: produção + um webhook de teste). Aprovada/renovada → ativo; atrasada/cancelada/reembolso/chargeback → inativo; outros eventos ignorados; entrega repetida = no-op.
- Filtro de produto: `KIWIFY_PRODUCT_IDS` (vírgulas) vale para webhook e sync. A sync exige `KIWIFY_PRODUCT_IDS` ou `KIWIFY_SYNC_ALL_PRODUCTS=1` (prefira o ID do produto; `ALL` libera qualquer produto vendido na conta).
- Sync: `npm run kiwify:sync` (ou `-- --dry`), lê o `.env.local`. A API pública não tem endpoint de assinaturas: cancelamento só chega por webhook. Desde `KIWIFY_SYNC_SINCE` (padrão 2024-01-01).
- Envs Vercel: `PORTAL_SESSION_SECRET`, `PORTAL_MEMBER_TOKEN_SECRET`, `KIWIFY_WEBHOOK_TOKEN`, `KIWIFY_CLIENT_ID`, `KIWIFY_CLIENT_SECRET`, `KIWIFY_ACCOUNT_ID`, `KIWIFY_PRODUCT_IDS`, `RESEND_API_KEY`, `PORTAL_EMAIL_FROM`, `AUTH_MODE`, `KIWIFY_ONLY_ROOMS`, `BOTH_ROOMS`.
- Worker (`wrangler secret put`): `MEMBER_TOKEN_SECRET` (= `PORTAL_MEMBER_TOKEN_SECRET`), `AUTH_MODE`, `KIWIFY_ONLY_ROOMS`, `BOTH_ROOMS`. O worker decide quem entra; a Vercel espelha o modo para as páginas de membros (/links, /lives).
- Trocar o modo do Salão para só membros:
  ```sh
  cd realtime && printf kiwify | npx wrangler secret put AUTH_MODE
  printf kiwify | npx vercel env add AUTH_MODE production --force && npx vercel deploy --prod
  ```
- Token de membro para o worker: `m1.<payload>.<HMAC-SHA256>`, vale 12 h, emitido a cada entrada só para membro ativo.
- E-mail: Resend, remetente em `PORTAL_EMAIL_FROM` (domínio verificado no Resend; HANDOFF.md, passo 8).
