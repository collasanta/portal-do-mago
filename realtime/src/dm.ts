/**
 * Direct messages (1:1) for the Portal do Mago room Durable Object.
 *
 * Privacy model: the stable browser uid is a bearer secret (whoever has it can join as you), so it never leaves
 * the server. Clients address people either by their current socket id (online) or by an opaque "pk"
 * (sha256 of the uid, 16 hex) that the server only resolves against the sender's own conversation index.
 * DMs are sent ONLY to the sockets of the two participants, never batched/broadcast.
 *
 * Storage (per room DO):
 *   dmp:<uidA>|<uidB>  (sorted)  -> { m: [{ f: pk, x: text, ts, id }] }   last DM_KEEP msgs, DM_TTL_MS
 *   dmi:<uid>                    -> { [peerUid]: IdxEntry }                 conversation list + unread
 *   dmb:<uid>                    -> peerUid[]                               people this user blocked
 */

export type DmAtt = { id: string; uid: string; name: string; look: unknown; muted: boolean };

const DM_KEEP = 50;
const DM_TTL_MS = 7 * 24 * 3600 * 1000;
const DM_MAX_LEN = 500;
const MAX_CONVS = 100;

type PairMsg = { f: string; x: string; ts: number; id: string };
type IdxEntry = { pk: string; name: string; look: unknown; last: { x: string; ts: number; mine: boolean }; unread: number; ts: number };
type Idx = Record<string, IdxEntry>;

type Bucket = { tokens: number; last: number };
const sendBuckets = new WeakMap<WebSocket, Bucket>();
const readBuckets = new WeakMap<WebSocket, Bucket>();
function take(map: WeakMap<WebSocket, Bucket>, ws: WebSocket, cap: number, perSec: number) {
  const now = Date.now();
  let b = map.get(ws);
  if (!b) map.set(ws, (b = { tokens: cap, last: now }));
  b.tokens = Math.min(cap, b.tokens + ((now - b.last) / 1000) * perSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

const pkCache = new Map<string, string>();
async function pkOf(uid: string) {
  let pk = pkCache.get(uid);
  if (pk) return pk;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pm-dm:" + uid));
  pk = [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (pkCache.size > 5000) pkCache.clear();
  pkCache.set(uid, pk);
  return pk;
}

function send(ws: WebSocket, msg: unknown) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {}
}

function att(ws: WebSocket) {
  return ws.deserializeAttachment() as DmAtt | null;
}

/** Every open, joined socket of a uid (normally one; the room drops older sockets of the same uid). */
function socketsOf(ctx: DurableObjectState, uid: string) {
  const out: { ws: WebSocket; a: DmAtt }[] = [];
  for (const ws of ctx.getWebSockets()) {
    const a = att(ws);
    if (a && a.uid === uid && ws.readyState === WebSocket.OPEN) out.push({ ws, a });
  }
  return out;
}

const pairKey = (u1: string, u2: string) => "dmp:" + (u1 < u2 ? `${u1}|${u2}` : `${u2}|${u1}`);

async function getIdx(ctx: DurableObjectState, uid: string) {
  const idx = (await ctx.storage.get<Idx>("dmi:" + uid)) || {};
  const cut = Date.now() - DM_TTL_MS;
  for (const [k, v] of Object.entries(idx)) if (!v || v.ts < cut) delete idx[k];
  return idx;
}
function capIdx(idx: Idx) {
  const keys = Object.keys(idx);
  if (keys.length <= MAX_CONVS) return idx;
  keys.sort((a, b) => idx[b].ts - idx[a].ts);
  for (const k of keys.slice(MAX_CONVS)) delete idx[k];
  return idx;
}
async function getPair(ctx: DurableObjectState, u1: string, u2: string) {
  const p = (await ctx.storage.get<{ m: PairMsg[] }>(pairKey(u1, u2))) || { m: [] };
  const cut = Date.now() - DM_TTL_MS;
  p.m = p.m.filter((x) => x.ts >= cut).slice(-DM_KEEP);
  return p;
}
async function getBlocks(ctx: DurableObjectState, uid: string) {
  return (await ctx.storage.get<string[]>("dmb:" + uid)) || [];
}

type Target = { uid: string; pk: string; name: string; look: unknown; id: string | null };

/** Resolve a client-supplied `to`: a pk from the sender's own index, or a live socket id. */
async function resolve(ctx: DurableObjectState, me: DmAtt, to: unknown, idx?: Idx): Promise<Target | null> {
  const t = typeof to === "string" ? to.slice(0, 32) : "";
  if (!t) return null;
  if (/^[0-9a-f]{16}$/.test(t)) {
    const ix = idx || (await getIdx(ctx, me.uid));
    for (const [uid, e] of Object.entries(ix)) {
      if (e.pk !== t) continue;
      const live = socketsOf(ctx, uid)[0];
      return { uid, pk: t, name: live?.a.name || e.name, look: live?.a.look || e.look, id: live?.a.id || null };
    }
    // not in my history yet: someone online with that pk (first message after opening by id)
    for (const ws of ctx.getWebSockets()) {
      const a = att(ws);
      if (a && (await pkOf(a.uid)) === t) return { uid: a.uid, pk: t, name: a.name, look: a.look, id: a.id };
    }
    return null;
  }
  for (const ws of ctx.getWebSockets()) {
    const a = att(ws);
    if (a && a.id === t) return { uid: a.uid, pk: await pkOf(a.uid), name: a.name, look: a.look, id: a.id };
  }
  return null;
}

/** Returns true when the frame was a DM frame (handled or rejected). */
export async function handleDm(ctx: DurableObjectState, ws: WebSocket, a: DmAtt, m: any, clean: (s: string) => string): Promise<boolean> {
  switch (m.t) {
    case "dm_list": {
      if (!take(readBuckets, ws, 12, 2)) return true;
      const idx = await getIdx(ctx, a.uid);
      const online = new Map<string, DmAtt>();
      for (const s of ctx.getWebSockets()) {
        const o = att(s);
        if (o) online.set(o.uid, o);
      }
      const blocks = await getBlocks(ctx, a.uid);
      const convs = Object.entries(idx)
        .sort((x, y) => y[1].ts - x[1].ts)
        .map(([uid, e]) => {
          const o = online.get(uid);
          return { peer: { pk: e.pk, id: o?.id || null, name: o?.name || e.name, look: o?.look || e.look }, last: e.last, unread: e.unread, ts: e.ts };
        });
      send(ws, { t: "dm_list", me: await pkOf(a.uid), convs, blocked: await Promise.all(blocks.map(pkOf)) });
      return true;
    }
    case "dm_hist": {
      if (!take(readBuckets, ws, 12, 2)) return true;
      const tg = await resolve(ctx, a, m.to);
      if (!tg) return send(ws, { t: "dm_gone", to: String(m.to || "").slice(0, 32) }), true;
      const [p, myPk, idx] = await Promise.all([getPair(ctx, a.uid, tg.uid), pkOf(a.uid), getIdx(ctx, a.uid)]);
      const unread = idx[tg.uid]?.unread || 0;
      send(ws, {
        t: "dm_hist",
        req: String(m.to || "").slice(0, 32),
        peer: { pk: tg.pk, id: tg.id, name: tg.name, look: tg.look },
        msgs: p.m.map((x) => ({ mid: x.id, mine: x.f === myPk, text: x.x, ts: x.ts })),
        unread,
        blocked: (await getBlocks(ctx, a.uid)).includes(tg.uid),
      });
      return true;
    }
    case "dm_read": {
      if (!take(readBuckets, ws, 12, 2)) return true;
      const idx = await getIdx(ctx, a.uid);
      const tg = await resolve(ctx, a, m.to, idx);
      if (tg && idx[tg.uid]?.unread) {
        idx[tg.uid].unread = 0;
        await ctx.storage.put("dmi:" + a.uid, idx);
      }
      return true;
    }
    case "dm_block": {
      if (!take(readBuckets, ws, 12, 2)) return true;
      const tg = await resolve(ctx, a, m.to);
      if (!tg || tg.uid === a.uid) return true;
      let b = await getBlocks(ctx, a.uid);
      b = b.filter((u) => u !== tg.uid);
      if (m.on) b.push(tg.uid);
      await ctx.storage.put("dmb:" + a.uid, b.slice(-200));
      for (const s of socketsOf(ctx, a.uid)) send(s.ws, { t: "dm_blocked", pk: tg.pk, on: !!m.on });
      return true;
    }
    case "dm": {
      const cid = typeof m.cid === "string" ? m.cid.slice(0, 16) : undefined;
      if (a.muted) return send(ws, { t: "dm_err", cid, msg: "Você está silenciado pela moderação." }), true;
      if (!take(sendBuckets, ws, 6, 0.6)) return send(ws, { t: "dm_err", cid, msg: "Calma, mago! Muitas mensagens seguidas." }), true;
      const text = clean(String(m.text || "")).slice(0, DM_MAX_LEN);
      if (!text) return true;
      const [myIdx, myPk] = await Promise.all([getIdx(ctx, a.uid), pkOf(a.uid)]);
      const tg = await resolve(ctx, a, m.to, myIdx);
      if (!tg) return send(ws, { t: "dm_err", cid, msg: "Essa pessoa saiu do salão." }), true;
      if (tg.uid === a.uid) return true;
      const now = Date.now();
      const msg: PairMsg = { f: myPk, x: text, ts: now, id: now.toString(36) + Math.random().toString(36).slice(2, 6) };
      const out = { mid: msg.id, text, ts: now };
      const toMe = { t: "dm", cid, peer: { pk: tg.pk, id: tg.id, name: tg.name, look: tg.look }, m: { ...out, mine: true } };

      // blocked by the recipient: the sender sees it as sent, nothing is stored or delivered
      if ((await getBlocks(ctx, tg.uid)).includes(a.uid)) {
        for (const s of socketsOf(ctx, a.uid)) send(s.ws, toMe);
        return true;
      }

      const [pair, theirIdx] = await Promise.all([getPair(ctx, a.uid, tg.uid), getIdx(ctx, tg.uid)]);
      pair.m.push(msg);
      if (pair.m.length > DM_KEEP) pair.m.splice(0, pair.m.length - DM_KEEP);
      const preview = text.slice(0, 80);
      myIdx[tg.uid] = { pk: tg.pk, name: tg.name, look: tg.look, last: { x: preview, ts: now, mine: true }, unread: 0, ts: now };
      const prevUnread = theirIdx[a.uid]?.unread || 0;
      theirIdx[a.uid] = { pk: myPk, name: a.name, look: a.look, last: { x: preview, ts: now, mine: false }, unread: Math.min(999, prevUnread + 1), ts: now };
      await ctx.storage.put({ [pairKey(a.uid, tg.uid)]: pair, ["dmi:" + a.uid]: capIdx(myIdx), ["dmi:" + tg.uid]: capIdx(theirIdx) });

      for (const s of socketsOf(ctx, a.uid)) send(s.ws, toMe);
      const toThem = { t: "dm", peer: { pk: myPk, id: a.id, name: a.name, look: a.look }, m: { ...out, mine: false }, unread: prevUnread + 1 };
      for (const s of socketsOf(ctx, tg.uid)) send(s.ws, toThem);
      return true;
    }
  }
  return false;
}
