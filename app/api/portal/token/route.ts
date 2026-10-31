import { sameOrigin } from "@/lib/oraculo/visitor";
import { getViewer } from "@/lib/portal/access";
import { signMemberToken } from "@/lib/portal/authmode";
import { json } from "@/lib/portal/ratelimit";

/** Member tokens live 12 h: enough for a long live; a fresh one is minted on every entry (cancelled members get none). */
const TTL_S = 12 * 3600;

/** POST: short-lived member token for the realtime worker (/ws join + SFU proxy). Active members only. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  const secret = process.env.PORTAL_MEMBER_TOKEN_SECRET;
  if (!secret) return json(503, { error: "Login de membros desligado." });
  const v = await getViewer();
  if (!v.email) return json(401, { error: "Entre com o e-mail da compra." });
  if (!v.member) return json(403, { error: "Seu acesso de membro não está ativo.", email: v.email });
  const token = await signMemberToken(secret, { e: v.email, ...(v.name ? { n: v.name.slice(0, 40) } : {}), x: Math.floor(Date.now() / 1000) + TTL_S });
  return json(200, { token, email: v.email, exp: Date.now() + TTL_S * 1000 });
}
