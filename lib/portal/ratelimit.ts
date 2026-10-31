import "server-only";

// Tiny in-memory rate limit (per server instance). The DB-backed limits on login codes are the real gate.
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return arr.length > max;
}
export const ipOf = (req: Request) => req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "0.0.0.0";
export const H = { "cache-control": "no-store" };
export const json = (status: number, body: unknown) => Response.json(body, { status, headers: H });
