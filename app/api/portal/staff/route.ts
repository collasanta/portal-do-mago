import { cookies } from "next/headers";
import { sameOrigin } from "@/lib/oraculo/visitor";
import { keyRole } from "@/lib/portal/admin-key";
import { ipOf, json, limited } from "@/lib/portal/ratelimit";
import { ADMIN_COOKIE, cookieOptions, encryptCookie } from "@/lib/portal/session";

/** POST {key}: an admin/host key (magic link ?k=) is remembered on this browser (pm_adm, encrypted), for server pages. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  if (limited("staff:" + ipOf(req), 10, 60_000)) return json(429, { error: "Muitas tentativas. Espere um minuto." });
  const body = (await req.json().catch(() => ({}))) as { key?: string };
  const key = String(body.key || "").trim();
  const role = await keyRole(key);
  const jar = await cookies();
  if (role === "user") {
    jar.delete(ADMIN_COOKIE);
    return json(403, { ok: false });
  }
  jar.set(ADMIN_COOKIE, encryptCookie(key), cookieOptions);
  return json(200, { ok: true, role });
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  (await cookies()).delete(ADMIN_COOKIE);
  return json(200, { ok: true });
}
