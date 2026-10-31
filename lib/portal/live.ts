/* eslint-disable @typescript-eslint/no-explicit-any */
// Live broadcasting through Cloudflare Realtime SFU (Calls).
// The host pushes up to 4 tracks (camera, screen, mic, tab/system audio) into ONE SFU session; every viewer
// opens its own pull session, so 300 viewers are served by Cloudflare, not by the host's upload.
// All SFU API calls go through the realtime worker (/sfu/*), which holds the app secret.
import { REALTIME_URL, type LiveState, type LiveTrack } from "./net";
import { LiveRecorder } from "./recorder";

export type TrackRole = LiveTrack["role"];
export type View = LiveState["view"];

/** Bitrates in bits/s. Pip = camera bubble over the screen (sent at reduced resolution). */
export const QUALITY = {
  eco: { label: "Econômica (~0,8 Mbps)", screen: 650_000, cam: 500_000, camPip: 150_000 },
  normal: { label: "Normal (~1,2 Mbps)", screen: 1_000_000, cam: 800_000, camPip: 200_000 },
  alta: { label: "Alta (~2 Mbps)", screen: 1_800_000, cam: 1_400_000, camPip: 300_000 },
} as const;
export type Quality = keyof typeof QUALITY;

const STUN: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
let iceCache: Promise<RTCIceServer[]> | null = null;
export function iceServers(): Promise<RTCIceServer[]> {
  if (!iceCache)
    iceCache = fetch(`${REALTIME_URL}/ice`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : STUN))
      .catch(() => STUN);
  return iceCache;
}

async function sfu(path: string, method: "GET" | "POST" | "PUT", code: string, body?: unknown): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${REALTIME_URL}/sfu/${path}`, {
        method,
        headers: { "content-type": "application/json", "x-room-code": code },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && !d.errorCode) return d;
      last = new Error(d.errorDescription || d.error || `SFU ${r.status}`);
      if (r.status < 500) break;
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  throw last;
}

const rand = () => Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------------ publisher
/** One SFU session pushing a fixed set of sendonly transceivers. Tracks are swapped with replaceTrack (no renegotiation). */
export class Publisher {
  pc: RTCPeerConnection | null = null;
  session = "";
  tracks: LiveTrack[] = [];
  private tx = new Map<TrackRole, RTCRtpTransceiver>();
  state = "new";
  onState: (s: string) => void = () => {};

  constructor(private code: string, private roles: { role: TrackRole; kind: "audio" | "video" }[]) {}

  async start() {
    const pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: "max-bundle" });
    this.pc = pc;
    pc.onconnectionstatechange = () => {
      this.state = pc.connectionState;
      this.onState(this.state);
    };
    for (const r of this.roles) {
      const init: RTCRtpTransceiverInit = { direction: "sendonly" };
      if (r.kind === "video") init.sendEncodings = [{ maxBitrate: 800_000, maxFramerate: 30 }];
      this.tx.set(r.role, pc.addTransceiver(r.kind, init));
    }
    await pc.setLocalDescription(await pc.createOffer());
    const { sessionId } = await sfu("sessions/new", "POST", this.code);
    this.session = sessionId;
    const id = rand();
    this.tracks = this.roles.map((r) => ({ name: `${r.role}-${id}`, kind: r.kind, role: r.role }));
    const res = await sfu(`sessions/${sessionId}/tracks/new`, "POST", this.code, {
      sessionDescription: { type: "offer", sdp: pc.localDescription!.sdp },
      tracks: this.roles.map((r, i) => ({ location: "local", mid: this.tx.get(r.role)!.mid, trackName: this.tracks[i].name })),
    });
    const bad = (res.tracks || []).find((t: any) => t.error);
    if (bad) throw new Error(bad.error.errorDescription || "track error");
    await pc.setRemoteDescription(res.sessionDescription);
    return { session: this.session, tracks: this.tracks };
  }

  async setTrack(role: TrackRole, track: MediaStreamTrack | null) {
    const t = this.tx.get(role);
    if (t && t.sender.track !== track) await t.sender.replaceTrack(track).catch(() => {});
  }

  async setVideo(role: TrackRole, maxBitrate: number, scale = 1, maxFramerate = 30) {
    const t = this.tx.get(role);
    if (!t) return;
    const p = t.sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = maxBitrate;
    p.encodings[0].scaleResolutionDownBy = Math.max(1, scale);
    p.encodings[0].maxFramerate = maxFramerate;
    await t.sender.setParameters(p).catch(() => {});
  }

  private prev = new Map<string, { b: number; ts: number }>();
  /** Outbound stats per role: kbps, fps, resolution, packets, loss (from the SFU's RTCP). */
  async stats() {
    const out: Record<string, { kbps: number; fps?: number; w?: number; h?: number; packets: number; lost?: number; sending: boolean }> = {};
    if (!this.pc) return out;
    const rep = await this.pc.getStats();
    const midRole = new Map<string, TrackRole>();
    for (const [role, t] of this.tx) if (t.mid) midRole.set(t.mid, role);
    const remote = new Map<string, any>();
    rep.forEach((s: any) => s.type === "remote-inbound-rtp" && remote.set(s.localId, s));
    rep.forEach((s: any) => {
      if (s.type !== "outbound-rtp") return;
      const role = midRole.get(s.mid) || (s.kind as string);
      const p = this.prev.get(s.id);
      const kbps = p && s.timestamp > p.ts ? ((s.bytesSent - p.b) * 8) / (s.timestamp - p.ts) : 0;
      this.prev.set(s.id, { b: s.bytesSent, ts: s.timestamp });
      const r = remote.get(s.id);
      out[role] = {
        kbps: Math.round(kbps),
        fps: s.framesPerSecond,
        w: s.frameWidth,
        h: s.frameHeight,
        packets: s.packetsSent,
        lost: r ? Math.round((r.fractionLost || 0) * 1000) / 10 : undefined,
        sending: kbps > 3,
      };
    });
    return out;
  }

  close() {
    this.pc?.close();
    this.pc = null;
    this.state = "closed";
  }
}

// ------------------------------------------------------------------ puller
/** One SFU pull session: subscribes to tracks of another session. */
export class Puller {
  pc: RTCPeerConnection | null = null;
  session = "";
  state = "new";
  private midName = new Map<string, string>();
  onTrack: (name: string, track: MediaStreamTrack) => void = () => {};
  onState: (s: string) => void = () => {};

  constructor(private code: string) {}

  private from = "";
  private chain: Promise<unknown> = Promise.resolve();
  lastErrors: string[] = [];

  /** Names not subscribed yet (a track the host isn't sending yet can't be pulled; retry with add()). */
  missing(names: string[]) {
    const have = new Set(this.midName.values());
    return names.filter((n) => !have.has(n));
  }

  async pull(fromSession: string, names: string[]) {
    const pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: "max-bundle" });
    this.pc = pc;
    this.from = fromSession;
    pc.ontrack = (e) => {
      const name = this.midName.get(e.transceiver.mid || "");
      if (name) this.onTrack(name, e.track);
    };
    pc.onconnectionstatechange = () => {
      this.state = pc.connectionState;
      this.onState(this.state);
    };
    const { sessionId } = await sfu("sessions/new", "POST", this.code);
    this.session = sessionId;
    return this.add(names);
  }

  /** Subscribe to more tracks on the same session (serialized; each call renegotiates once). */
  add(names: string[]): Promise<string[]> {
    const run = async () => {
      const pc = this.pc;
      if (!pc || !this.session || !names.length) return names;
      const res = await sfu(`sessions/${this.session}/tracks/new`, "POST", this.code, {
        tracks: names.map((trackName) => ({ location: "remote", sessionId: this.from, trackName })),
      });
      const failed: string[] = [];
      this.lastErrors = [];
      for (const t of res.tracks || []) {
        if (!t.error && t.mid) this.midName.set(String(t.mid), t.trackName);
        else {
          failed.push(t.trackName);
          this.lastErrors.push(`${t.trackName}: ${t.error?.errorCode || "?"}`);
        }
      }
      if (this.pc !== pc || !res.sessionDescription || res.sessionDescription.type !== "offer") return failed;
      await pc.setRemoteDescription(res.sessionDescription);
      await pc.setLocalDescription(await pc.createAnswer());
      await sfu(`sessions/${this.session}/renegotiate`, "PUT", this.code, {
        sessionDescription: { type: "answer", sdp: pc.localDescription!.sdp },
      });
      return failed;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /** Inbound video stats (frames decoded > 0 = the stream really plays). */
  async stats() {
    const out = { framesDecoded: 0, kbps: 0, audioPackets: 0, w: 0, h: 0, fps: 0 };
    if (!this.pc) return out;
    const rep = await this.pc.getStats();
    rep.forEach((s: any) => {
      if (s.type !== "inbound-rtp") return;
      if (s.kind === "video") {
        out.framesDecoded += s.framesDecoded || 0;
        out.w = Math.max(out.w, s.frameWidth || 0);
        out.h = Math.max(out.h, s.frameHeight || 0);
        out.fps = Math.max(out.fps, s.framesPerSecond || 0);
      } else out.audioPackets += s.packetsReceived || 0;
      out.kbps += s.bytesReceived || 0; // total bytes; UI derives rate
    });
    return out;
  }

  close() {
    this.pc?.close();
    this.pc = null;
    this.state = "closed";
  }
}

// ------------------------------------------------------------------ host media
export const HOST_ROLES: { role: TrackRole; kind: "audio" | "video" }[] = [
  { role: "cam", kind: "video" },
  { role: "screen", kind: "video" },
  { role: "mic", kind: "audio" },
  { role: "sys", kind: "audio" },
];

/** Host-side capture + publish. Lives outside React so minimizing the panel never stops the stream. */
export class HostMedia {
  cam: MediaStreamTrack | null = null;
  mic: MediaStreamTrack | null = null;
  screen: MediaStreamTrack | null = null;
  sys: MediaStreamTrack | null = null;
  pub: Publisher | null = null;
  view: View = "camera";
  quality: Quality = "normal";
  micOn = true;
  camId = "";
  micId = "";
  error = "";
  onChange: () => void = () => {};
  /** recording of what the viewers see (Lives anteriores); on by default, the host can switch it off */
  rec: LiveRecorder;
  recWanted = true;

  constructor(private code: string) {
    this.rec = new LiveRecorder(this);
    this.rec.onChange = () => this.onChange();
  }

  /** Recording toggle (host). Off -> closes the current part; on -> opens a new part of the same live. */
  async setRecording(on: boolean, liveId: string, room: string) {
    this.recWanted = on;
    if (on) await this.rec.start(liveId, room);
    else await this.rec.stop(false);
    this.onChange();
  }

  async startCamera(deviceId = this.camId) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      });
      this.cam?.stop();
      this.cam = s.getVideoTracks()[0];
      this.cam.contentHint = "motion";
      this.camId = this.cam.getSettings().deviceId || deviceId;
      this.error = "";
    } catch (e) {
      this.error = "Câmera: " + (e as Error).message;
    }
    await this.apply();
  }

  async startMic(deviceId = this.micId) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.mic?.stop();
      this.mic = s.getAudioTracks()[0];
      this.mic.enabled = this.micOn;
      this.micId = this.mic.getSettings().deviceId || deviceId;
      this.error = "";
    } catch (e) {
      this.error = "Microfone: " + (e as Error).message;
    }
    await this.apply();
  }

  /** Must run from a click. Tab/system audio comes along when the browser offers it. */
  async startScreen() {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24, max: 30 } },
        audio: true,
        // Chrome hints (ignored elsewhere)
        ...({ systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "include" } as any),
      });
      this.stopScreen(false);
      this.screen = s.getVideoTracks()[0];
      this.screen.contentHint = "detail";
      this.sys = s.getAudioTracks()[0] || null;
      this.screen.onended = () => {
        this.stopScreen();
      };
      if (this.view === "camera") this.view = "pip";
      this.error = "";
    } catch (e) {
      this.error = "Tela: " + (e as Error).message;
    }
    await this.apply();
  }

  stopScreen(apply = true) {
    this.screen?.stop();
    this.sys?.stop();
    this.screen = this.sys = null;
    if (apply) {
      if (this.view !== "camera") this.view = "camera";
      this.apply();
    }
  }

  listen(fn: () => void) {
    this.onChange = fn;
  }

  setQuality(q: Quality) {
    this.quality = q;
    return this.apply();
  }

  setView(v: View) {
    this.view = v;
  }

  setMicOn(on: boolean) {
    this.micOn = on;
    if (this.mic) this.mic.enabled = on;
    this.onChange();
  }

  async publish() {
    this.pub?.close();
    const p = new Publisher(this.code, HOST_ROLES);
    p.onState = () => this.onChange();
    this.pub = p;
    const info = await p.start();
    await this.apply();
    return info;
  }

  /** Decide what each transceiver sends for the current view; unused video is not sent (saves egress). */
  async apply() {
    const p = this.pub;
    if (p) {
      const q = QUALITY[this.quality];
      const showScreen = this.view !== "camera" && !!this.screen;
      const showCam = this.view === "camera" || this.view === "pip" || !this.screen;
      await p.setTrack("screen", showScreen ? this.screen : null);
      await p.setTrack("sys", showScreen ? this.sys : null);
      await p.setTrack("cam", showCam ? this.cam : null);
      await p.setTrack("mic", this.mic);
      if (this.screen) {
        const h = this.screen.getSettings().height || 720;
        await p.setVideo("screen", q.screen, h / 720, 24);
      }
      const pip = showScreen && showCam;
      const camH = this.cam?.getSettings().height || 720;
      await p.setVideo("cam", pip ? q.camPip : q.cam, pip ? camH / 240 : camH / 720, pip ? 20 : 30);
    }
    this.onChange();
  }

  /** What the viewers effectively see right now (screen shown only when one is shared). */
  effectiveView(): View {
    if (!this.screen) return "camera";
    return this.view;
  }

  stopAll() {
    if (this.rec.on) this.rec.stop(false).catch(() => {});
    this.pub?.close();
    this.pub = null;
    for (const t of [this.cam, this.mic, this.screen, this.sys]) t?.stop();
    this.cam = this.mic = this.screen = this.sys = null;
    this.onChange();
  }
}

// ------------------------------------------------------------------ helpers
/** YouTube watch/live/shorts/youtu.be -> embed (muted autoplay). Other https links pass through. No network access. */
export function toEmbed(raw: string): string {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  if (u.protocol !== "https:") return "";
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else {
      const m = u.pathname.match(/^\/(live|shorts|embed)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`;
  return u.toString();
}

export function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:` : "") + `${String(m).padStart(h ? 2 : 1, "0")}:${String(r).padStart(2, "0")}`;
}

export const REACTION_EMOJI: [string, string][] = [
  ["heart", "❤️"],
  ["fire", "🔥"],
  ["clap", "👏"],
  ["laugh", "😂"],
  ["wow", "😮"],
  ["mago", "🧙"],
];
