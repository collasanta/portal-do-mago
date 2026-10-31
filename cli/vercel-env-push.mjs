// Envia as variáveis preenchidas do .env.local para a Vercel (ambiente production), sem imprimir valores.
// Pré-requisito: `npx vercel link` feito na raiz (projeto ligado). Depois rode um redeploy.
// Uso: node cli/vercel-env-push.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./env.mjs";

const LOCAL_ONLY = new Set(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
const dry = process.argv.includes("--dry");
const allowed = new Set(
  fs.readFileSync(path.join(ROOT, ".env.example"), "utf8").split("\n").map((l) => l.match(/^(\w+)=/)?.[1]).filter(Boolean),
);
const vars = [];
for (const l of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/);
  if (!m || !allowed.has(m[1]) || LOCAL_ONLY.has(m[1])) continue;
  const v = m[2].replace(/^["']|["']$/g, "");
  if (!v || /^(GERAR|COLE|TROCAR)/.test(v) || v.includes("SEU-")) continue;
  vars.push([m[1], v]);
}
for (const [k, v] of vars) {
  if (dry) { console.log("enviaria:", k); continue; }
  const r = spawnSync("npx", ["vercel", "env", "add", k, "production", "--force"], { input: v, cwd: ROOT, stdio: ["pipe", "ignore", "pipe"] });
  console.log(r.status === 0 ? "ok:" : "ERRO:", k, r.status === 0 ? "" : String(r.stderr).slice(0, 200));
}
console.log(`${vars.length} variáveis. Agora: npx vercel deploy --prod (ou redeploy pelo painel).`);
