import { cookies } from "next/headers";
import { sameOrigin } from "@/lib/oraculo/visitor";
import { json } from "@/lib/portal/ratelimit";
import { SESSION_COOKIE } from "@/lib/portal/session";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  (await cookies()).delete(SESSION_COOKIE);
  return json(200, { ok: true });
}
