import "server-only";
import crypto from "node:crypto";

// Signed cookies of the site (HMAC-SHA256 with PORTAL_SESSION_SECRET), httpOnly.
//   pm_sess : member session (e-mail confirmed by code), 30 days
//   pm_adm  : admin/host session (admin key confirmed), 30 days
//   pm_code : visitor typed the right room code (code mode), 30 days

export const SESSION_COOKIE = "pm_sess";
export const ADMIN_COOKIE = "pm_adm";
export const CODE_COOKIE = "pm_code";
export const SESSION_DAYS = 30;

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 3600,
};

function secret() {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("PORTAL_SESSION_SECRET ausente");
  return s;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (kind: string, body: string) => crypto.createHmac("sha256", secret()).update(`${kind}.${body}`).digest("base64url");

/** kind namespaces the signature so a cookie of one kind can never be replayed as another. */
export function sealCookie(kind: string, data: Record<string, unknown>, days = SESSION_DAYS) {
  const body = b64(JSON.stringify({ ...data, x: Math.floor(Date.now() / 1000) + days * 86400 }));
  return `${body}.${mac(kind, body)}`;
}

export function openCookie<T extends Record<string, unknown>>(kind: string, value: string | undefined | null): T | null {
  if (!value) return null;
  const [body, sig, extra] = value.split(".");
  if (!body || !sig || extra !== undefined) return null;
  let expected: string;
  try {
    expected = mac(kind, body);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { x?: number };
    if (typeof d.x !== "number" || d.x * 1000 < Date.now()) return null;
    return d;
  } catch {
    return null;
  }
}

/** Keyed hash for login codes / IPs (never store the raw code). */
export const keyedHash = (s: string) => crypto.createHmac("sha256", secret()).update(s).digest("hex");

export function normEmail(v: unknown) {
  const e = String(v || "").trim().toLowerCase();
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(e) && e.length <= 254 ? e : "";
}

// Encrypted cookie (AES-256-GCM, key derived from PORTAL_SESSION_SECRET): holds the admin/host key so the
// server can re-check it with the worker on every request (a revoked key stops working at once).
function encKey() {
  return crypto.createHash("sha256").update("pm-enc:" + secret()).digest();
}
export function encryptCookie(plain: string, days = SESSION_DAYS) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify({ v: plain, x: Math.floor(Date.now() / 1000) + days * 86400 }), "utf8"), c.final()]);
  return [iv, body, c.getAuthTag()].map((b) => b.toString("base64url")).join(".");
}
export function decryptCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const [iv, body, tag] = value.split(".").map((s) => Buffer.from(s, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
    d.setAuthTag(tag);
    const o = JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8")) as { v: string; x: number };
    return o.x * 1000 > Date.now() ? o.v : null;
  } catch {
    return null;
  }
}
