# Site em Cloudflare Workers (opcional)

O caminho padrão do [HANDOFF.md](../HANDOFF.md) publica o site na Vercel. Este é o caminho alternativo: o mesmo site rodando num Worker da Cloudflare (OpenNext), na mesma conta do worker de tempo real. Só siga se quiser sair da Vercel.

## O que muda em relação à Vercel

- **Oráculo sem busca por vetor.** O modelo local de embeddings (ONNX) não roda em Workers. No build da Cloudflare ele é trocado por um substituto (`lib/cf/transformers-stub.mjs`) e o Oráculo responde só com busca por texto. Lives gravadas entram no banco sem vetor. As aulas do curso continuam com os vetores gerados no seu computador (`npm run course:ingest`), mas a pergunta do aluno não é vetorizada.
- **Banco via Hyperdrive.** Workers não aceitam o certificado do pooler do Supabase. A conexão passa pelo Hyperdrive, que faz o pool (`lib/oraculo/db.ts`).
- **Sem Cache Components.** O build da Cloudflare desliga `cacheComponents` e renderiza tudo de forma dinâmica.

## Passos

Precisa de **Node 22**.

1. Criar o Hyperdrive apontando para o **Session pooler** do Supabase (porta **5432**, não a 6543):
   ```sh
   npx wrangler hyperdrive create portal-do-mago-db --connection-string="postgres://USUARIO:SENHA@HOST:5432/postgres"
   ```
   Colar o `id` devolvido em `wrangler.jsonc` (raiz), no lugar de `COLE-O-ID-DO-SEU-HYPERDRIVE`.
2. Enviar as variáveis do site como segredos do Worker (as mesmas do `.env.local`, ver [.env.example](../.env.example)):
   ```sh
   npx wrangler secret bulk .env.local
   ```
   `NEXT_PUBLIC_REALTIME_URL` entra no build: precisa estar no `.env.local` na hora do `cf:deploy`.
3. Publicar:
   ```sh
   npm run cf:deploy
   ```
   O endereço sai como `https://portal-do-mago.<sua-conta>.workers.dev`.
4. Apontar o worker de tempo real para o site novo: em `realtime/wrangler.jsonc`, trocar `NEXT_URL` por esse endereço e rodar `cd realtime && npx wrangler deploy`.

Para testar antes de publicar: `npm run cf:preview`.

Na Cloudflare, push na `main` **não** publica sozinho: rode `npm run cf:deploy` a cada mudança.
