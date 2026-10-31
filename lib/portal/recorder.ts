/* eslint-disable @typescript-eslint/no-explicit-any */
// Live recording in the host's browser (Lives anteriores).
// - Video: what the viewers see, composed on a 1280x720 canvas (camera / screen / screen + camera bubble) + mixed audio
//   (mic + tab audio + stage guests), recorded as fragmented MP4 (H.264/AAC on Chrome/Edge; WebM fallback).
//   The byte stream is cut at fragment boundaries into ~4 s HLS segments and uploaded right away to R2 through the worker,
//   so a crash loses seconds. A reload / toggle starts a new "part"; the playlist stitches parts.
// - Audio only: standalone ~5 min segments (uploaded in 15 s pieces) for Whisper transcription after the live.
import { REALTIME_URL } from "./net";

type Media = {
  cam: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  mic: MediaStreamTrack | null;
  sys: MediaStreamTrack | null;
  effectiveView(): "camera" | "screen" | "pip";
};

const W = 1280, H = 720, FPS = 30;
const SEG_MIN = 4, SEG_MAX = 10; // seconds per uploaded HLS segment
const VIDEO_TYPES = [
  "video/mp4;codecs=avc1.4d401f,mp4a.40.2",
  "video/mp4;codecs=avc1.42e01f,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1,opus",
  "video/mp4",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm"];

function pick(list: string[]) {
  if (typeof MediaRecorder === "undefined") return "";
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}
export function canRecord() {
  return !!pick(VIDEO_TYPES) && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
}

function adminKey() {
  try {
    const v = localStorage.getItem("pdm.admin");
    return v ? (JSON.parse(v) as string) : "";
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------ fMP4 box reader
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const typ = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
function boxes(b: Uint8Array, from: number, to: number) {
  const out: { type: string; start: number; body: number; end: number }[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    let body = o + 8;
    if (size === 1) {
      if (o + 16 > to) break;
      size = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12);
      body = o + 16;
    } else if (size === 0) size = to - o;
    if (size < 8 || o + size > to) break;
    out.push({ type: typ(b, o + 4), start: o, body, end: o + size });
    o += size;
  }
  return out;
}
const child = (b: Uint8Array, box: { body: number; end: number }, t: string) => boxes(b, box.body, box.end).find((x) => x.type === t);

type TrackInfo = { id: number; timescale: number; defDur: number };
/** Video track id + timescale (+ trex default duration) from the init segment. */
function parseInit(b: Uint8Array): TrackInfo | null {
  const moov = boxes(b, 0, b.length).find((x) => x.type === "moov");
  if (!moov) return null;
  let info: TrackInfo | null = null;
  for (const trak of boxes(b, moov.body, moov.end).filter((x) => x.type === "trak")) {
    const mdia = child(b, trak, "mdia");
    const hdlr = mdia && child(b, mdia, "hdlr");
    if (!mdia || !hdlr || typ(b, hdlr.body + 8) !== "vide") continue;
    const tkhd = child(b, trak, "tkhd");
    const mdhd = child(b, mdia, "mdhd");
    if (!tkhd || !mdhd) continue;
    const v = b[tkhd.body];
    const id = u32(b, tkhd.body + (v === 1 ? 20 : 12));
    const mv = b[mdhd.body];
    const timescale = u32(b, mdhd.body + (mv === 1 ? 20 : 12));
    info = { id, timescale, defDur: 0 };
  }
  const mvex = info && child(b, moov, "mvex");
  if (info && mvex) for (const trex of boxes(b, mvex.body, mvex.end).filter((x) => x.type === "trex")) if (u32(b, trex.body + 4) === info.id) info.defDur = u32(b, trex.body + 12);
  return info;
}
/** Start time, duration (s) and keyframe flag of the video traf of one moof. */
function parseMoof(b: Uint8Array, moof: { body: number; end: number }, vt: TrackInfo) {
  for (const traf of boxes(b, moof.body, moof.end).filter((x) => x.type === "traf")) {
    const tfhd = child(b, traf, "tfhd");
    if (!tfhd || u32(b, tfhd.body + 4) !== vt.id) continue;
    const hf = u32(b, tfhd.body) & 0xffffff;
    let o = tfhd.body + 8;
    if (hf & 0x01) o += 8;
    if (hf & 0x02) o += 4;
    const defDur = hf & 0x08 ? u32(b, o) : vt.defDur;
    if (hf & 0x08) o += 4;
    if (hf & 0x10) o += 4;
    const defFlags = hf & 0x20 ? u32(b, o) : 0;
    const tfdt = child(b, traf, "tfdt");
    let base = 0;
    if (tfdt) base = b[tfdt.body] === 1 ? u32(b, tfdt.body + 4) * 2 ** 32 + u32(b, tfdt.body + 8) : u32(b, tfdt.body + 4);
    let dur = 0, sync = true;
    for (const trun of boxes(b, traf.body, traf.end).filter((x) => x.type === "trun")) {
      const f = u32(b, trun.body) & 0xffffff;
      const n = u32(b, trun.body + 4);
      let p = trun.body + 8;
      if (f & 0x01) p += 4;
      let first: number | null = null;
      if (f & 0x04) (first = u32(b, p)), (p += 4);
      for (let i = 0; i < n; i++) {
        let d = defDur, fl = defFlags;
        if (f & 0x100) (d = u32(b, p)), (p += 4);
        if (f & 0x200) p += 4;
        if (f & 0x400) (fl = u32(b, p)), (p += 4);
        if (f & 0x800) p += 4;
        if (i === 0) {
          const ff = first ?? fl;
          if (dur === 0) sync = ((ff >> 16) & 1) === 0;
        }
        dur += d;
      }
    }
    return { t: base / vt.timescale, d: dur / vt.timescale, sync };
  }
  return null;
}

// ------------------------------------------------------------------ uploader
type Job = { path: string; body: Blob | ArrayBuffer; tries: number };
class Uploader {
  private q: Job[] = [];
  private running = false;
  sent = 0;
  failed = 0;
  lastError = "";
  onChange: () => void = () => {};
  get pending() {
    return this.q.length;
  }
  push(path: string, body: Blob | ArrayBuffer) {
    this.q.push({ path, body, tries: 0 });
    this.run();
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    while (this.q.length) {
      const j = this.q[0];
      try {
        const r = await fetch(`${REALTIME_URL}/lives/rec/${j.path}`, { method: "PUT", headers: { "x-portal-key": adminKey() }, body: j.body });
        if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
        if (!r.ok) this.lastError = `HTTP ${r.status}`; // 4xx: drop (bad request, would never succeed)
        else this.sent += (j.body as Blob).size ?? (j.body as ArrayBuffer).byteLength;
        this.q.shift();
      } catch (e) {
        j.tries++;
        this.failed++;
        this.lastError = (e as Error).message;
        this.onChange();
        await new Promise((res) => setTimeout(res, Math.min(30_000, 1000 * 2 ** Math.min(j.tries, 5))));
        continue;
      }
      this.onChange();
    }
    this.running = false;
  }
  /** Wait until the queue drains (or the timeout). */
  async drain(ms: number) {
    const t0 = Date.now();
    while (this.q.length && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200));
    return this.q.length === 0;
  }
}

async function post(path: string, body?: unknown) {
  const r = await fetch(`${REALTIME_URL}/lives/rec/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-portal-key": adminKey() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// ------------------------------------------------------------------ timer that keeps ticking in a background tab
function ticker(fps: number, fn: () => void) {
  let w: Worker | null = null;
  let url = "";
  try {
    url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0), ${Math.round(1000 / fps)})`], { type: "text/javascript" }));
    w = new Worker(url);
    w.onmessage = fn;
  } catch {
    const t = setInterval(fn, 1000 / fps);
    return () => clearInterval(t);
  }
  return () => {
    w?.terminate();
    URL.revokeObjectURL(url);
  };
}

// ------------------------------------------------------------------ recorder
export class LiveRecorder {
  on = false;
  error = "";
  part = -1;
  startedAt = 0;
  mime = "";
  hidden = false;
  private id = "";
  private room = "";
  private up = new Uploader();
  private stopTick: (() => void) | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private vCam: HTMLVideoElement | null = null;
  private vScr: HTMLVideoElement | null = null;
  private ac: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private srcs = new Map<string, MediaStreamAudioSourceNode>();
  private vrec: MediaRecorder | null = null;
  private arec: MediaRecorder | null = null;
  private aTimer: ReturnType<typeof setTimeout> | null = null;
  private aSeg = 0;
  private aPiece = 0;
  private aStart = 0;
  private buf = new Uint8Array(0);
  private track: TrackInfo | null = null;
  private pend: { bytes: Uint8Array[]; t: number; d: number } = { bytes: [], t: -1, d: 0 };
  private seq = 0;
  private webm = false;
  private chain: Promise<void> = Promise.resolve();
  /** extra audio (stage guests), set by the live layer */
  guestAudio: MediaStreamTrack[] = [];
  /** seconds per audio-only segment (override for tests: localStorage pdm.recSeg) */
  segSec = 300;
  onChange: () => void = () => {};

  constructor(private media: Media) {
    this.up.onChange = () => this.onChange();
  }

  get bytes() {
    return this.up.sent;
  }
  get queue() {
    return this.up.pending;
  }
  get uploadError() {
    return this.up.lastError;
  }

  /** Start (or resume after a reload: the server opens a new part of the same live). */
  async start(liveId: string, room: string) {
    if (this.on || this.starting) return;
    this.starting = true;
    try {
      await this.doStart(liveId, room);
    } finally {
      this.starting = false;
    }
  }
  /** true while start() is in flight (callers poll; avoids opening two parts) */
  starting = false;

  private async doStart(liveId: string, room: string) {
    this.error = "";
    this.mime = pick(VIDEO_TYPES);
    if (!this.mime || !canRecord()) {
      this.error = "Este navegador não grava (use Chrome ou Edge no computador).";
      this.onChange();
      return;
    }
    this.webm = this.mime.startsWith("video/webm");
    try {
      const r = await post(`start?id=${encodeURIComponent(liveId)}`, { room, kind: this.webm ? "webm" : "mp4", mime: this.mime, startedAt: Date.now() });
      this.id = liveId;
      this.room = room;
      this.part = r.part;
      this.hidden = !!r.hidden;
    } catch (e) {
      this.error = "Gravação: " + (e as Error).message;
      this.onChange();
      return;
    }
    try {
      const seg = Number(localStorage.getItem("pdm.recSeg"));
      if (seg >= 20) this.segSec = seg;
    } catch {}
    this.on = true;
    this.startedAt = Date.now();
    this.seq = 0;
    this.buf = new Uint8Array(0);
    this.track = null;
    this.pend = { bytes: [], t: -1, d: 0 };

    // canvas composition
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    this.canvas = c;
    this.ctx2d = c.getContext("2d", { alpha: false });
    const mk = () => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      return v;
    };
    this.vCam = mk();
    this.vScr = mk();
    this.draw();
    this.stopTick = ticker(FPS, () => this.draw());

    // audio mix
    try {
      this.ac = new AudioContext({ sampleRate: 48000 });
      await this.ac.resume().catch(() => {});
      this.dest = this.ac.createMediaStreamDestination();
      this.syncAudio();
    } catch {}

    const vt = (c as any).captureStream(FPS).getVideoTracks()[0] as MediaStreamTrack;
    const stream = new MediaStream([vt, ...(this.dest ? this.dest.stream.getAudioTracks() : [])]);
    const opts: any = { mimeType: this.mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000, videoKeyFrameIntervalDuration: 2000 };
    let vr: MediaRecorder;
    try {
      vr = new MediaRecorder(stream, opts);
    } catch {
      delete opts.videoKeyFrameIntervalDuration;
      vr = new MediaRecorder(stream, opts);
    }
    this.vrec = vr;
    vr.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chain = this.chain.then(() => this.onVideoData(e.data)).catch(() => {});
    };
    vr.onerror = (e: any) => {
      this.error = "Gravação: " + (e?.error?.message || "erro do gravador");
      this.onChange();
    };
    vr.start(1000);
    this.aSeg = 0;
    this.startAudioSeg();
    this.onChange();
  }

  private draw() {
    const g = this.ctx2d;
    if (!g) return;
    if (this.ac) this.syncAudio();
    const m = this.media;
    const view = m.effectiveView();
    const bind = (v: HTMLVideoElement | null, t: MediaStreamTrack | null) => {
      if (!v) return;
      const cur = (v.srcObject as MediaStream | null)?.getVideoTracks()[0] || null;
      if (cur === t) return;
      v.srcObject = t ? new MediaStream([t]) : null;
      if (t) v.play().catch(() => {});
    };
    bind(this.vCam, m.cam && m.cam.readyState === "live" ? m.cam : null);
    bind(this.vScr, m.screen && m.screen.readyState === "live" ? m.screen : null);
    g.fillStyle = "#0b0a12";
    g.fillRect(0, 0, W, H);
    const fit = (v: HTMLVideoElement | null, x: number, y: number, w: number, h: number, cover = false) => {
      if (!v || !v.srcObject || v.videoWidth === 0) return false;
      const s = cover ? Math.max(w / v.videoWidth, h / v.videoHeight) : Math.min(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * s, dh = v.videoHeight * s;
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      g.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      g.restore();
      return true;
    };
    const camOn = !!m.cam && m.cam.enabled;
    if (view === "camera") {
      if (!camOn || !fit(this.vCam, 0, 0, W, H)) this.placeholder(g);
    } else {
      if (!fit(this.vScr, 0, 0, W, H) && !(camOn && fit(this.vCam, 0, 0, W, H))) this.placeholder(g);
      if (view === "pip" && camOn && this.vCam?.videoWidth) {
        const bw = 300, bh = 169, x = W - bw - 24, y = H - bh - 24;
        g.fillStyle = "#000";
        g.fillRect(x - 3, y - 3, bw + 6, bh + 6);
        fit(this.vCam, x, y, bw, bh, true);
      }
    }
  }
  private placeholder(g: CanvasRenderingContext2D) {
    g.fillStyle = "#d9b25a";
    g.font = "bold 40px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("Portal do Mago · ao vivo", W / 2, H / 2);
  }

  /** Keep the mixer in sync with the current mic / tab audio / guests (tracks come and go). */
  private syncAudio() {
    const ac = this.ac, dest = this.dest;
    if (!ac || !dest) return;
    const want = [this.media.mic, this.media.sys, ...this.guestAudio].filter((t): t is MediaStreamTrack => !!t && t.readyState === "live");
    const ids = new Set(want.map((t) => t.id));
    for (const [id, n] of this.srcs) if (!ids.has(id)) (n.disconnect(), this.srcs.delete(id));
    for (const t of want) {
      if (this.srcs.has(t.id)) continue;
      try {
        const n = ac.createMediaStreamSource(new MediaStream([t]));
        n.connect(dest);
        this.srcs.set(t.id, n);
      } catch {}
    }
  }

  // ---------------------------------------------------------------- video chunks -> HLS segments
  private async onVideoData(blob: Blob) {
    if (this.webm) {
      this.up.push(`chunk?id=${this.id}&part=${this.part}&seq=${this.seq++}&d=1`, blob);
      return;
    }
    const add = new Uint8Array(await blob.arrayBuffer());
    const b = new Uint8Array(this.buf.length + add.length);
    b.set(this.buf);
    b.set(add, this.buf.length);
    let used = 0;
    const list = boxes(b, 0, b.length);
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (x.type === "ftyp") continue; // goes out with moov
      if (x.type === "moov") {
        const init = b.slice(0, x.end);
        this.track = parseInit(init);
        this.up.push(`chunk?id=${this.id}&part=${this.part}&seq=init`, init.slice().buffer);
        used = x.end;
        continue;
      }
      if (x.type === "moof") {
        const mdat = list[i + 1];
        if (!mdat) break; // wait for the media data
        const frag = this.track ? parseMoof(b, x, this.track) : null;
        if (frag && frag.sync && this.pend.d >= SEG_MIN) this.flush();
        if (frag && this.pend.t < 0) this.pend.t = frag.t;
        this.pend.bytes.push(b.slice(x.start, mdat.end));
        this.pend.d += frag ? frag.d : 1;
        used = mdat.end;
        i++;
        if (this.pend.d >= SEG_MAX) this.flush();
        continue;
      }
      if (x.type === "mfra") {
        used = x.end;
        continue;
      }
      // styp / sidx / free / anything else: travels with the next fragment
      this.pend.bytes.push(b.slice(x.start, x.end));
      used = x.end;
    }
    this.buf = b.slice(used);
  }

  private flush() {
    if (!this.pend.bytes.length) return;
    const n = this.pend.bytes.reduce((s, x) => s + x.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const x of this.pend.bytes) out.set(x, o), (o += x.length);
    this.up.push(`chunk?id=${this.id}&part=${this.part}&seq=${this.seq++}&t=${Math.max(0, this.pend.t).toFixed(3)}&d=${this.pend.d.toFixed(3)}`, out.buffer);
    this.pend = { bytes: [], t: -1, d: 0 };
  }

  // ---------------------------------------------------------------- audio-only segments (transcription)
  private startAudioSeg() {
    if (!this.on || !this.dest) return;
    const mime = pick(AUDIO_TYPES);
    if (!mime) return;
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(new MediaStream(this.dest.stream.getAudioTracks()), { mimeType: mime, audioBitsPerSecond: 32_000 });
    } catch {
      return;
    }
    const seg = this.aSeg++;
    const offset = (Date.now() - this.startedAt) / 1000;
    let piece = 0;
    this.aStart = Date.now();
    this.aPiece = 0;
    r.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const last = r.state === "inactive";
      const dur = (Date.now() - this.aStart) / 1000;
      this.up.push(
        `audio?id=${this.id}&part=${this.part}&seg=${seg}&piece=${piece++}&offset=${offset.toFixed(2)}&dur=${dur.toFixed(1)}&mime=${encodeURIComponent(mime)}${last ? "&last=1" : ""}`,
        e.data,
      );
    };
    r.onstop = () => {
      if (this.on && this.arec === r) this.startAudioSeg();
    };
    this.arec = r;
    r.start(15_000);
    this.aTimer = setTimeout(() => {
      if (r.state !== "inactive") r.stop(); // onstop opens the next segment
    }, this.segSec * 1000);
  }

  /** Stop this part (toggle off, end of live, devices released). final=true also closes the live for transcription. */
  async stop(final = false, drainMs = 8000) {
    const was = this.on;
    this.on = false;
    if (this.aTimer) clearTimeout(this.aTimer);
    this.aTimer = null;
    const done: Promise<void>[] = [];
    const stopRec = (r: MediaRecorder | null) => {
      if (!r || r.state === "inactive") return;
      done.push(new Promise<void>((res) => {
        const prev = r.onstop;
        r.onstop = (ev) => {
          (prev as any)?.call(r, ev);
          res();
        };
        setTimeout(res, 3000);
      }));
      try {
        r.stop();
      } catch {}
    };
    stopRec(this.vrec);
    stopRec(this.arec);
    await Promise.all(done);
    await this.chain;
    if (!this.webm) this.flush();
    this.stopTick?.();
    this.stopTick = null;
    for (const n of this.srcs.values()) n.disconnect();
    this.srcs.clear();
    this.ac?.close().catch(() => {});
    this.ac = null;
    this.dest = null;
    this.vrec = this.arec = null;
    for (const v of [this.vCam, this.vScr]) if (v) v.srcObject = null;
    this.canvas = null;
    this.ctx2d = null;
    this.onChange();
    if (!this.id || this.part < 0) return;
    await this.up.drain(drainMs);
    const id = this.id, part = this.part;
    if (was) await post(`stop?id=${id}&part=${part}&dur=${((Date.now() - this.startedAt) / 1000).toFixed(1)}`).catch(() => {});
    if (final) await post(`end?id=${id}&part=${part}`).catch(() => {});
    this.onChange();
  }

  elapsed() {
    return this.on ? Date.now() - this.startedAt : 0;
  }
  get roomName() {
    return this.room;
  }
}
