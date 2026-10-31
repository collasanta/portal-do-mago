# Instruções para o agente de código (Claude Code, Codex, etc.)

Este repositório é o **Portal do Mago**. Quem está falando com você é, quase sempre, **o Mago** (dono da comunidade), que não é programador. O trabalho principal é **colocar o projeto no ar na infraestrutura dele** seguindo o [HANDOFF.md](HANDOFF.md).

## Como conduzir o setup

1. Leia o `HANDOFF.md` inteiro antes de começar. Depois leia o `README.md` e o `docs/TECNICO.md`.
2. Pergunte em que passo ele está (se é a primeira vez, comece do passo 0). Se existir `SETUP-PROGRESSO.md` na raiz (fora do git), leia: é onde você anota o andamento.
3. Vá **um passo por vez**. Em cada passo:
   - Explique em 1 ou 2 frases, em português simples, o que vai acontecer e por quê.
   - **Você mesmo roda os comandos** (npm, npx wrangler, npx vercel, node cli/...). Não peça para ele digitar comandos que você consegue rodar.
   - **Pare e peça ao Mago só o que exige as mãos ou as contas dele**: criar contas, fazer login no navegador (`wrangler login`, `vercel login`), clicar em botões de painel, colar uma chave, cadastrar cartão, configurar DNS, mexer na Kiwify. Diga exatamente onde clicar, um item por vez.
   - Rode a **verificação** do passo e mostre o resultado antes de seguir.
   - Anote em `SETUP-PROGRESSO.md` o que foi feito (sem valores secretos).
4. Se algo der errado, leia a seção "Problemas comuns" do HANDOFF e os logs (`npx wrangler tail`, logs da Vercel) antes de tentar outra coisa. Não invente atalho que desligue segurança.

## Segredos: regras sem exceção

- **Nunca** commite `.env.local`, `realtime/.dev.vars`, `course-data/`, `models/` ou qualquer chave. Antes de todo commit, rode `git status` e confira.
- Não imprima valores de segredos na conversa (nem em logs). Para conferir se existem, mostre só o nome ou os 4 primeiros caracteres.
- Quando o Mago colar uma chave, grave direto no `.env.local` / `realtime/.dev.vars` (ou mande para `wrangler secret put` / Vercel) e não repita o valor.
- O conteúdo do curso (transcrições, aulas) é pago: nunca vai para o git nem para lugar público.
- Se este repositório for público (ou um fork público), sugira ao Mago manter a cópia dele **privada**.

## Mudanças no código

- Só mude código quando o Mago pedir ou quando um passo do HANDOFF exigir (ex.: `NEXT_URL` no `realtime/wrangler.jsonc`).
- Depois de mudar, rode `npm run build` (site) e `cd realtime && npx tsc --noEmit` (worker).
- Deploy: o site sobe sozinho na Vercel a cada push na `main`; o worker sobe com `cd realtime && npx wrangler deploy`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
