import "server-only";
import crypto from "node:crypto";

// Admin check for the web app: the realtime worker owns the keys (ADMIN_KEY / ADMIN_KEYS), so we ask it.
// POST /admin only accepts role "admin", and "stats" is a read-only action. Results are cached in memory.
const WORKER = (process.env.PORTAL_WORKER_URL || process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:8787").replace(/\/$/, "");
const cache = new Map<string, { ok: boolean; until: number }>();

export async function isAdminKey(key: string | null | undefined): Promise<boolean> {
  const k = (key || "").trim();
  if (k.length < 8 || k.length > 200) return false;
  const h = crypto.createHash("sha256").update(k).digest("hex");
  const hit = cache.get(h);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const r = await fetch(`${WORKER}/admin?room=teste`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: k, action: "stats" }),
      signal: AbortSignal.timeout(6000),
    });
    ok = r.ok;
    if (!ok && r.status !== 403) return false; // worker trouble: do not cache
  } catch {
    return false;
  }
  if (cache.size > 200) cache.clear();
  cache.set(h, { ok, until: Date.now() + (ok ? 5 * 60_000 : 30_000) });
  return ok;
}

// Role of a key (admin | host | user), from the worker's POST /role. Same caching rules as isAdminKey.
const roleCache = new Map<string, { role: "admin" | "host" | "user"; until: number }>();
export async function keyRole(key: string | null | undefined): Promise<"admin" | "host" | "user"> {
  const k = (key || "").trim();
  if (k.length < 8 || k.length > 200) return "user";
  const h = crypto.createHash("sha256").update(k).digest("hex");
  const hit = roleCache.get(h);
  if (hit && hit.until > Date.now()) return hit.role;
  let role: "admin" | "host" | "user" = "user";
  try {
    const r = await fetch(`${WORKER}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: k }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return isAdminKey(k).then((ok) => (ok ? "admin" : "user")); // older worker without /role
    const d = (await r.json()) as { role?: string };
    role = d.role === "admin" || d.role === "host" ? d.role : "user";
  } catch {
    return "user";
  }
  if (roleCache.size > 200) roleCache.clear();
  roleCache.set(h, { role, until: Date.now() + (role !== "user" ? 5 * 60_000 : 30_000) });
  return role;
}
