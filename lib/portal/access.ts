import "server-only";
import { cookies } from "next/headers";
import { keyRole } from "./admin-key";
import { modeForRoom, type AuthMode } from "./authmode";
import { isActiveMember } from "./members";
import { ADMIN_COOKIE, CODE_COOKIE, SESSION_COOKIE, decryptCookie, openCookie } from "./session";

/**
 * Who is looking at the site. Use from server pages and route handlers:
 *
 *   const v = await getViewer();        // { email, member, role, staff, admin, code, mode }
 *   if (!(await canView())) notFound(); // members-only pages (/links, /lives…)
 *   if (!(await isAdmin(req))) 403;     // admin-only writes
 *   if (!(await isStaff(req))) 403;     // admin or host (the Mago): members admin
 *
 * Sources: pm_sess (e-mail confirmed by a login code; membership re-checked in the DB on every call),
 * pm_adm (admin/host key, encrypted, re-checked with the worker, cached 5 min), pm_code (typed the room
 * code), and the `x-portal-key` header (admin key sent by the client, as /links does).
 * Reads cookies, so with Cache Components call it inside <Suspense> or from a route handler.
 */

export type Viewer = {
  /** e-mail confirmed by login code, even if the membership is no longer active */
  email: string | null;
  name: string | null;
  /** active Grimório member right now */
  member: boolean;
  role: "admin" | "host" | null;
  /** admin or host */
  staff: boolean;
  admin: boolean;
  /** typed the right room code on this browser */
  code: boolean;
  /** entry mode of the main room (mirror of the worker's AUTH_MODE) */
  mode: AuthMode;
};

/** Entry mode of a room on the site side; Vercel env mirrors the worker vars (AUTH_MODE, KIWIFY_ONLY_ROOMS, BOTH_ROOMS). */
export function siteMode(room = "salao"): AuthMode {
  const e = process.env;
  return modeForRoom(room, { AUTH_MODE: e.AUTH_MODE, KIWIFY_ONLY_ROOMS: e.KIWIFY_ONLY_ROOMS, BOTH_ROOMS: e.BOTH_ROOMS });
}

export async function getViewer(req?: Request): Promise<Viewer> {
  const jar = await cookies();
  const sess = openCookie<{ e: string }>("sess", jar.get(SESSION_COOKIE)?.value);
  const code = !!openCookie("code", jar.get(CODE_COOKIE)?.value);
  const key = req?.headers.get("x-portal-key") || decryptCookie(jar.get(ADMIN_COOKIE)?.value);
  let member = false;
  let name: string | null = null;
  if (sess?.e) {
    try {
      const m = await isActiveMember(sess.e);
      member = !!m;
      name = m?.name ?? null;
    } catch (e) {
      console.error("portal access: member lookup failed", e);
    }
  }
  const r = key ? await keyRole(key) : "user";
  const role = r === "user" ? null : r;
  return { email: sess?.e ?? null, name, member, role, staff: !!role, admin: role === "admin", code, mode: siteMode() };
}

/** May this visitor see members-only pages? Members and staff always; room-code holders unless the main room is kiwify-only. */
export async function canView(req?: Request): Promise<boolean> {
  const v = await getViewer(req);
  if (v.staff || v.member) return true;
  return v.mode !== "kiwify" && v.code;
}

/** Admin role only (x-portal-key header or admin cookie). */
export async function isAdmin(req?: Request): Promise<boolean> {
  return (await getViewer(req)).admin;
}

/** Admin or host (the Mago). */
export async function isStaff(req?: Request): Promise<boolean> {
  return (await getViewer(req)).staff;
}
