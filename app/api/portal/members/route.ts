import { deleteMember, getMember, listMembers, logEvent, recentEvents, upsertMember } from "@/lib/portal/members";
import { json } from "@/lib/portal/ratelimit";
import { normEmail } from "@/lib/portal/session";
import { actorOf, staffGate } from "@/lib/portal/staff-gate";
import { siteMode } from "@/lib/portal/access";
import { productFilter, webhookTokens } from "@/lib/portal/kiwify";
import { syncConfig } from "@/lib/portal/kiwify-sync.mjs";
import { mailConfigured } from "@/lib/portal/mail";

const WORKER = (process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:8787").replace(/\/$/, "");

async function workerMode(room: string) {
  try {
    const r = await fetch(`${WORKER}/info?room=${room}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return ((await r.json()) as { mode?: string }).mode || "code";
  } catch {
    return "?";
  }
}

/** GET ?q=: members list + counts + recent events + config status. */
export async function GET(req: Request) {
  const g = await staffGate(req, false);
  if ("res" in g) return g.res;
  const search = new URL(req.url).searchParams.get("q") || "";
  const [list, events, salao, teste] = await Promise.all([listMembers(search), recentEvents(30), workerMode("salao"), workerMode("teste")]);
  const origin = new URL(req.url).origin;
  return json(200, {
    ...list,
    events,
    role: g.v.role,
    config: {
      modes: { salao, teste },
      siteMode: siteMode(),
      webhookUrl: `${origin}/api/kiwify/webhook`,
      webhookToken: webhookTokens().length > 0,
      sync: syncConfig(process.env).ok,
      syncMissing: syncConfig(process.env).missing,
      mail: mailConfigured(),
      memberToken: !!process.env.PORTAL_MEMBER_TOKEN_SECRET,
      products: productFilter(),
    },
  });
}

/** POST {email, name?, status?}: add or (re)activate by hand. */
export async function POST(req: Request) {
  const g = await staffGate(req, true);
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => ({}))) as { email?: string; name?: string; status?: string; note?: string };
  const email = normEmail(b.email);
  if (!email) return json(400, { error: "E-mail inválido." });
  const status = b.status === "inactive" ? "inactive" : "active";
  await upsertMember({ email, status, source: "manual", name: b.name?.trim().slice(0, 80) || null, note: b.note?.trim().slice(0, 200) || null, last_event: `manual:${status}` });
  await logEvent({ source: "admin", event_type: `manual:${status}`, email, result: `applied:${status}`, actor: actorOf(g.v) });
  return json(200, { ok: true, member: await getMember(email) });
}

/** DELETE ?email=: remove the row (the e-mail loses access; a later Kiwify event can add it back). */
export async function DELETE(req: Request) {
  const g = await staffGate(req, true);
  if ("res" in g) return g.res;
  const email = normEmail(new URL(req.url).searchParams.get("email"));
  if (!email) return json(400, { error: "E-mail inválido." });
  await deleteMember(email);
  await logEvent({ source: "admin", event_type: "manual:delete", email, result: "deleted", actor: actorOf(g.v) });
  return json(200, { ok: true });
}
