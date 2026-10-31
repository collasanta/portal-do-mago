import "server-only";
import { Pool } from "pg";

// Banco do Oráculo e do Portal (schema curso). Ver db/ e HANDOFF.md.
const g = globalThis as unknown as { _oraculoPool?: Pool };

export const pool =
  g._oraculoPool ??
  new Pool({
    connectionString: process.env.ORACULO_DATABASE_URL, // ex.: pooler do Supabase, porta 6543 (transaction mode)
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
  });
g._oraculoPool = pool;

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const r = await pool.query(text, params);
  return r.rows as T[];
}
