// Carrega .env.local (e .env) da raiz do projeto em process.env, sem nunca imprimir valores.
// Variáveis que já existem no ambiente têm prioridade.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

for (const f of [".env.local", ".env"]) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(ROOT, f), "utf8");
  } catch {
    continue;
  }
  for (const l of text.split("\n")) {
    const m = l.match(/^\s*(?:export\s+)?(\w+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** Cliente Postgres do banco do Oráculo/Portal (ORACULO_DATABASE_URL). */
export async function db() {
  const url = process.env.ORACULO_DATABASE_URL;
  if (!url) {
    console.error("ORACULO_DATABASE_URL ausente (coloque no .env.local). Veja HANDOFF.md.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}
