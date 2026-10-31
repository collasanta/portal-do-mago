import { getViewer, siteMode } from "@/lib/portal/access";
import { json } from "@/lib/portal/ratelimit";

/** GET ?room=: the visitor as the site sees it (no secrets); mode is that room's entry mode (default: main room). */
export async function GET(req: Request) {
  const v = await getViewer(req);
  const room = new URL(req.url).searchParams.get("room")?.slice(0, 40).toLowerCase();
  const mode = room ? siteMode(room) : v.mode;
  return json(200, { email: v.email, name: v.name, member: v.member, role: v.role, admin: v.admin, code: v.code, mode });
}
