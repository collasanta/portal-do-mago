import { DurableObject } from "cloudflare:workers";
import { handleDm } from "./dm";
import { handleLives, type LivesEnv } from "./lives";
export { Archive } from "./lives";
// the room layout is shared with the client (bounds, spawn, seats): one source of truth
import { MAP_H, MAP_W, SEATS, SPAWN } from "../../lib/portal/map";
// entry modes (code / both / kiwify) + member token check, shared with the site
import { modeForRoom, verifyMemberToken, type AuthMode } from "../../lib/portal/authmode";

/**
 * Portal do Mago realtime server.
 * One Durable Object per room ("salao" by default), WebSocket Hibernation API.
 * Protocol: JSON text frames. Server -> client frames are batched as {t:"b", e:[...events]}
 * every FLUSH_MS so 300 users moving does not explode into 300x300 sends.
 */

export interface Env extends LivesEnv {
  ROOM: DurableObjectNamespace<Room>;
  ROOM_CODE?: string;
  ADMIN_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
  /** JSON {"admin":{"key":"…","role":"admin"},"mago":{"key":"…","role":"host"}}: named, revocable keys. */
  ADMIN_KEYS?: string;
  /** Cloudflare Realtime SFU (Calls) app: the live broadcast. */
  CALLS_APP_ID?: string;
  CALLS_APP_SECRET?: string;
  /** Entry mode for every room: code (default) | both | kiwify. Admin/host keys always enter. */
  AUTH_MODE?: string;
  /** Comma lists of rooms that override AUTH_MODE, e.g. "teste". */
  KIWIFY_ONLY_ROOMS?: string;
  BOTH_ROOMS?: string;
  /** HMAC secret shared with the site (PORTAL_MEMBER_TOKEN_SECRET there): signs member tokens. */
  MEMBER_TOKEN_SECRET?: string;
}

type Role = "admin" | "host" | "user";
/** Resolve a key to a role. The legacy shared ADMIN_KEY stays an admin key. */
function roleFor(env: Env, key: unknown): { role: Role; who: string } {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k) return { role: "user", who: "" };
  if (env.ADMIN_KEY && k === env.ADMIN_KEY) return { role: "admin", who: "admin" };
  if (env.ADMIN_KEYS) {
    try {
      const map = JSON.parse(env.ADMIN_KEYS) as Record<string, { key: string; role: string }>;
      for (const [who, v] of Object.entries(map)) {
        if (v && typeof v.key === "string" && v.key.length >= 12 && v.key === k) return { role: v.role === "host" ? "host" : "admin", who };
      }
    } catch {}
  }
  return { role: "user", who: "" };
}

// ---------------------------------------------------------------- live
const MAX_GUESTS = 3;
const REACTIONS = ["heart", "fire", "clap", "laugh", "wow", "mago"];
type LiveTrack = { name: string; kind: "audio" | "video"; role: "cam" | "screen" | "mic" | "sys" };
type StageGuest = { uid: string; id: string; name: string; sfu: { session: string; track: string } | null };
type Hand = { uid: string; id: string; name: string; ts: number };
type Live = {
  on: boolean;
  id: string;
  startedAt: number;
  hostId: string;
  hostUid: string;
  hostName: string;
  source: "sfu" | "embed";
  embed: string;
  sfu: { session: string; tracks: LiveTrack[] } | null;
  view: "camera" | "screen" | "pip";
  stage: StageGuest[];
  hands: Hand[];
  pin: string;
};
const LIVE_OFF: Live = {
  on: false, id: "", startedAt: 0, hostId: "", hostUid: "", hostName: "", source: "sfu", embed: "", sfu: null, view: "camera", stage: [], hands: [], pin: "",
};
/** What every client sees (the hands queue goes only to moderators). */
function livePub(l: Live) {
  const { hands, hostUid: _h, ...rest } = l;
  return { ...rest, stage: l.stage.map((g) => ({ id: g.id, name: g.name, sfu: g.sfu })), hands: hands.length, handIds: hands.map((h) => h.id) };
}
const SID = /^[A-Za-z0-9_-]{8,128}$/;
const TNAME = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_USERS = 400;
const CHAT_KEEP = 100;
const CHAT_MAX_LEN = 240;
const NAME_MAX_LEN = 20;
const FLUSH_MS = 80;
const BAN_MS = 30 * 60 * 1000;

type Look = {
  skin: number; hair: number; hairStyle: number; shirt: number; hat: number;
  top: number; pants: number; shoes: number; glasses: number; bottom: number;
};
type Att = {
  id: string;
  uid: string;
  name: string;
  look: Look;
  x: number;
  y: number;
  tx: number;
  ty: number;
  mic: boolean;
  admin: boolean;
  role: Role;
  who: string;
  muted: boolean;
  joined: number;
  /** SEATS index while seated, -1 standing (lives in the attachment, so it survives hibernation) */
  seat?: number;
};
type ChatMsg = { id: string; name: string; text: string; ts: number; sys?: boolean };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,x-room-code,x-portal-key,range",
  "Access-Control-Expose-Headers": "content-range,content-length,accept-ranges",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...CORS } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const room = (url.searchParams.get("room") || "salao").replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "salao";

    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "portaldomago-realtime" });

    if (url.pathname === "/info") {
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      const stats = await stub.stats();
      const mode = modeForRoom(room, env);
      // codeRequired kept for older cached clients; new clients read mode
      return json({ codeRequired: mode !== "kiwify" && !!env.ROOM_CODE, mode, room, online: stats.online, live: stats.live, sfu: !!(env.CALLS_APP_ID && env.CALLS_APP_SECRET) });
    }

    if (url.pathname === "/check") {
      const code = url.searchParams.get("c") || "";
      return json({ ok: !env.ROOM_CODE || code.trim().toLowerCase() === env.ROOM_CODE.toLowerCase() });
    }

    if (url.pathname === "/ice") return json(await iceServers(env));

    // Lives anteriores: recording uploads, playback (HLS + Range), transcripts (realtime/src/lives.ts)
    if (url.pathname.startsWith("/lives/")) return handleLives(req, env, url, (k) => roleFor(env, k), json, CORS);

    // Cloudflare Realtime SFU proxy: the app secret never leaves the worker. Gate = the room code.
    if (url.pathname.startsWith("/sfu/")) return sfuProxy(req, env, url.pathname.slice(5));

    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(req);
    }

    // Which role does a key have? POST /role {key} -> {role: admin|host|user}. Used by the site (members admin).
    if (url.pathname === "/role" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, string>;
      const { role, who } = roleFor(env, body.key);
      return json(role === "user" ? { role } : { role, who });
    }

    // Admin HTTP API: POST /admin?room=salao  {key, action: kick|mute|unmute|clear|announce|stats, target?, text?}
    if (url.pathname === "/admin" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, string>;
      if (roleFor(env, body.key).role !== "admin") return json({ error: "forbidden" }, 403);
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return json(await stub.adminAction(body.action, body.target, body.text));
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};

async function sfuProxy(req: Request, env: Env, path: string) {
  if (!env.CALLS_APP_ID || !env.CALLS_APP_SECRET) return json({ error: "sfu not configured" }, 503);
  // gate: the room code, a valid member token, or an admin/host key (same header)
  const raw = (req.headers.get("x-room-code") || "").trim();
  const code = raw.toLowerCase();
  const allowed =
    !env.ROOM_CODE ||
    code === env.ROOM_CODE.toLowerCase() ||
    (raw.startsWith("m1.") && !!(await verifyMemberToken(env.MEMBER_TOKEN_SECRET, raw))) ||
    roleFor(env, raw).role !== "user";
  if (!allowed) return json({ error: "forbidden" }, 403);
  const ok =
    (path === "sessions/new" && req.method === "POST") ||
    (/^sessions\/[A-Za-z0-9_-]{8,128}\/tracks\/new$/.test(path) && req.method === "POST") ||
    (/^sessions\/[A-Za-z0-9_-]{8,128}\/(renegotiate|tracks\/close)$/.test(path) && req.method === "PUT") ||
    (/^sessions\/[A-Za-z0-9_-]{8,128}$/.test(path) && req.method === "GET");
  if (!ok) return json({ error: "bad path" }, 400);
  const body = req.method === "GET" ? undefined : await req.text();
  if (body && body.length > 200_000) return json({ error: "too big" }, 413);
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${env.CALLS_APP_ID}/${path}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${env.CALLS_APP_SECRET}`, "content-type": "application/json" },
      body: body || undefined,
    });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", ...CORS } });
  } catch (e) {
    return json({ error: "sfu unreachable", detail: String(e) }, 502);
  }
}

async function iceServers(env: Env) {
  const stun = { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return { iceServers: [stun], turn: false };
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: 6 * 3600 }),
      },
    );
    if (!r.ok) throw new Error(String(r.status));
    const d = (await r.json()) as { iceServers: unknown };
    return { iceServers: Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers], turn: true };
  } catch {
    return { iceServers: [stun], turn: false };
  }
}

const BAD_WORDS = [
  "caralho", "porra", "buceta", "viado", "puta", "fdp", "arrombado", "cuzao", "cuzão", "vagabunda", "macaco",
];
function clean(text: string) {
  let t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  for (const w of BAD_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, "gi");
    t = t.replace(re, (m) => m[0] + "*".repeat(m.length - 1));
  }
  return t;
}
function cleanName(name: unknown) {
  const n = clean(String(name || "")).replace(/[<>]/g, "").slice(0, NAME_MAX_LEN).trim();
  return n || "Aprendiz";
}
function int(v: unknown, lo: number, hi: number, d = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}
function sanitizeLook(l: any): Look {
  return {
    skin: int(l?.skin, 0, 9),
    hair: int(l?.hair, 0, 15),
    hairStyle: int(l?.hairStyle, 0, 11),
    shirt: int(l?.shirt, 0, 15),
    hat: int(l?.hat, 0, 8),
    // added with the Habbo-style avatars; old clients omit them -> 0
    top: int(l?.top, 0, 6),
    pants: int(l?.pants, 0, 9),
    shoes: int(l?.shoes, 0, 7),
    glasses: int(l?.glasses, 0, 3),
    bottom: int(l?.bottom, 0, 2), // calça / bermuda / saia
  };
}
function pub(a: Att) {
  return { id: a.id, name: a.name, look: a.look, x: a.x, y: a.y, tx: a.tx, ty: a.ty, mic: a.mic, admin: a.admin, role: a.role, seat: a.seat ?? -1 };
}

type Bucket = { tokens: number; last: number };

export class Room extends DurableObject<Env> {
  private queue: unknown[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private buckets = new Map<WebSocket, { chat: Bucket; move: Bucket; rtc: Bucket; misc: Bucket; typing: Bucket }>();
  private chat: ChatMsg[] | null = null;
  private seq = 0;
  private live: Live | null = null;
  private allMuted: boolean | null = null;
  private rx: Record<string, number> = {};
  private rxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer app-level pings without waking the DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async stats() {
    const l = await this.getLive();
    return { online: this.sockets().length, live: l.on };
  }

  private async getLive(): Promise<Live> {
    if (!this.live) this.live = { ...LIVE_OFF, ...((await this.ctx.storage.get<Live>("live")) || {}) };
    return this.live;
  }
  private async getAllMuted() {
    if (this.allMuted === null) this.allMuted = !!(await this.ctx.storage.get<boolean>("allMuted"));
    return this.allMuted;
  }
  /** Persist + broadcast the live state; the full hands queue goes to moderators only. */
  private async saveLive(l: Live) {
    this.live = l;
    await this.ctx.storage.put("live", l);
    this.broadcast({ t: "live", live: livePub(l) });
    this.sendMods({ t: "hands", list: l.hands });
  }
  private sendMods(msg: unknown) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a && a.admin) this.send(ws, msg);
    }
  }
  /** Proximity voice is closed for everyone during a live (the stage talks through the SFU),
   *  and for non-moderators while "mute all" is on. */
  private async voiceLocked(a: Att) {
    if ((await this.getLive()).on) return true;
    return !a.admin && (await this.getAllMuted());
  }
  /** Turn every open proximity mic off (live start / mute all). */
  private forceMicsOff(onlyUsers: boolean) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (!a || !a.mic || (onlyUsers && a.admin)) continue;
      a.mic = false;
      ws.serializeAttachment(a);
      this.broadcast({ t: "mic", id: a.id, on: false });
    }
  }

  private sockets() {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment() as Att | null;
      return !!a && ws.readyState === WebSocket.OPEN;
    });
  }

  private att(ws: WebSocket) {
    return ws.deserializeAttachment() as Att | null;
  }

  private async loadChat() {
    if (!this.chat) this.chat = ((await this.ctx.storage.get<ChatMsg[]>("chat")) || []).slice(-CHAT_KEEP);
    return this.chat;
  }

  private async pushChat(m: ChatMsg) {
    const c = await this.loadChat();
    c.push(m);
    if (c.length > CHAT_KEEP) c.splice(0, c.length - CHAT_KEEP);
    await this.ctx.storage.put("chat", c);
  }

  private take(ws: WebSocket, kind: "chat" | "move" | "rtc" | "misc" | "typing") {
    let b = this.buckets.get(ws);
    if (!b) {
      const now = Date.now();
      b = {
        chat: { tokens: 5, last: now },
        move: { tokens: 10, last: now },
        rtc: { tokens: 80, last: now },
        misc: { tokens: 10, last: now },
        typing: { tokens: 4, last: now },
      };
      this.buckets.set(ws, b);
    }
    // [capacity, refill per second]
    const cfg = { chat: [5, 0.7], move: [10, 6], rtc: [80, 40], misc: [10, 3], typing: [4, 1] }[kind];
    const bk = b[kind];
    const now = Date.now();
    bk.tokens = Math.min(cfg[0], bk.tokens + ((now - bk.last) / 1000) * cfg[1]);
    bk.last = now;
    if (bk.tokens < 1) return false;
    bk.tokens -= 1;
    return true;
  }

  private broadcast(ev: unknown) {
    this.queue.push(ev);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush() {
    this.flushTimer = null;
    if (!this.queue.length) return;
    const frame = JSON.stringify({ t: "b", e: this.queue });
    this.queue = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (!this.att(ws)) continue;
      try {
        ws.send(frame);
      } catch {}
    }
  }

  private send(ws: WebSocket, msg: unknown) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private findById(id: string) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a && a.id === id) return { ws, a };
    }
    return null;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (this.ctx.getWebSockets().length >= MAX_USERS) return new Response("room full", { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const room = (url.searchParams.get("room") || "salao").replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "salao";
    // tag 0 = uid, tag 1 = entry mode of this room (read back in onJoin)
    this.ctx.acceptWebSocket(server, [url.searchParams.get("uid")?.slice(0, 64) || "anon", "mode:" + modeForRoom(room, this.env)]);
    // Not joined yet: attachment null until a valid "join" arrives.
    server.serializeAttachment(null);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 8192) return;
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const a = this.att(ws);

    if (m.t === "join") return this.onJoin(ws, m);
    if (!a) return;
    // direct messages: own module, routed only to the two participants (realtime/src/dm.ts)
    if (typeof m.t === "string" && m.t.startsWith("dm")) return void (await handleDm(this.ctx, ws, a, m, clean));

    switch (m.t) {
      case "mv": {
        if (!this.take(ws, "move")) return;
        a.x = int(m.x, 0, MAP_W - 1, a.x);
        a.y = int(m.y, 0, MAP_H - 1, a.y);
        a.tx = int(m.tx, 0, MAP_W - 1, a.x);
        a.ty = int(m.ty, 0, MAP_H - 1, a.y);
        a.seat = -1; // walking stands you up (clients infer it from the mv)
        ws.serializeAttachment(a);
        this.broadcast({ t: "mv", id: a.id, x: a.x, y: a.y, tx: a.tx, ty: a.ty });
        return;
      }
      case "pos": {
        // Silent position settle (arrival); no broadcast, keeps snapshot accurate for newcomers.
        if (!this.take(ws, "move")) return;
        a.x = a.tx = int(m.x, 0, MAP_W - 1, a.x);
        a.y = a.ty = int(m.y, 0, MAP_H - 1, a.y);
        ws.serializeAttachment(a);
        return;
      }
      case "sit": {
        // one person per seat: occupancy = the seats in the live attachments (released on move / leave / disconnect)
        if (!this.take(ws, "move")) return;
        const s = int(m.s, -1, SEATS.length - 1, -1);
        if (s < 0) {
          if ((a.seat ?? -1) < 0) return;
          a.seat = -1;
          ws.serializeAttachment(a);
          this.broadcast({ t: "sit", id: a.id, s: -1 });
          return;
        }
        const st = SEATS[s];
        if (a.seat === s) return;
        if (a.tx !== st.x || a.ty !== st.y) return this.send(ws, { t: "sitno", s });
        for (const o of this.ctx.getWebSockets()) {
          if (o === ws) continue;
          const oa = this.att(o);
          if (oa && oa.seat === s) return this.send(ws, { t: "sitno", s });
        }
        a.seat = s;
        a.x = st.x;
        a.y = st.y;
        ws.serializeAttachment(a);
        this.broadcast({ t: "sit", id: a.id, s });
        return;
      }
      case "chat": {
        if (a.muted) return this.send(ws, { t: "err", msg: "Você está silenciado pela moderação." });
        if (!this.take(ws, "chat")) return this.send(ws, { t: "err", msg: "Calma, mago! Muitas mensagens seguidas." });
        const text = clean(String(m.text || "")).slice(0, CHAT_MAX_LEN);
        if (!text) return;
        const msg: ChatMsg = { id: a.id, name: a.name, text, ts: Date.now() };
        this.broadcast({ t: "chat", m: msg, cid: typeof m.cid === "string" ? m.cid.slice(0, 16) : undefined });
        await this.pushChat(msg);
        return;
      }
      case "emote": {
        if (!this.take(ws, "misc")) return;
        const e = String(m.e || "").slice(0, 8);
        if (!["wave", "heart", "laugh", "fire", "spark", "clap"].includes(e)) return;
        this.broadcast({ t: "emote", id: a.id, e });
        return;
      }
      case "typing": {
        // "…" bubble over the speaker's head; own bucket so it never eats chat/emote tokens.
        if (a.muted || !this.take(ws, "typing")) return;
        this.broadcast({ t: "typing", id: a.id, on: !!m.on });
        return;
      }
      case "call": {
        // "Chamar pra perto": a nudge delivered only to the target.
        if (a.muted || !this.take(ws, "misc")) return;
        const target = this.findById(String(m.to || ""));
        if (!target || target.a.id === a.id) return;
        this.send(target.ws, { t: "call", from: a.id, name: a.name });
        return;
      }
      case "mic": {
        if (!this.take(ws, "misc")) return;
        a.mic = !!m.on && !a.muted && !(await this.voiceLocked(a));
        ws.serializeAttachment(a);
        this.broadcast({ t: "mic", id: a.id, on: a.mic });
        return;
      }
      case "rtc": {
        if (!this.take(ws, "rtc")) return;
        if (a.muted) return;
        const target = this.findById(String(m.to || ""));
        if (!target) return;
        // server-side mute: no proximity signalling during a live / mute-all ("bye" still passes)
        if (!(m.d && m.d.bye) && ((await this.voiceLocked(a)) || (await this.voiceLocked(target.a)))) return;
        this.send(target.ws, { t: "rtc", from: a.id, d: m.d });
        return;
      }
      case "hand": {
        if (!this.take(ws, "misc")) return;
        const l = await this.getLive();
        if (!l.on) return;
        const has = l.hands.findIndex((h) => h.uid === a.uid);
        if (m.on && has < 0 && !l.stage.some((g) => g.uid === a.uid)) {
          if (l.hands.length >= 500) return;
          l.hands.push({ uid: a.uid, id: a.id, name: a.name, ts: Date.now() });
        } else if (!m.on && has >= 0) l.hands.splice(has, 1);
        else return;
        await this.saveLive(l);
        return;
      }
      case "react": {
        // aggregated: one {t:"rx"} tally per ~700 ms instead of 300 single events
        if (!this.take(ws, "misc")) return;
        const e = String(m.e || "");
        if (!REACTIONS.includes(e)) return;
        this.rx[e] = (this.rx[e] || 0) + 1;
        if (!this.rxTimer)
          this.rxTimer = setTimeout(() => {
            this.rxTimer = null;
            const c = this.rx;
            this.rx = {};
            this.broadcast({ t: "rx", c });
          }, 700);
        return;
      }
      case "live":
        return this.onLive(ws, a, m);
      case "admin": {
        if (!a.admin) return this.send(ws, { t: "err", msg: "Sem permissão." });
        const r = await this.adminAction(String(m.action), String(m.target || ""), String(m.text || ""));
        this.send(ws, { t: "adminr", r });
        return;
      }
    }
  }

  private async onJoin(ws: WebSocket, m: any) {
    const existing = this.att(ws);
    if (existing) return;
    const code = String(m.code || "").trim().toLowerCase();
    const { role, who } = roleFor(this.env, m.adminKey);
    const mode = (this.ctx.getTags(ws).find((t) => t.startsWith("mode:"))?.slice(5) || "code") as AuthMode;
    const codeOk = !this.env.ROOM_CODE || code === this.env.ROOM_CODE.toLowerCase();
    const memberOk = mode !== "code" && !!m.mt && !!(await verifyMemberToken(this.env.MEMBER_TOKEN_SECRET, m.mt));
    const allowed = role !== "user" || (mode === "code" ? codeOk : mode === "both" ? codeOk || memberOk : memberOk);
    if (!allowed) {
      this.send(ws, { t: "denied", reason: mode === "code" ? "code" : "member" });
      ws.close(4001, "bad code");
      return;
    }
    const uid = String(m.uid || "").slice(0, 64) || crypto.randomUUID();
    const bans = (await this.ctx.storage.get<Record<string, number>>("bans")) || {};
    if (bans[uid] && bans[uid] > Date.now()) {
      this.send(ws, { t: "denied", reason: "kicked" });
      ws.close(4003, "banned");
      return;
    }
    const mutes = (await this.ctx.storage.get<Record<string, boolean>>("mutes")) || {};

    // Same browser reconnecting: drop the older socket so there are no ghosts.
    for (const other of this.ctx.getWebSockets()) {
      const oa = this.att(other);
      if (oa && oa.uid === uid && other !== ws) {
        other.serializeAttachment(null);
        try {
          other.close(4000, "replaced");
        } catch {}
        this.broadcast({ t: "leave", id: oa.id });
      }
    }

    const isAdmin = role !== "user";
    const has = m.x != null && m.y != null;
    // spread newcomers over the entrance area (all walkable tiles) so nobody stacks
    const sx = has ? int(m.x, 0, MAP_W - 1, SPAWN.x) : SPAWN.x - 2 + Math.floor(Math.random() * 5);
    const sy = has ? int(m.y, 0, MAP_H - 1, SPAWN.y) : SPAWN.y - 1 + Math.floor(Math.random() * 3);
    const a: Att = {
      id: (++this.seq).toString(36) + Math.random().toString(36).slice(2, 7),
      uid,
      name: cleanName(m.name),
      look: sanitizeLook(m.look),
      x: sx,
      y: sy,
      tx: sx,
      ty: sy,
      mic: false,
      admin: isAdmin,
      role,
      who,
      muted: !!mutes[uid],
      joined: Date.now(),
      seat: -1,
    };
    ws.serializeAttachment(a);
    const users = this.sockets()
      .map((s) => this.att(s)!)
      .filter((u) => u.id !== a.id)
      .map(pub);
    // re-attach a reconnecting host / stage guest / raised hand to the new socket id
    const l = await this.getLive();
    let liveDirty = false;
    if (l.on) {
      for (const g of l.stage) if (g.uid === uid && g.id !== a.id) ((g.id = a.id), (g.sfu = null), (liveDirty = true));
      for (const h of l.hands) if (h.uid === uid && h.id !== a.id) ((h.id = a.id), (liveDirty = true));
      if (l.hostUid === uid && l.hostId !== a.id) ((l.hostId = a.id), (liveDirty = true));
    }
    this.send(ws, {
      t: "welcome", me: pub(a), users, chat: await this.loadChat(), admin: isAdmin, muted: a.muted,
      role, live: livePub(l), allMuted: await this.getAllMuted(), hands: isAdmin ? l.hands : undefined,
    });
    this.broadcast({ t: "join", u: pub(a) });
    if (liveDirty) await this.saveLive(l);
  }

  async adminAction(action: string, target?: string, text?: string) {
    switch (action) {
      case "stats":
        return { online: this.sockets().length, users: this.sockets().map((s) => pub(this.att(s)!)) };
      case "kick":
      case "mute":
      case "unmute": {
        const t = target ? this.findById(target) || this.findByName(target) : null;
        if (!t) return { ok: false, error: "user not found" };
        if (action === "kick") {
          const bans = (await this.ctx.storage.get<Record<string, number>>("bans")) || {};
          bans[t.a.uid] = Date.now() + BAN_MS;
          await this.ctx.storage.put("bans", bans);
          this.send(t.ws, { t: "kicked" });
          t.ws.serializeAttachment(null);
          try {
            t.ws.close(4003, "kicked");
          } catch {}
          this.broadcast({ t: "leave", id: t.a.id });
          this.broadcast({ t: "sys", text: `${t.a.name} foi removido pela moderação.` });
        } else {
          const mutes = (await this.ctx.storage.get<Record<string, boolean>>("mutes")) || {};
          if (action === "mute") mutes[t.a.uid] = true;
          else delete mutes[t.a.uid];
          await this.ctx.storage.put("mutes", mutes);
          t.a.muted = action === "mute";
          if (t.a.muted) t.a.mic = false;
          t.ws.serializeAttachment(t.a);
          this.send(t.ws, { t: "muted", on: t.a.muted });
          this.broadcast({ t: "mic", id: t.a.id, on: t.a.mic });
        }
        return { ok: true, name: t.a.name };
      }
      case "unban": {
        await this.ctx.storage.delete("bans");
        return { ok: true };
      }
      case "clear": {
        this.chat = [];
        await this.ctx.storage.put("chat", []);
        this.broadcast({ t: "clear" });
        return { ok: true };
      }
      case "announce": {
        const msg: ChatMsg = { id: "sys", name: "Corvo Mensageiro", text: clean(text || "").slice(0, CHAT_MAX_LEN), ts: Date.now(), sys: true };
        if (!msg.text) return { ok: false };
        this.broadcast({ t: "chat", m: msg });
        await this.pushChat(msg);
        return { ok: true };
      }
    }
    return { ok: false, error: "unknown action" };
  }

  private async onLive(ws: WebSocket, a: Att, m: any) {
    if (!this.take(ws, "misc")) return;
    const l = await this.getLive();
    const act = String(m.a || "");
    const guest = l.stage.find((g) => g.uid === a.uid);
    // things a stage guest can do for themselves
    if (act === "guest") {
      if (!l.on || !guest) return;
      const session = String(m.session || ""), track = String(m.track || "");
      guest.sfu = SID.test(session) && TNAME.test(track) ? { session, track } : null;
      guest.id = a.id;
      return this.saveLive(l);
    }
    if (act === "leave-stage") {
      if (!guest) return;
      l.stage = l.stage.filter((g) => g !== guest);
      return this.saveLive(l);
    }
    if (!a.admin) return this.send(ws, { t: "err", msg: "Só o Mago controla a live." });

    switch (act) {
      case "start": {
        if (l.on) return this.send(ws, { t: "live", live: livePub(l) });
        const nl: Live = {
          ...LIVE_OFF, on: true, id: crypto.randomUUID().slice(0, 8), startedAt: Date.now(),
          hostId: a.id, hostUid: a.uid, hostName: a.name, pin: l.pin,
        };
        this.forceMicsOff(false);
        await this.saveLive(nl);
        const msg: ChatMsg = { id: "sys", name: "Corvo Mensageiro", text: `🔴 ${a.name} começou a live no Palco! Vem pra plateia ou abre a janela AO VIVO.`, ts: Date.now(), sys: true };
        this.broadcast({ t: "chat", m: msg });
        await this.pushChat(msg);
        return;
      }
      case "end": {
        if (!l.on) return;
        for (const g of l.stage) {
          const t = this.findById(g.id);
          if (t) this.send(t.ws, { t: "stage", on: false });
        }
        await this.saveLive({ ...LIVE_OFF, pin: "" });
        // recording (if the host was recording): close it and start the transcription
        try {
          await this.env.ARCHIVE.get(this.env.ARCHIVE.idFromName("archive")).endLive(l.id, "room");
        } catch {}
        this.broadcast({ t: "sys", text: "A live acabou. A voz por proximidade voltou. Valeu, galera! ✨" });
        return;
      }
      case "takeover": {
        if (!l.on) return;
        l.hostId = a.id;
        l.hostUid = a.uid;
        l.hostName = a.name;
        l.sfu = null;
        return this.saveLive(l);
      }
      case "sfu": {
        if (!l.on || l.hostId !== a.id) return;
        const session = String(m.session || "");
        const tracks: LiveTrack[] = (Array.isArray(m.tracks) ? m.tracks : [])
          .slice(0, 6)
          .filter((t: any) => TNAME.test(String(t?.name)) && ["audio", "video"].includes(t?.kind) && ["cam", "screen", "mic", "sys"].includes(t?.role))
          .map((t: any) => ({ name: String(t.name), kind: t.kind, role: t.role }));
        l.sfu = SID.test(session) && tracks.length ? { session, tracks } : null;
        if (l.sfu && m.switchTo !== false) l.source = "sfu";
        return this.saveLive(l);
      }
      case "embed": {
        if (!l.on) return;
        const url = String(m.url || "").trim();
        if (url && (!/^https:\/\/[^\s"'<>]+$/i.test(url) || url.length > 600)) return this.send(ws, { t: "err", msg: "Link inválido (precisa começar com https://)." });
        l.embed = url;
        l.source = url ? "embed" : "sfu";
        return this.saveLive(l);
      }
      case "source": {
        if (!l.on) return;
        l.source = m.source === "embed" && l.embed ? "embed" : "sfu";
        return this.saveLive(l);
      }
      case "view": {
        if (!l.on || !["camera", "screen", "pip"].includes(m.view)) return;
        l.view = m.view;
        return this.saveLive(l);
      }
      case "stage": {
        if (!l.on) return;
        const t = this.findById(String(m.target || ""));
        if (m.on) {
          if (!t) return this.send(ws, { t: "err", msg: "Essa pessoa saiu do salão." });
          if (l.stage.some((g) => g.uid === t.a.uid)) return;
          if (l.stage.length >= MAX_GUESTS) return this.send(ws, { t: "err", msg: `Palco cheio (máx. ${MAX_GUESTS}). Tira alguém primeiro.` });
          l.stage.push({ uid: t.a.uid, id: t.a.id, name: t.a.name, sfu: null });
          l.hands = l.hands.filter((h) => h.uid !== t.a.uid);
          this.send(t.ws, { t: "stage", on: true });
        } else {
          const id = String(m.target || "");
          const g = l.stage.find((x) => x.id === id);
          if (!g) return;
          l.stage = l.stage.filter((x) => x !== g);
          if (t) this.send(t.ws, { t: "stage", on: false });
        }
        return this.saveLive(l);
      }
      case "hand-drop": {
        l.hands = l.hands.filter((h) => h.id !== String(m.target || ""));
        return this.saveLive(l);
      }
      case "hands-clear": {
        l.hands = [];
        return this.saveLive(l);
      }
      case "pin": {
        l.pin = clean(String(m.text || "")).slice(0, CHAT_MAX_LEN);
        return this.saveLive(l);
      }
      case "muteall":
      case "unmuteall": {
        this.allMuted = act === "muteall";
        await this.ctx.storage.put("allMuted", this.allMuted);
        if (this.allMuted) this.forceMicsOff(true);
        this.broadcast({ t: "allmuted", on: this.allMuted });
        this.broadcast({ t: "sys", text: this.allMuted ? "A moderação fechou os microfones do salão." : "Microfones liberados de novo." });
        return;
      }
    }
  }

  private findByName(name: string) {
    const n = name.toLowerCase();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a && a.name.toLowerCase() === n) return { ws, a };
    }
    return null;
  }

  private gone(ws: WebSocket) {
    const a = this.att(ws);
    this.buckets.delete(ws);
    if (!a) return;
    ws.serializeAttachment(null);
    this.broadcast({ t: "leave", id: a.id });
    // a raised hand leaves with its owner; stage seats and the host survive a reconnect
    const l = this.live;
    if (l && l.on && l.hands.some((h) => h.id === a.id)) {
      l.hands = l.hands.filter((h) => h.id !== a.id);
      this.saveLive(l).catch(() => {});
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.gone(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {}
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }
}
