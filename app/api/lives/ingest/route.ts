import crypto from "node:crypto";
import { pool } from "@/lib/oraculo/db";
import { embedPassages } from "@/lib/oraculo/embedder.mjs";
import { cleanSegments, chunkSegments, liveLabel } from "@/lib/lives/chunk";

// Called by the realtime worker (Archive DO) after a live is transcribed, or when it is hidden/deleted.
// No shared secret: the worker hands a one-time nonce, which we check back against the worker itself.
export const maxDuration = 300;

const WORKER = (process.env.PORTAL_WORKER_URL || process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:8787").replace(/\/$/, "");
const FIRST_N = 1001; // Kiwify lessons are 1..999; portal lives live above
const MODULE = "Lives do Portal";

type Transcript = { id: string; title: string; startedAt: number; duration: number; segments: { start: number; end: number; text: string }[] };

const out = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(req: Request) {
  let b: { id?: string; action?: string; nonce?: string };
  try {
    b = await req.json();
  } catch {
    return out({ ok: false, error: "bad json" }, 400);
  }
  const id = String(b.id || "");
  const nonce = String(b.nonce || "");
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id) || nonce.length < 20) return out({ ok: false, error: "bad request" }, 400);
  const enc = encodeURIComponent;
  const job = await fetch(`${WORKER}/lives/${enc(id)}/job?nonce=${enc(nonce)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  if (!job?.ok || job.action !== b.action) return out({ ok: false, error: "forbidden" }, 403);

  if (b.action === "remove") {
    const r = await pool.query<{ lesson_n: number }>("select lesson_n from curso.portal_lives where live_id=$1", [id]);
    if (r.rows[0]) await pool.query("delete from curso.lessons where n=$1 and n >= $2", [r.rows[0].lesson_n, FIRST_N]); // cascades
    await pool.query("delete from curso.portal_lives where live_id=$1", [id]);
    return out({ ok: true });
  }
  if (b.action !== "ingest") return out({ ok: false, error: "unknown action" }, 400);

  const t: Transcript | null = await fetch(`${WORKER}/lives/${enc(id)}/transcript?nonce=${enc(nonce)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!t) return out({ ok: false, error: "transcript unavailable" }, 502);
  const { segs } = cleanSegments(t.segments || []);
  if (!segs.length) return out({ ok: false, error: "empty transcript" }, 422);
  const chunks = chunkSegments(segs);
  const started = new Date(Number(t.startedAt) || Date.now());
  const label = liveLabel(started);
  const title = t.title.startsWith(label) ? t.title : `${label} – ${t.title}`;

  // embed first (slow, outside any transaction)
  const vecs = await embedPassages(chunks.map((ch) => `${title}\n${ch.text}`), 16);

  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('portal_lives'))");
    const ex = await c.query<{ lesson_n: number }>("select lesson_n from curso.portal_lives where live_id=$1", [id]);
    let n = ex.rows[0]?.lesson_n;
    if (!n) {
      const m = await c.query<{ n: number }>("select greatest($1, coalesce(max(n)+1, $1))::int n from curso.lessons where n >= $1", [FIRST_N]);
      n = m.rows[0].n;
    }
    await c.query(
      `insert into curso.lessons (n, module, title, duration, course, kiwify_path) values ($1,$2,$3,$4,'grimorio',null)
       on conflict (n) do update set module=excluded.module, title=excluded.title, duration=excluded.duration, updated_at=now()`,
      [n, MODULE, title, Math.round(t.duration || segs[segs.length - 1].end)]);
    await c.query("delete from curso.segments where lesson_n=$1", [n]);
    await c.query("delete from curso.chunks where lesson_n=$1", [n]);
    for (let s = 0; s < segs.length; s += 500) {
      const part = segs.slice(s, s + 500);
      const vals: string[] = [], p: unknown[] = [];
      part.forEach((x, k) => {
        const o = p.length;
        vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5})`);
        p.push(n, s + k, x.start, x.end, x.text);
      });
      await c.query(`insert into curso.segments (lesson_n, idx, start_s, end_s, text) values ${vals.join(",")}`, p);
    }
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const hash = crypto.createHash("sha1").update(`${ch.start_s}|${ch.text}`).digest("hex");
      await c.query(
        `insert into curso.chunks (lesson_n, seg_from, seg_to, start_s, end_s, text, text_hash, embedding)
         values ($1,$2,$3,$4,$5,$6,$7,$8::extensions.vector)`,
        [n, ch.seg_from, ch.seg_to, ch.start_s, ch.end_s, ch.text, hash, `[${vecs[i].join(",")}]`]);
    }
    await c.query(
      `insert into curso.portal_lives (live_id, lesson_n, title, started_at, duration) values ($1,$2,$3,$4,$5)
       on conflict (live_id) do update set lesson_n=excluded.lesson_n, title=excluded.title, started_at=excluded.started_at,
         duration=excluded.duration, updated_at=now()`,
      [id, n, t.title, started.toISOString(), t.duration || 0]);
    await c.query("commit");
    return out({ ok: true, lesson: n, segments: segs.length, chunks: chunks.length });
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return out({ ok: false, error: String((e as Error).message || e).slice(0, 200) }, 500);
  } finally {
    c.release();
  }
}
