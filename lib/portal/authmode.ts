// Shared by the Next.js server and the realtime worker (pure: Web Crypto only, no Node APIs).
//
// Who may enter a room:
//   code   -> room code (today's flow)
//   both   -> room code OR an active Kiwify member
//   kiwify -> active Kiwify member only
// Admin/host keys always enter, in every mode.
// AUTH_MODE is the default for every room; KIWIFY_ONLY_ROOMS / BOTH_ROOMS (comma lists) override per room.

export type AuthMode = "code" | "both" | "kiwify";
/** AUTH_MODE, KIWIFY_ONLY_ROOMS, BOTH_ROOMS (process.env or the worker env). */
export type ModeConfig = { AUTH_MODE?: string; KIWIFY_ONLY_ROOMS?: string; BOTH_ROOMS?: string };

export function parseMode(v: unknown): AuthMode {
  const s = String(v || "").trim().toLowerCase();
  return s === "both" || s === "kiwify" ? s : "code";
}

const list = (v?: string) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function modeForRoom(room: string, cfg: ModeConfig): AuthMode {
  const r = (room || "salao").toLowerCase();
  if (list(cfg.KIWIFY_ONLY_ROOMS).includes(r)) return "kiwify";
  if (list(cfg.BOTH_ROOMS).includes(r)) return "both";
  return parseMode(cfg.AUTH_MODE);
}

// ---------------------------------------------------------------- member token
// Short-lived token the site hands to a logged-in active member; the worker checks it on join
// and on the SFU proxy. Format: m1.<b64url(json)>.<b64url(HMAC-SHA256)>

export type MemberClaims = { e: string; n?: string; x: number };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg))));
}

export async function signMemberToken(secret: string, claims: MemberClaims) {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  return `m1.${body}.${await hmac(secret, "m1." + body)}`;
}

export async function verifyMemberToken(secret: string | undefined, token: unknown): Promise<MemberClaims | null> {
  if (!secret || secret.length < 32 || typeof token !== "string" || token.length > 1024) return null;
  const [v, body, sig, extra] = token.split(".");
  if (v !== "m1" || !body || !sig || extra !== undefined) return null;
  const expected = await hmac(secret, "m1." + body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const c = JSON.parse(new TextDecoder().decode(unb64url(body))) as MemberClaims;
    if (typeof c.e !== "string" || typeof c.x !== "number" || c.x * 1000 < Date.now()) return null;
    return c;
  } catch {
    return null;
  }
}
