import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { VID_COOKIE, verifyVisitor } from "./vid";

export type Visitor = { id: string; ipHash: string };

function clientIp(req: Request) {
  // Na Vercel, x-real-ip / o primeiro x-forwarded-for vêm da borda (o cliente não consegue forjar).
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "0.0.0.0";
}

export const ipHash = (req: Request) =>
  crypto.createHash("sha256").update(`${process.env.ORACULO_SESSION_SECRET}:ip:${clientIp(req)}`).digest("hex").slice(0, 32);

/** Visitante deste navegador (cookie assinado) + hash do IP. Sem cookie válido: null. */
export async function getVisitor(req: Request): Promise<Visitor | null> {
  const id = await verifyVisitor((await cookies()).get(VID_COOKIE)?.value);
  return id ? { id, ipHash: ipHash(req) } : null;
}

/** POST/DELETE só da própria origem (bloqueia CSRF e uso a partir de outros sites). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}
