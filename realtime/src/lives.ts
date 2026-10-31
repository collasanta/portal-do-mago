/* eslint-disable @typescript-eslint/no-explicit-any */
import { DurableObject } from "cloudflare:workers";
import { modeForRoom, verifyMemberToken } from "../../lib/portal/authmode";

/**
 * Lives anteriores: recording archive.
 *
 * The host's browser records the composed live (canvas: camera / screen / screen+camera, 1280x720) as fragmented MP4
 * and uploads complete fragments every few seconds; each upload is one HLS segment in R2, so a crash loses seconds.
 * A host reload starts a new "part" (new init segment); the playlist stitches parts with #EXT-X-DISCONTINUITY.
 * Audio-only segments (~5 min, standalone files, uploaded in pieces) feed Workers AI Whisper after the live ends;
 * the transcript is then pushed to the Next app (/api/lives/ingest), which embeds it into the Oráculo.
 *
 * Storage: R2 bucket LIVES (lives/<id>/v/<part>/init.mp4 | <seq>.m4s, lives/<id>/a/<part>/<seg>/<piece>).
 * Metadata: one Durable Object "Archive" (SQLite), alarm-driven transcription with retries.
 */

export interface LivesEnv {
  ARCHIVE: DurableObjectNamespace<Archive>;
  LIVES: R2Bucket;
  AI: Ai;
  /** optional dedicated signing key for playback tokens (falls back to a key derived from existing worker secrets) */
  LIVES_SECRET?: string;
  ROOM_CODE?: string;
  ADMIN_KEY?: string;
  CALLS_APP_SECRET?: string;
  /** Next app base url (ingest callback) */
  NEXT_URL?: string;
  MEMBER_TOKEN_SECRET?: string;
  AUTH_MODE?: string;
  KIWIFY_ONLY_ROOMS?: string;
  BOTH_ROOMS?: string;
}

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const ID = /^[A-Za-z0-9_-]{4,40}$/;
const MAX_CHUNK = 25 * 1024 * 1024;
const MAX_TRIES = 3;
/** a recording with no upload for this long is closed automatically (host vanished without "Encerrar") */
const STALE_MS = 3 * 3600_000;

export type LiveRow = {
  id: string; room: string; title: string; started_at: number; ended_at: number; hidden: number; status: string;
  tstatus: string; istatus: string; ierr: string; lesson_n: number | null; bytes: number; duration: number; kind: string; last_at: number;
  iattempts: number;
};

const enc = new TextEncoder();
function b64url(buf: ArrayBuffer) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
/** Worker-only signing key: never leaves the worker (no secret shared with the Next app). */
function signKey(env: LivesEnv) {
  const base = env.LIVES_SECRET || env.CALLS_APP_SECRET || env.ADMIN_KEY || "";
  return base.length >= 16 ? `lives-token-v1:${base}` : "";
}
/** Playback token "<exp>.<sig>", sig = HMAC(worker key, "v1:<id>:<exp>"), minted by POST /lives/<id>/token. */
async function mintToken(env: LivesEnv, id: string, ttlS = 8 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  return `${exp}.${await hmac(signKey(env), `v1:${id}:${exp}`)}`;
}
export async function checkToken(env: LivesEnv, id: string, tok: string | null) {
  const k = signKey(env);
  if (!k || !tok) return false;
  const [exp, sig] = tok.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now() / 1000)) return false;
  const want = await hmac(k, `v1:${id}:${exp}`);
  if (want.length !== sig.length) return false;
  let d = 0;
  for (let i = 0; i < sig.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
/** Same gate as the live itself: the room code (x-room-code), when the worker has one. */
/** Same gate as entering the live's room: room code and/or an active-member token (m1.…), per the room's entry mode. */
async function viewerOk(env: LivesEnv, req: Request, room: string) {
  const raw = (req.headers.get("x-room-code") || "").trim();
  const mode = modeForRoom(room, env);
  if (raw.startsWith("m1.")) return mode !== "code" && !!(await verifyMemberToken(env.MEMBER_TOKEN_SECRET, raw));
  if (mode === "kiwify") return false;
  return !env.ROOM_CODE || raw.toLowerCase() === env.ROOM_CODE.toLowerCase();
}

type Json = (data: unknown, status?: number) => Response;

/**
 * HTTP routes under /lives/*.
 * role(): resolves the x-portal-key header (host/admin keys from ADMIN_KEYS) — same keys as the room.
 */
export async function handleLives(
  req: Request,
  env: LivesEnv,
  url: URL,
  role: (key: unknown) => { role: string; who: string },
  json: Json,
  cors: Record<string, string>,
): Promise<Response> {
  const arch = env.ARCHIVE.get(env.ARCHIVE.idFromName("archive"));
  const p = url.pathname.split("/").filter(Boolean); // ["lives", ...]
  const key = req.headers.get("x-portal-key") || "";
  const r = role(key);
  const isHost = r.role === "host" || r.role === "admin";
  const isAdmin = isHost; // the Mago (host) also manages his recordings

  // ------------------------------------------------------------ recording (host browser)
  if (p[1] === "rec") {
    if (!isHost) return json({ error: "forbidden" }, 403);
    const id = url.searchParams.get("id") || "";
    if (!ID.test(id)) return json({ error: "bad id" }, 400);
    const part = Math.floor(Number(url.searchParams.get("part")));
    if (p[2] === "start" && req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as any;
      const room = String(b.room || "salao").replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "salao";
      const kind = b.kind === "webm" ? "webm" : "mp4";
      return json(await arch.startPart(id, room, kind, String(b.mime || "").slice(0, 120), r.who, Number(b.startedAt) || Date.now()));
    }
    if (!(part >= 0 && part < 1000)) return json({ error: "bad part" }, 400);
    if (p[2] === "chunk" && req.method === "PUT") {
      const seq = url.searchParams.get("seq") || "";
      const isInit = seq === "init";
      const n = Math.floor(Number(seq));
      if (!isInit && !(n >= 0 && n < 1e6)) return json({ error: "bad seq" }, 400);
      const len = Number(req.headers.get("content-length") || 0);
      if (len > MAX_CHUNK) return json({ error: "too big" }, 413);
      const st = await arch.partInfo(id, part);
      if (!st) return json({ error: "unknown part" }, 404);
      const body = await req.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_CHUNK) return json({ error: "bad body" }, 400);
      const ext = st.kind === "webm" ? "webm" : "m4s";
      await env.LIVES.put(`lives/${id}/v/${part}/${isInit ? "init.mp4" : `${n}.${ext}`}`, body, {
        httpMetadata: { contentType: isInit ? "video/mp4" : st.kind === "webm" ? "video/webm" : "video/iso.segment" },
      });
      const t = Number(url.searchParams.get("t")), d = Number(url.searchParams.get("d"));
      await arch.addChunk(id, part, isInit ? -1 : n, Number.isFinite(t) ? t : -1, Number.isFinite(d) && d > 0 && d < 120 ? d : 0, body.byteLength);
      return json({ ok: true });
    }
    if (p[2] === "audio" && req.method === "PUT") {
      const seg = Math.floor(Number(url.searchParams.get("seg")));
      const piece = Math.floor(Number(url.searchParams.get("piece")));
      if (!(seg >= 0 && seg < 10000 && piece >= 0 && piece < 10000)) return json({ error: "bad seg" }, 400);
      const st = await arch.partInfo(id, part);
      if (!st) return json({ error: "unknown part" }, 404);
      const body = await req.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_CHUNK) return json({ error: "bad body" }, 400);
      await env.LIVES.put(`lives/${id}/a/${part}/${seg}/${piece}`, body);
      const off = Number(url.searchParams.get("offset")) || 0;
      const dur = Number(url.searchParams.get("dur")) || 0;
      const last = url.searchParams.get("last") === "1";
      await arch.addAudio(id, part, seg, piece, off, dur, body.byteLength, String(url.searchParams.get("mime") || "").slice(0, 80), last);
      return json({ ok: true });
    }
    if (p[2] === "stop" && req.method === "POST") {
      const d = Number(url.searchParams.get("dur")) || 0;
      await arch.closePart(id, part, d);
      return json({ ok: true });
    }
    if (p[2] === "end" && req.method === "POST") {
      await arch.endLive(id, "host");
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  // ------------------------------------------------------------ list (metadata only; hidden ones need a host/admin key)
  if (p.length === 2 && p[1] === "list" && req.method === "GET") {
    const all = isAdmin && url.searchParams.get("all") === "1";
    return json({ lives: await arch.list(all) });
  }

  const id = p[1] || "";
  if (!ID.test(id)) return json({ error: "not found" }, 404);

  // ------------------------------------------------------------ admin actions
  if (p[2] === "admin" && req.method === "POST") {
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const b = (await req.json().catch(() => ({}))) as any;
    return json(await arch.admin(id, String(b.action || ""), b));
  }

  if (p[2] === "meta" && req.method === "GET") {
    const m = await arch.meta(id);
    if (!m || (m.hidden && !isAdmin)) return json({ error: "not found" }, 404);
    return json(m);
  }
  // playback token: room code (same gate as the live) or a host/admin key; hidden lives only for admins
  if (p[2] === "token" && req.method === "POST") {
    const m = await arch.meta(id);
    if (!m || (m.hidden && !isAdmin)) return json({ error: "not found" }, 404);
    if (!isAdmin && !(await viewerOk(env, req, m.room))) return json({ error: modeForRoom(m.room, env) === "kiwify" ? "member" : "code" }, 403);
    return json({ tok: await mintToken(env, id) });
  }
  // Next app ingest: the worker calls /api/lives/ingest with a one-time job nonce; the app checks it here and reads the transcript
  if (p[2] === "job" && req.method === "GET") {
    return json(await arch.checkJob(id, url.searchParams.get("nonce") || ""));
  }
  if (p[2] === "transcript" && req.method === "GET") {
    const job = await arch.checkJob(id, url.searchParams.get("nonce") || "");
    if (!job.ok && !isAdmin) return json({ error: "forbidden" }, 403);
    const t = await arch.transcript(id);
    return t ? json(t) : json({ error: "not found" }, 404);
  }

  // ------------------------------------------------------------ playback (signed token from the Next app)
  const tok = url.searchParams.get("tok");
  if (!(await checkToken(env, id, tok))) return new Response("forbidden", { status: 403, headers: cors });
  if (p[2] === "index.m3u8") {
    const pl = await arch.playlist(id, tok!);
    if (!pl) return new Response("not found", { status: 404, headers: cors });
    return new Response(pl.text, {
      headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": pl.live ? "no-store" : "private, max-age=60", ...cors },
    });
  }
  if (p[2] === "v" && p.length === 5 && /^\d{1,3}$/.test(p[3]) && /^(init\.mp4|\d{1,6}\.(m4s|webm)|full\.webm)$/.test(p[4])) {
    if (p[4] === "full.webm") return fullWebm(env, arch, id, Number(p[3]), cors);
    return serveObject(req, env, `lives/${id}/v/${p[3]}/${p[4]}`, cors);
  }
  return new Response("not found", { status: 404, headers: cors });
}

/** R2 object with Range support (206 / 416), long cache (segments never change). */
async function serveObject(req: Request, env: LivesEnv, key: string, cors: Record<string, string>) {
  const range = req.headers.get("range");
  let obj: R2ObjectBody | R2Object | null;
  if (range) {
    const head = await env.LIVES.head(key);
    if (!head) return new Response("not found", { status: 404, headers: cors });
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    const size = head.size;
    let start = 0, end = size - 1;
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(size - 1, Number(m[2]));
      } else start = Math.max(0, size - Number(m[2]));
    }
    if (!m || start > end || start >= size)
      return new Response("range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}`, ...cors } });
    obj = await env.LIVES.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!obj || !("body" in obj)) return new Response("not found", { status: 404, headers: cors });
    return new Response(obj.body, {
      status: 206,
      headers: {
        "content-type": head.httpMetadata?.contentType || "application/octet-stream",
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=86400",
        ...cors,
      },
    });
  }
  obj = await env.LIVES.get(key);
  if (!obj || !("body" in obj)) return new Response("not found", { status: 404, headers: cors });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
      "content-length": String(obj.size),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=86400",
      ...cors,
    },
  });
}

/** WebM fallback (browser without MP4 recording): one part = its chunks streamed back to back (no seeking). */
async function fullWebm(env: LivesEnv, arch: DurableObjectStub<Archive>, id: string, part: number, cors: Record<string, string>) {
  const seqs = await arch.chunkSeqs(id, part);
  const { readable, writable } = new TransformStream();
  (async () => {
    const w = writable.getWriter();
    try {
      for (const s of seqs) {
        const o = await env.LIVES.get(`lives/${id}/v/${part}/${s}.webm`);
        if (o) await w.write(new Uint8Array(await o.arrayBuffer()));
      }
    } finally {
      await w.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { "content-type": "video/webm", "cache-control": "private, max-age=60", ...cors } });
}

// =================================================================== Durable Object
export class Archive extends DurableObject<LivesEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: LivesEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      create table if not exists lives (
        id text primary key, room text not null, title text not null, started_at integer not null, ended_at integer not null default 0,
        hidden integer not null default 0, status text not null default 'recording', kind text not null default 'mp4',
        tstatus text not null default 'none', istatus text not null default 'none', ierr text not null default '',
        iattempts integer not null default 0, lesson_n integer, bytes integer not null default 0, last_at integer not null default 0,
        who text not null default '', job_nonce text not null default '', job_action text not null default '', job_exp integer not null default 0
      );
      create table if not exists parts (
        live_id text not null, part integer not null, kind text not null, mime text not null default '', started_at integer not null,
        wall_dur real not null default 0, has_init integer not null default 0, closed integer not null default 0,
        primary key (live_id, part)
      );
      create table if not exists chunks (
        live_id text not null, part integer not null, seq integer not null, t real not null, d real not null, bytes integer not null,
        primary key (live_id, part, seq)
      );
      create table if not exists asegs (
        live_id text not null, part integer not null, seg integer not null, offset real not null, dur real not null default 0,
        pieces integer not null default 0, bytes integer not null default 0, mime text not null default '', complete integer not null default 0,
        status text not null default 'rec', attempts integer not null default 0, err text not null default '', result text,
        primary key (live_id, part, seg)
      );
    `);
  }

  private one<T>(q: string, ...b: unknown[]): T | null {
    const rows = this.sql.exec(q, ...b).toArray() as T[];
    return rows[0] ?? null;
  }
  private all<T>(q: string, ...b: unknown[]): T[] {
    return this.sql.exec(q, ...b).toArray() as T[];
  }

  // ------------------------------------------------------------ recording
  async startPart(id: string, room: string, kind: string, mime: string, who: string, startedAt: number) {
    let l = this.one<LiveRow>("select * from lives where id=?", id);
    if (!l) {
      const d = new Date(startedAt - 3 * 3600_000); // America/Sao_Paulo (no DST)
      const title = `Live ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      // rehearsal rooms start hidden: they never reach the list or the Oráculo unless an admin publishes them
      this.sql.exec(
        "insert into lives (id, room, title, started_at, hidden, kind, last_at, who) values (?,?,?,?,?,?,?,?)",
        id, room, title, Date.now(), room === "salao" ? 0 : 1, kind, Date.now(), who,
      );
      l = this.one<LiveRow>("select * from lives where id=?", id)!;
    } else if (l.status !== "recording") {
      // host came back after the live was closed by the archive (should not happen): reopen
      this.sql.exec("update lives set status='recording', tstatus='none' where id=?", id);
    }
    // the previous part of this live ended without "stop" (reload / crash): close it with what it has
    this.sql.exec("update parts set closed=1 where live_id=? and closed=0", id);
    const n = (this.one<{ n: number }>("select coalesce(max(part)+1, 0) n from parts where live_id=?", id)?.n ?? 0) as number;
    this.sql.exec("insert into parts (live_id, part, kind, mime, started_at) values (?,?,?,?,?)", id, n, kind, mime, Date.now());
    this.sql.exec("update lives set last_at=? where id=?", Date.now(), id);
    await this.ensureAlarm(30 * 60_000);
    return { id, part: n, hidden: !!l.hidden };
  }

  async partInfo(id: string, part: number) {
    return this.one<{ kind: string; closed: number }>("select kind, closed from parts where live_id=? and part=?", id, part);
  }

  async addChunk(id: string, part: number, seq: number, t: number, d: number, bytes: number) {
    if (seq < 0) this.sql.exec("update parts set has_init=1 where live_id=? and part=?", id, part);
    else
      this.sql.exec(
        "insert into chunks (live_id, part, seq, t, d, bytes) values (?,?,?,?,?,?) on conflict do update set t=excluded.t, d=excluded.d, bytes=excluded.bytes",
        id, part, seq, t, d, bytes,
      );
    this.sql.exec("update lives set bytes=bytes+?, last_at=? where id=?", bytes, Date.now(), id);
  }

  async addAudio(id: string, part: number, seg: number, piece: number, offset: number, dur: number, bytes: number, mime: string, last: boolean) {
    this.sql.exec(
      `insert into asegs (live_id, part, seg, offset, dur, pieces, bytes, mime, complete) values (?,?,?,?,?,?,?,?,?)
       on conflict do update set pieces=max(pieces, excluded.pieces), bytes=bytes+excluded.bytes, dur=max(dur, excluded.dur),
         complete=max(complete, excluded.complete), mime=excluded.mime`,
      id, part, seg, offset, dur, piece + 1, bytes, mime, last ? 1 : 0,
    );
    this.sql.exec("update lives set bytes=bytes+?, last_at=? where id=?", bytes, Date.now(), id);
  }

  async closePart(id: string, part: number, wallDur: number) {
    this.sql.exec("update parts set closed=1, wall_dur=max(wall_dur, ?) where live_id=? and part=?", wallDur, id, part);
  }

  async chunkSeqs(id: string, part: number) {
    return this.all<{ seq: number }>("select seq from chunks where live_id=? and part=? order by seq", id, part).map((r) => r.seq);
  }

  /** Live ended (host clicked "Encerrar", or the room DO saw the live end): transcribe in a few seconds. */
  async endLive(id: string, _by: string) {
    const l = this.one<LiveRow>("select * from lives where id=?", id);
    if (!l) return { ok: false };
    if (l.status === "recording") {
      this.sql.exec("update lives set status='ended', ended_at=?, tstatus='pending' where id=?", Date.now(), id);
      this.sql.exec("update parts set closed=1 where live_id=?", id);
      // give in-flight uploads (last fragments, last audio pieces) time to land
      await this.ctx.storage.setAlarm(Date.now() + 20_000);
    }
    return { ok: true };
  }

  // ------------------------------------------------------------ reading
  private parts(id: string) {
    const parts = this.all<{ part: number; kind: string; wall_dur: number; has_init: number; started_at: number }>(
      "select part, kind, wall_dur, has_init, started_at from parts where live_id=? order by part", id);
    const sums = new Map(
      this.all<{ part: number; d: number; n: number; mx: number }>(
        "select part, sum(d) d, count(*) n, max(t + d) mx from chunks where live_id=? group by part", id).map((r) => [r.part, r]),
    );
    let off = 0;
    return parts.map((p) => {
      const s = sums.get(p.part);
      const dur = s && s.d > 0 ? s.d : p.wall_dur;
      const o = { ...p, offset: off, duration: dur, chunks: s?.n || 0 };
      off += dur;
      return o;
    });
  }

  private pub(l: LiveRow) {
    const parts = this.parts(l.id);
    const duration = parts.reduce((s, p) => s + p.duration, 0);
    const a = this.one<{ n: number; done: number; err: number }>(
      "select count(*) n, sum(status='done' or status='empty') done, sum(status='error') err from asegs where live_id=?", l.id);
    return {
      id: l.id, room: l.room, title: l.title, startedAt: l.started_at, endedAt: l.ended_at, hidden: !!l.hidden, status: l.status, kind: l.kind,
      duration: Math.round(duration), bytes: l.bytes, parts: parts.length,
      transcript: { status: l.tstatus, segments: a?.n || 0, done: a?.done || 0, errors: a?.err || 0 },
      ingest: { status: l.istatus, error: l.ierr, lesson: l.lesson_n },
    };
  }

  async list(all: boolean) {
    const rows = this.all<LiveRow>(`select * from lives ${all ? "" : "where hidden=0"} order by started_at desc limit 500`);
    return rows.map((l) => this.pub(l));
  }

  async meta(id: string) {
    const l = this.one<LiveRow>("select * from lives where id=?", id);
    if (!l) return null;
    return { ...this.pub(l), partsInfo: this.parts(id).map((p) => ({ part: p.part, offset: p.offset, duration: p.duration, kind: p.kind })) };
  }

  async playlist(id: string, tok: string) {
    const l = this.one<LiveRow>("select * from lives where id=?", id);
    if (!l) return null;
    const q = `?tok=${encodeURIComponent(tok)}`;
    const lines: string[] = [];
    let target = 1;
    let first = true;
    for (const p of this.parts(id)) {
      if (p.kind !== "mp4" || !p.has_init) continue;
      const ch = this.all<{ seq: number; d: number }>("select seq, d from chunks where live_id=? and part=? order by seq", id, p.part);
      if (!ch.length) continue;
      if (!first) lines.push("#EXT-X-DISCONTINUITY");
      first = false;
      lines.push(`#EXT-X-MAP:URI="v/${p.part}/init.mp4${q}"`);
      for (const c of ch) {
        const d = c.d > 0 ? c.d : 4;
        target = Math.max(target, Math.ceil(d));
        lines.push(`#EXTINF:${d.toFixed(3)},`, `v/${p.part}/${c.seq}.m4s${q}`);
      }
    }
    const live = l.status === "recording";
    const head = ["#EXTM3U", "#EXT-X-VERSION:7", `#EXT-X-TARGETDURATION:${target}`, "#EXT-X-MEDIA-SEQUENCE:0", `#EXT-X-PLAYLIST-TYPE:${live ? "EVENT" : "VOD"}`];
    return { text: [...head, ...lines, ...(live ? [] : ["#EXT-X-ENDLIST"]), ""].join("\n"), live };
  }

  /** Whisper segments on the stitched timeline (part offset + audio segment offset + segment time). */
  async transcript(id: string) {
    const l = this.one<LiveRow>("select * from lives where id=?", id);
    if (!l) return null;
    const off = new Map(this.parts(id).map((p) => [p.part, p.offset]));
    const segs: { start: number; end: number; text: string }[] = [];
    for (const a of this.all<{ part: number; seg: number; offset: number; result: string | null }>(
      "select part, seg, offset, result from asegs where live_id=? and status='done' order by part, seg", id)) {
      const base = (off.get(a.part) || 0) + a.offset;
      let r: any;
      try {
        r = JSON.parse(a.result || "null");
      } catch {}
      for (const s of r?.segments || []) {
        const text = String(s.text || "").trim();
        if (!text) continue;
        segs.push({ start: +(base + Number(s.start || 0)).toFixed(2), end: +(base + Number(s.end || 0)).toFixed(2), text });
      }
    }
    return { ...this.pub(l), segments: segs };
  }

  // ------------------------------------------------------------ admin
  async admin(id: string, action: string, b: any) {
    const l = this.one<LiveRow>("select * from lives where id=?", id);
    if (!l) return { ok: false, error: "not found" };
    switch (action) {
      case "rename": {
        const t = String(b.title || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
        if (!t) return { ok: false, error: "título vazio" };
        this.sql.exec("update lives set title=? where id=?", t, id);
        // keep the Oráculo's lesson title in sync
        if (l.istatus === "done") this.queueIngest(id);
        break;
      }
      case "hide":
        this.sql.exec("update lives set hidden=1 where id=?", id);
        if (l.lesson_n != null || l.istatus === "done") await this.removeFromOraculo(id);
        break;
      case "unhide":
        this.sql.exec("update lives set hidden=0 where id=?", id);
        if (l.tstatus === "done") this.queueIngest(id);
        break;
      case "reprocess":
        if (l.status === "recording") return { ok: false, error: "a live ainda está gravando" };
        // failed / missing transcription segments get another round, then re-ingest
        this.sql.exec("update asegs set status='ready', attempts=0, err='' where live_id=? and status='error'", id);
        if (b.retranscribe) this.sql.exec("update asegs set status='ready', attempts=0, err='', result=null where live_id=?", id);
        this.sql.exec("update lives set tstatus='pending', istatus='none', ierr='', iattempts=0 where id=?", id);
        await this.ctx.storage.setAlarm(Date.now() + 500);
        break;
      case "end":
        await this.endLive(id, "admin");
        break;
      case "delete": {
        await this.removeFromOraculo(id).catch(() => {});
        let cursor: string | undefined;
        do {
          const ls = await this.env.LIVES.list({ prefix: `lives/${id}/`, cursor, limit: 1000 });
          if (ls.objects.length) await this.env.LIVES.delete(ls.objects.map((o) => o.key));
          cursor = ls.truncated ? ls.cursor : undefined;
        } while (cursor);
        for (const t of ["chunks", "asegs", "parts"]) this.sql.exec(`delete from ${t} where live_id=?`, id);
        this.sql.exec("delete from lives where id=?", id);
        return { ok: true, deleted: true };
      }
      default:
        return { ok: false, error: "unknown action" };
    }
    return { ok: true, live: await this.meta(id) };
  }

  private queueIngest(id: string) {
    this.sql.exec("update lives set istatus='pending', iattempts=0, ierr='' where id=?", id);
    this.ctx.storage.setAlarm(Date.now() + 500);
  }

  /** One-time job proof for the Next app (no shared secret): valid while the callback runs. */
  async checkJob(id: string, nonce: string) {
    const l = this.one<LiveRow & { job_nonce: string; job_action: string; job_exp: number }>("select * from lives where id=?", id);
    if (!l || !nonce || nonce.length < 20 || l.job_nonce !== nonce || l.job_exp < Date.now()) return { ok: false as const };
    return { ok: true as const, action: l.job_action };
  }

  private async callNext(body: { id: string; action: string }) {
    const base = (this.env.NEXT_URL || "http://localhost:3000").replace(/\/$/, "");
    const nonce = crypto.randomUUID() + crypto.randomUUID();
    this.sql.exec("update lives set job_nonce=?, job_action=?, job_exp=? where id=?", nonce, body.action, Date.now() + 15 * 60_000, body.id);
    let r: Response;
    try {
      r = await fetch(`${base}/api/lives/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, nonce }),
      });
    } finally {
      // keep the nonce only while the request is in flight
      this.sql.exec("update lives set job_nonce='', job_exp=0 where id=? and job_nonce=?", body.id, nonce);
    }
    const d = (await r.json().catch(() => ({}))) as any;
    if (!r.ok || !d.ok) throw new Error(d.error || `ingest HTTP ${r.status}`);
    return d;
  }

  private async removeFromOraculo(id: string) {
    await this.callNext({ id, action: "remove" });
    this.sql.exec("update lives set istatus='none', lesson_n=null where id=?", id);
  }

  // ------------------------------------------------------------ alarm: transcription + ingest + stale recordings
  private async ensureAlarm(ms: number) {
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur > Date.now() + ms) await this.ctx.storage.setAlarm(Date.now() + ms);
  }

  async alarm() {
    const t0 = Date.now();
    // 1) recordings whose host vanished
    for (const l of this.all<LiveRow>("select * from lives where status='recording' and last_at < ?", Date.now() - STALE_MS)) await this.endLive(l.id, "stale");

    // 2) transcription, one audio segment at a time, within ~10 min of wall time per alarm
    let more = false;
    for (const l of this.all<LiveRow>("select * from lives where tstatus in ('pending','running') order by started_at")) {
      this.sql.exec("update lives set tstatus='running' where id=?", l.id);
      for (;;) {
        if (Date.now() - t0 > 9 * 60_000) {
          more = true;
          break;
        }
        const a = this.one<{ part: number; seg: number; pieces: number; attempts: number; mime: string }>(
          `select part, seg, pieces, attempts, mime from asegs where live_id=? and status in ('rec','ready') and attempts < ? order by part, seg limit 1`,
          l.id, MAX_TRIES);
        if (!a) break;
        await this.transcribeOne(l.id, a);
      }
      if (more) break;
      const left = this.one<{ n: number }>("select count(*) n from asegs where live_id=? and status in ('rec','ready') and attempts < ?", l.id, MAX_TRIES);
      if (!left?.n) {
        this.sql.exec("update asegs set status='error' where live_id=? and status in ('rec','ready')", l.id);
        const cur = this.one<LiveRow>("select * from lives where id=?", l.id)!;
        this.sql.exec("update lives set tstatus='done', istatus=? where id=?", cur.hidden ? "skipped" : "pending", l.id);
      }
    }

    // 3) ingest into the Oráculo (Next app embeds with e5-small)
    for (const l of this.all<LiveRow>("select * from lives where istatus='pending' and hidden=0 and tstatus='done'")) {
      try {
        const d = await this.callNext({ id: l.id, action: "ingest" });
        this.sql.exec("update lives set istatus='done', ierr='', lesson_n=? where id=?", d.lesson ?? null, l.id);
      } catch (e) {
        const n = l.iattempts + 1;
        this.sql.exec("update lives set iattempts=?, ierr=?, istatus=? where id=?", n, String((e as Error).message).slice(0, 300), n >= 5 ? "error" : "pending", l.id);
        if (n < 5) more = true;
      }
    }

    if (more) await this.ctx.storage.setAlarm(Date.now() + (this.one("select 1 from lives where istatus='pending' and iattempts>0") ? 60_000 : 1000));
    else if (this.one("select 1 from lives where status='recording'")) await this.ctx.storage.setAlarm(Date.now() + 30 * 60_000);
  }

  private async transcribeOne(id: string, a: { part: number; seg: number; pieces: number; attempts: number; mime: string }) {
    try {
      const bufs: Uint8Array[] = [];
      for (let i = 0; i < a.pieces; i++) {
        const o = await this.env.LIVES.get(`lives/${id}/a/${a.part}/${a.seg}/${i}`);
        if (o) bufs.push(new Uint8Array(await o.arrayBuffer()));
        else if (i === 0) break; // without the first piece (headers) the file is undecodable
      }
      const total = bufs.reduce((s, b) => s + b.byteLength, 0);
      if (total < 2000) {
        this.sql.exec("update asegs set status='empty' where live_id=? and part=? and seg=?", id, a.part, a.seg);
        return;
      }
      const all = new Uint8Array(total);
      let o = 0;
      for (const b of bufs) {
        all.set(b, o);
        o += b.byteLength;
      }
      let bin = "";
      for (let i = 0; i < all.length; i += 0x8000) bin += String.fromCharCode(...all.subarray(i, i + 0x8000));
      const r: any = await this.env.AI.run(WHISPER as any, { audio: btoa(bin), language: "pt", task: "transcribe", vad_filter: true } as any);
      const segments = (r?.segments || []).map((s: any) => ({ start: s.start, end: s.end, text: s.text }));
      this.sql.exec(
        "update asegs set status=?, result=?, err='' where live_id=? and part=? and seg=?",
        segments.length ? "done" : "empty", JSON.stringify({ segments, text: r?.text || "" }), id, a.part, a.seg,
      );
    } catch (e) {
      const n = a.attempts + 1;
      this.sql.exec(
        "update asegs set attempts=?, err=?, status=? where live_id=? and part=? and seg=?",
        n, String((e as Error).message || e).slice(0, 300), n >= MAX_TRIES ? "error" : "ready", id, a.part, a.seg,
      );
    }
  }
}
