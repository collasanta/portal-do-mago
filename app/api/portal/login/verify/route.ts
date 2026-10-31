import { cookies } from "next/headers";
import { sameOrigin } from "@/lib/oraculo/visitor";
import { verifyLoginCode } from "@/lib/portal/login";
import { ipOf, json, limited } from "@/lib/portal/ratelimit";
import { SESSION_COOKIE, cookieOptions, normEmail, sealCookie } from "@/lib/portal/session";

/** POST {email, code}: checks the code and opens the member session (pm_sess, 30 days). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  if (limited("verify:" + ipOf(req), 30, 10 * 60_000)) return json(429, { error: "Muitas tentativas. Espere alguns minutos." });
  const body = (await req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = normEmail(body.email);
  const code = String(body.code || "").replace(/\D/g, "");
  if (!email || code.length !== 6) return json(400, { error: "Digite os 6 números do código." });
  const r = await verifyLoginCode(email, code);
  if (r === "wrong") return json(400, { error: "Código errado. Confira os 6 números." });
  if (r === "expired") return json(400, { error: "Esse código expirou ou passou do limite de tentativas. Peça um novo." });
  if (r === "inactive") return json(403, { error: "Seu acesso de membro não está ativo." });
  (await cookies()).set(SESSION_COOKIE, sealCookie("sess", { e: email }), cookieOptions);
  return json(200, { ok: true, email });
}
