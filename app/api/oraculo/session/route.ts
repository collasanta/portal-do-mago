import { cookies } from "next/headers";
import { sameOrigin } from "@/lib/oraculo/visitor";
import { VID_COOKIE, newVisitorCookie, verifyVisitor, vidCookieOptions } from "@/lib/oraculo/vid";


// Garante o cookie de visitante assinado do Oráculo (substitui o proxy do app original:
// só quem abriu a página e chamou isto, da própria origem, recebe um id válido).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  const jar = await cookies();
  const ok = await verifyVisitor(jar.get(VID_COOKIE)?.value).catch(() => null);
  if (!ok) jar.set(VID_COOKIE, await newVisitorCookie(), vidCookieOptions);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
