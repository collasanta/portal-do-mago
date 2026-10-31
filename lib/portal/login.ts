import "server-only";
import crypto from "node:crypto";
import { q } from "@/lib/oraculo/db";
import { sendLoginCode } from "./mail";
import { isActiveMember } from "./members";
import { keyedHash } from "./session";

// E-mail login codes: 6 digits, stored as HMAC, 10-minute expiry, 5 attempts per code, 5 codes per e-mail per hour.
const TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_PER_HOUR = 5;

const codeHash = (email: string, code: string) => keyedHash(`login:${email}:${code}`);

/** Sends a code when the e-mail is an active member. Returns what happened (the API answers the same in every case). */
export async function requestLoginCode(email: string, ip: string): Promise<"sent" | "not-member" | "too-many"> {
  await q("delete from curso.portal_login_codes where created_at < now() - interval '1 day'");
  const [{ n }] = await q<{ n: number }>(
    "select count(*)::int n from curso.portal_login_codes where email = $1 and created_at > now() - interval '1 hour'",
    [email],
  );
  if (n >= MAX_PER_HOUR) return "too-many";
  if (!(await isActiveMember(email))) return "not-member";
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  // a new code replaces the previous ones
  await q("update curso.portal_login_codes set used_at = now() where email = $1 and used_at is null", [email]);
  await q(
    `insert into curso.portal_login_codes (email, code_hash, expires_at, ip_hash) values ($1, $2, now() + interval '${TTL_MIN} minutes', $3)`,
    [email, codeHash(email, code), keyedHash("ip:" + ip).slice(0, 32)],
  );
  await sendLoginCode(email, code);
  return "sent";
}

export async function verifyLoginCode(email: string, code: string): Promise<"ok" | "wrong" | "expired" | "inactive"> {
  const rows = await q<{ id: string; code_hash: string; attempts: number }>(
    `select id, code_hash, attempts from curso.portal_login_codes
     where email = $1 and used_at is null and expires_at > now() order by created_at desc limit 1`,
    [email],
  );
  const row = rows[0];
  if (!row || row.attempts >= MAX_ATTEMPTS) return "expired";
  await q("update curso.portal_login_codes set attempts = attempts + 1 where id = $1", [row.id]);
  const a = Buffer.from(row.code_hash);
  const b = Buffer.from(codeHash(email, code));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return row.attempts + 1 >= MAX_ATTEMPTS ? "expired" : "wrong";
  await q("update curso.portal_login_codes set used_at = now() where id = $1", [row.id]);
  return (await isActiveMember(email)) ? "ok" : "inactive";
}
