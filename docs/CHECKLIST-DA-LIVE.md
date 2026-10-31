# Checklist da live (~300 alunos)

Para quem cuida da parte técnica (admin). O guia do Mago está em `docs/GUIA-DO-MAGO.md`. `SITE` = endereço do Portal, `WORKER` = endereço do worker.

## 1 hora antes

- [ ] **Site no ar**: abrir `SITE` → aparece a tela "Monte seu personagem". Na Vercel, o último deploy da `main` tem que estar **Ready**.
- [ ] **Worker no ar**: `curl WORKER/info` → `"sfu":true` e `"live":false`. O número em `online` tem que fazer sentido.
- [ ] **Plano da Cloudflare**: confirmar no painel que a conta está no **Workers Paid** (Durable Objects + WebSocket de 300 pessoas por 2 h passam fácil dos limites do plano grátis) e que o app do **Realtime/SFU** e a chave **TURN** continuam ativos.
- [ ] **Anthropic (Oráculo)**: no console, ver o saldo/limite de gasto do workspace do Oráculo e se o limite mensal aguenta um pico (300 pessoas perguntando). Testar uma pergunta em `/oraculo`.
- [ ] **Ensaio com o Mago** em `?sala=teste` (nunca no `salao`): iniciar live → câmera e mic → compartilhar tela com áudio da aba → alguém levanta a mão → chamar pro palco → tirar → **Encerrar live**. Conferir que a voz por proximidade voltou.
- [ ] O Mago entra pelo **link pessoal dele** no **Chrome/Edge do computador**, com cabo de rede se der, e o nome aparece com o selo **MAGO**.
- [ ] Você (admin) abre o salão em outra máquina ou janela anônima como aluno, para ver o que a galera vê.
- [ ] **Link de reserva pronto**: uma live **não listada** no YouTube já criada no OBS/YouTube Studio, com o link copiado.
- [ ] Mandar no grupo do WhatsApp o link com o código (`?c=`) uns 15 min antes (ou, no modo só membros, só o endereço do site).

## Na hora: problemas comuns

| Problema | O que fazer |
|---|---|
| **Aluno não ouve nada** | É o bloqueio de autoplay do navegador: clicar em **🔊 Clique pra ouvir** na janela AO VIVO. Fixar o aviso: "Sem som? Clica em 🔊 Clique pra ouvir". |
| **Mago sem áudio** (vídeo chega, voz não) | No painel da live do Mago: o botão **🎙️ Mic** está ligado? Trocar o microfone na lista e conferir a permissão do navegador (cadeado na barra de endereço). Se continuar, recarregar a página, entrar pelo link dele e clicar **Ligar câmera e transmitir** (a live continua). |
| **Áudio do vídeo/aba não sai** | Compartilhar de novo escolhendo a **aba** e marcando **"Compartilhar áudio da aba"** (janela inteira não leva áudio no Mac). |
| **Vídeo travando / "Reconectando ao palco…"** | Qualidade **eco** no painel. Se não resolver em 1 min: **plano B**. |
| **Plano B (SFU caiu)** | Mago (ou você) abre a live não listada no YouTube e cola o link em **Transmitir link**. Todo mundo assiste embutido, sem sair da sala. **Voltar pra câmera/tela** quando estabilizar. |
| **Mago caiu / recarregou** | Ele entra de novo pelo link pessoal: volta como anfitrião da mesma live, é só religar a câmera. Se não der, você clica **Assumir transmissão** e transmite. |
| **Bagunça no áudio** | **🔇 Mutar todos** no painel (na live os alunos já ficam mudos; só o palco fala). Tirar do palco quem estiver causando. |
| **Alguém causando no chat** | Clicar no nome na lista de membros → **mutar** ou **expulsar** (expulsão = 30 min). No chat: `/limpar` limpa o histórico, `/aviso texto` posta como Corvo Mensageiro. |
| **Sala vazia ou tela em branco** para alguém | Recarregar a página (F5). Celular: fechar e abrir o link de novo. |
| **Oráculo não responde** | Ver o saldo da Anthropic. Não afeta a live; avisar no chat que volta depois. |

## Fim

- [ ] **Encerrar live** (o painel pede confirmação). A voz por proximidade volta sozinha.
- [ ] Se usou a máquina de outra pessoa com o link de admin/anfitrião: abrir `SITE/?k=off` para remover a chave daquele navegador.

## Quem chamar

- **Admin** (código e infraestrutura): resolve worker, Vercel, chaves e moderação.
- **Mago** (anfitrião): câmera, tela, palco e aviso fixado.
- Fornecedores: **Vercel** (site), **Cloudflare** (worker `portaldomago-realtime`, Realtime/SFU, TURN), **Anthropic** (Oráculo). As chaves ficam no `.env.local` / `realtime/.dev.vars` de quem fez o setup (e no gerenciador de senhas).
