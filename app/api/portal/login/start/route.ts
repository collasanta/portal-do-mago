import { cookies } from "next/headers";
import { sameOrigin } from "@/lib/oraculo/visitor";
import { requestLoginCode } from "@/lib/portal/login";
import { upsertMember } from "@/lib/portal/members";
import { ipOf, json, limited } from "@/lib/portal/ratelimit";
import { SESSION_COOKIE, cookieOptions, normEmail, sealCookie } from "@/lib/portal/session";
import { isTrustedEmail } from "@/lib/portal/trusted";

const SAME = "Se esse e-mail for de um membro ativo, o código chega em até 1 minuto. Confira também o spam e as promoções.";

/** POST {email}: sends a 6-digit code to an active member. Same answer whether or not the e-mail is a member. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  const ip = ipOf(req);
  if (limited("login:" + ip, 10, 10 * 60_000)) return json(429, { error: "Muitos pedidos de código. Espere alguns minutos." });
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = normEmail(body.email);
  if (!email) return json(400, { error: "Digite um e-mail válido." });
  if (isTrustedEmail(email)) {
    await upsertMember({ email, status: "active", source: "manual", note: "e-mail de teste (sem código)" });
    (await cookies()).set(SESSION_COOKIE, sealCookie("sess", { e: email }), cookieOptions);
    return json(200, { ok: true, direct: true, email });
  }
  try {
    const r = await requestLoginCode(email, ip);
    if (r === "too-many") return json(429, { error: "Você pediu muitos códigos. Espere uma hora ou use o último que chegou." });
    return json(200, { ok: true, message: SAME });
  } catch (e) {
    console.error("portal login: send failed", e);
    return json(500, { error: "Não consegui enviar o e-mail agora. Tente de novo em instantes." });
  }
}
