// Gera os segredos aleatórios do projeto e as chaves pessoais (admin/host). Só imprime no SEU terminal:
// copie cada valor para o lugar indicado (wrangler secret / Vercel / .env.local) e não cole em chat nem commit.
// Uso: node cli/new-secrets.mjs [nome-do-admin] [nome-do-host]
import crypto from "node:crypto";

const rnd = (n = 32) => crypto.randomBytes(n).toString("base64url");
const [admin = "admin", host = "mago"] = process.argv.slice(2);
const adminKey = rnd(24), hostKey = rnd(24);
const memberSecret = rnd();
const out = {
  "ROOM_CODE (worker; código da sala, curto e fácil de digitar)": crypto.randomBytes(3).toString("hex"),
  "ADMIN_KEY (worker; chave de admin reserva, guardar)": rnd(24),
  "ADMIN_KEYS (worker; JSON numa linha só)": JSON.stringify({ [admin]: { key: adminKey, role: "admin" }, [host]: { key: hostKey, role: "host" } }),
  [`chave pessoal de ${admin} (link: /?k=...)`]: adminKey,
  [`chave pessoal de ${host} (link: /?k=...)`]: hostKey,
  "MEMBER_TOKEN_SECRET (worker) = PORTAL_MEMBER_TOKEN_SECRET (Vercel), o MESMO valor": memberSecret,
  "LIVES_SECRET (worker)": rnd(),
  "PORTAL_SESSION_SECRET (Vercel)": rnd(),
  "ORACULO_SESSION_SECRET (Vercel)": rnd(),
};
for (const [k, v] of Object.entries(out)) console.log(`${k}\n  ${v}\n`);
