// Sincroniza membros com a API pública da Kiwify (venda paga -> ativo, reembolso/chargeback -> inativo).
// Uso: npm run kiwify:sync [-- --dry]
// Env (de .env.local ou do ambiente): KIWIFY_CLIENT_ID, KIWIFY_CLIENT_SECRET, KIWIFY_ACCOUNT_ID,
// KIWIFY_PRODUCT_IDS (ou KIWIFY_SYNC_ALL_PRODUCTS=1), ORACULO_DATABASE_URL.
import "./env.mjs";
import pg from "pg";
import { runKiwifySync, syncConfig } from "../lib/portal/kiwify-sync.mjs";

const dryRun = process.argv.includes("--dry");
const cfg = syncConfig(process.env);
if (!cfg.ok) {
  console.log(`Nada a fazer: faltam ${cfg.missing.join(", ")}. Veja docs/KIWIFY.md.`);
  process.exit(0);
}
const c = new pg.Client({ connectionString: process.env.ORACULO_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const r = await runKiwifySync({ env: process.env, query: (t, p) => c.query(t, p), dryRun, actor: "cli", log: console.log });
  console.log(r.message);
} finally {
  await c.end();
}
