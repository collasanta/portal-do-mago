import "server-only";
import { Client, Pool, type PoolClient } from "pg";

// Banco do Oráculo e do Portal (schema curso). Ver db/ e HANDOFF.md.
const g = globalThis as unknown as { _oraculoPool?: Pool };
const config = {
  connectionString: process.env.ORACULO_DATABASE_URL, // ex.: pooler do Supabase, porta 6543 (transaction mode)
  ssl: { rejectUnauthorized: false },
};

// Cloudflare Workers: an I/O object (socket) cannot outlive the request that opened it, so a global Pool
// breaks the next request. There each query/connect gets its own short-lived client through Hyperdrive
// (which keeps the real, pooled TLS connections to Supabase). On Node (Vercel, cli) the shared Pool stays.
const ON_WORKERS = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

type Db = Pick<Pool, "query"> & { connect(): Promise<PoolClient> };

// Hyperdrive binding (wrangler.jsonc), read from the request context OpenNext keeps on globalThis.
function workerConfig() {
  const ctx = (globalThis as Record<symbol, { env?: { HYPERDRIVE?: { connectionString: string } } } | undefined>)[
    Symbol.for("__cloudflare-context__")
  ];
  const hd = ctx?.env?.HYPERDRIVE;
  if (!hd) throw new Error("HYPERDRIVE binding missing");
  return { connectionString: hd.connectionString };
}

function perRequest(): Db {
  return {
    query: (async (text: string, params?: unknown[]) => {
      const c = new Client(workerConfig());
      await c.connect();
      try {
        return await c.query(text, params);
      } finally {
        await c.end().catch(() => {});
      }
    }) as Pool["query"],
    async connect() {
      const c = new Client(workerConfig());
      await c.connect();
      return Object.assign(c, { release: () => void c.end().catch(() => {}) }) as unknown as PoolClient;
    },
  };
}

export const pool: Db = ON_WORKERS
  ? perRequest()
  : (g._oraculoPool ??= new Pool({ ...config, max: 3, idleTimeoutMillis: 10_000 }));

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const r = await pool.query(text, params);
  return r.rows as T[];
}
