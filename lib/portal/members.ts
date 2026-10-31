import "server-only";
import { q } from "@/lib/oraculo/db";

// curso.portal_members: who may enter the Portal as a Grimório member (Kiwify purchase / manual / CSV).

export type Member = {
  email: string;
  name: string | null;
  status: "active" | "inactive";
  source: string;
  access_until: string | null;
  kiwify_customer_id: string | null;
  kiwify_order_id: string | null;
  kiwify_subscription_id: string | null;
  product_id: string | null;
  product_name: string | null;
  last_event: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** Active = status active and (no end date, or the paid period has not ended). */
export const ACTIVE_SQL = "status = 'active' and (access_until is null or access_until > now())";

export async function getMember(email: string): Promise<Member | null> {
  const r = await q<Member>("select * from curso.portal_members where email = $1", [email]);
  return r[0] ?? null;
}

export async function isActiveMember(email: string): Promise<Member | null> {
  if (!email) return null;
  const r = await q<Member>(`select * from curso.portal_members where email = $1 and ${ACTIVE_SQL}`, [email]);
  return r[0] ?? null;
}

export type MemberUpsert = {
  email: string;
  status: "active" | "inactive";
  source: "kiwify" | "manual" | "csv" | "sync";
  name?: string | null;
  access_until?: string | null;
  kiwify_customer_id?: string | null;
  kiwify_order_id?: string | null;
  kiwify_subscription_id?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  last_event?: string | null;
  note?: string | null;
};

/** Insert or update one member; null/undefined fields keep the stored value (except access_until when status changes). */
export async function upsertMember(m: MemberUpsert) {
  await q(
    `insert into curso.portal_members
       (email, name, status, source, access_until, kiwify_customer_id, kiwify_order_id, kiwify_subscription_id, product_id, product_name, last_event, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (email) do update set
       name = coalesce(excluded.name, portal_members.name),
       status = excluded.status,
       source = excluded.source,
       access_until = excluded.access_until,
       kiwify_customer_id = coalesce(excluded.kiwify_customer_id, portal_members.kiwify_customer_id),
       kiwify_order_id = coalesce(excluded.kiwify_order_id, portal_members.kiwify_order_id),
       kiwify_subscription_id = coalesce(excluded.kiwify_subscription_id, portal_members.kiwify_subscription_id),
       product_id = coalesce(excluded.product_id, portal_members.product_id),
       product_name = coalesce(excluded.product_name, portal_members.product_name),
       last_event = coalesce(excluded.last_event, portal_members.last_event),
       note = coalesce(excluded.note, portal_members.note),
       updated_at = now()`,
    [
      m.email, m.name ?? null, m.status, m.source, m.access_until ?? null, m.kiwify_customer_id ?? null, m.kiwify_order_id ?? null,
      m.kiwify_subscription_id ?? null, m.product_id ?? null, m.product_name ?? null, m.last_event ?? null, m.note ?? null,
    ],
  );
}

export async function deleteMember(email: string) {
  await q("delete from curso.portal_members where email = $1", [email]);
}

export type EventLog = {
  source: string;
  event_type?: string | null;
  order_id?: string | null;
  subscription_id?: string | null;
  email?: string | null;
  product_id?: string | null;
  result: string;
  dedupe_key?: string | null;
  actor?: string | null;
  payload?: unknown;
};

/** Returns the event id, or null when dedupe_key was already logged (duplicate delivery). */
export async function logEvent(e: EventLog): Promise<string | null> {
  const r = await q<{ id: string }>(
    `insert into curso.portal_member_events (source, event_type, order_id, subscription_id, email, product_id, result, dedupe_key, actor, payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (dedupe_key) do nothing returning id`,
    [
      e.source, e.event_type ?? null, e.order_id ?? null, e.subscription_id ?? null, e.email ?? null, e.product_id ?? null,
      e.result, e.dedupe_key ?? null, e.actor ?? null, e.payload === undefined ? null : JSON.stringify(e.payload),
    ],
  );
  return r[0]?.id ?? null;
}

export async function setEventResult(id: string, result: string) {
  await q("update curso.portal_member_events set result = $2 where id = $1", [id, result]);
}

export async function eventResult(dedupeKey: string) {
  const r = await q<{ id: string; result: string }>("select id, result from curso.portal_member_events where dedupe_key = $1", [dedupeKey]);
  return r[0] ?? null;
}

export async function listMembers(search: string, limit = 200) {
  const s = search.trim().toLowerCase();
  const rows = await q<Member & { active: boolean }>(
    `select *, (${ACTIVE_SQL}) as active from curso.portal_members
     where ($1 = '' or email like '%' || $1 || '%' or lower(coalesce(name,'')) like '%' || $1 || '%')
     order by updated_at desc limit $2`,
    [s, limit],
  );
  const [c] = await q<{ total: string; active: string }>(
    `select count(*) as total, count(*) filter (where ${ACTIVE_SQL}) as active from curso.portal_members`,
  );
  return { rows, total: Number(c?.total || 0), active: Number(c?.active || 0) };
}

export async function recentEvents(limit = 30) {
  return q(
    `select id, received_at, source, event_type, email, product_id, result, actor from curso.portal_member_events
     order by received_at desc limit $1`,
    [limit],
  );
}
