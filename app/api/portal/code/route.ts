import { cookies } from "next/headers";
import { sameOrigin } from "@/lib/oraculo/visitor";
import { ipOf, json, limited } from "@/lib/portal/ratelimit";
import { CODE_COOKIE, cookieOptions, sealCookie } from "@/lib/portal/session";

const WORKER = (process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:8787").replace(/\/$/, "");

/** POST {code}: checks the room code with the worker and remembers it on this browser (pm_code), for /links and /lives. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  if (limited("code:" + ipOf(req), 20, 60_000)) return json(429, { error: "Muitas tentativas. Espere um minuto." });
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = String(body.code || "").trim().slice(0, 100);
  let ok = false;
  try {
    const r = await fetch(`${WORKER}/check?c=${encodeURIComponent(code)}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    ok = !!(await r.json()).ok;
  } catch {
    return json(502, { error: "Sem conexão com o salão." });
  }
  if (ok) (await cookies()).set(CODE_COOKIE, sealCookie("code", { c: 1 }), cookieOptions);
  return json(200, { ok });
}
