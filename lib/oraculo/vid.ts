// Cookie de visitante anônimo: id aleatório + assinatura HMAC-SHA256 (Web Crypto: roda no proxy e nas rotas).
// Só o servidor emite ids válidos; conversas e limites ficam presos a ele.
export const VID_COOKIE = "pm_ovid";
export const VID_MAX_AGE = 60 * 60 * 24 * 400; // 400 dias (máximo aceito pelos navegadores)

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer | Uint8Array) {
  let s = "";
  for (const b of buf instanceof Uint8Array ? buf : new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function key() {
  const secret = process.env.ORACULO_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("ORACULO_SESSION_SECRET ausente");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

const sign = async (id: string) => b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode("vid:" + id)));

export async function newVisitorCookie() {
  const id = b64url(crypto.getRandomValues(new Uint8Array(24)));
  return `${id}.${await sign(id)}`;
}

/** Devolve o id do visitante se a assinatura for válida. */
export async function verifyVisitor(value: string | undefined | null): Promise<string | null> {
  if (!value) return null;
  const [id, sig, extra] = value.split(".");
  if (extra !== undefined || !id || !sig || !/^[\w-]{32}$/.test(id)) return null;
  const expected = await sign(id);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? id : null;
}

export const vidCookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: VID_MAX_AGE };
