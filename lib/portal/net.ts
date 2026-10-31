/* eslint-disable @typescript-eslint/no-explicit-any */
// WebSocket client for the realtime Durable Object, with reconnect + batching awareness.
import type { Look } from "./art";

export const REALTIME_URL = (process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:8787").replace(/\/$/, "");

export type Role = "admin" | "host" | "user";
export type PubUser = { id: string; name: string; look: Look; x: number; y: number; tx: number; ty: number; mic: boolean; admin: boolean; role?: Role; seat?: number };
export type LiveTrack = { name: string; kind: "audio" | "video"; role: "cam" | "screen" | "mic" | "sys" };
export type LiveState = {
  on: boolean;
  id: string;
  startedAt: number;
  hostId: string;
  hostName: string;
  source: "sfu" | "embed";
  embed: string;
  sfu: { session: string; tracks: LiveTrack[] } | null;
  view: "camera" | "screen" | "pip";
  stage: { id: string; name: string; sfu: { session: string; track: string } | null }[];
  hands: number;
  handIds: string[];
  pin: string;
};
export type Hand = { uid: string; id: string; name: string; ts: number };
export type ChatMsg = { id: string; name: string; text: string; ts: number; sys?: boolean };

export type ServerEvent =
  | { t: "welcome"; me: PubUser; users: PubUser[]; chat: ChatMsg[]; admin: boolean; muted: boolean; role?: Role; live?: LiveState; allMuted?: boolean; hands?: Hand[] }
  | { t: "live"; live: LiveState }
  | { t: "hands"; list: Hand[] }
  | { t: "stage"; on: boolean }
  | { t: "allmuted"; on: boolean }
  | { t: "rx"; c: Record<string, number> }
  | { t: "join"; u: PubUser }
  | { t: "leave"; id: string }
  | { t: "mv"; id: string; x: number; y: number; tx: number; ty: number }
  | { t: "sit"; id: string; s: number }
  | { t: "sitno"; s: number }
  | { t: "chat"; m: ChatMsg; cid?: string }
  | { t: "emote"; id: string; e: string }
  | { t: "mic"; id: string; on: boolean }
  | { t: "typing"; id: string; on: boolean }
  | { t: "call"; from: string; name: string }
  | { t: "rtc"; from: string; d: any }
  | { t: "sys"; text: string }
  | { t: "err"; msg: string }
  | { t: "denied"; reason: "code" | "kicked" | "member" }
  | { t: "kicked" }
  | { t: "muted"; on: boolean }
  | { t: "clear" }
  | { t: "adminr"; r: any };

/** mt = short-lived member token from /api/portal/token (Kiwify members). */
export type JoinInfo = { name: string; look: Look; code: string; mt?: string; uid: string; adminKey?: string; x?: number; y?: number };

export class Net {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  status: "connecting" | "online" | "offline" = "connecting";
  onEvent: (e: ServerEvent) => void = () => {};
  onStatus: (s: Net["status"]) => void = () => {};
  rtt = 0;
  private pingAt = 0;
  /** Extra subscribers (live layer) besides onEvent. */
  private listeners = new Set<(e: ServerEvent) => void>();
  /** Last welcome / live / hands events, so late subscribers can catch up. */
  last: Partial<Record<"welcome" | "live" | "hands" | "allmuted", ServerEvent>> = {};

  constructor(private join: () => JoinInfo, readonly room = "salao") {}

  on(fn: (e: ServerEvent) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  connect() {
    this.closed = false;
    const url = REALTIME_URL.replace(/^http/, "ws") + `/ws?room=${this.room}&uid=${encodeURIComponent(this.join().uid)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.setStatus("connecting");
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: "join", ...this.join() }));
      this.pingTimer = setInterval(() => {
        this.pingAt = performance.now();
        this.sendRaw('{"t":"ping"}');
      }, 20000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      if (ev.data === '{"t":"pong"}') {
        this.rtt = Math.round(performance.now() - this.pingAt);
        return;
      }
      let m: any;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "b") for (const e of m.e) this.dispatch(e);
      else this.dispatch(m);
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws !== ws) return;
      this.setStatus("offline");
      if (this.closed || ev.code === 4001 || ev.code === 4003 || ev.code === 4000) return;
      const delay = Math.min(10000, 500 * 2 ** this.retry++) + Math.random() * 500;
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  private dispatch(e: ServerEvent) {
    if (e.t === "welcome") this.setStatus("online");
    if (e.t === "welcome" || e.t === "live" || e.t === "hands" || e.t === "allmuted") this.last[e.t] = e;
    this.onEvent(e);
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    }
  }

  private setStatus(s: Net["status"]) {
    this.status = s;
    this.onStatus(s);
  }

  sendRaw(s: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
  }
  send(m: Record<string, unknown>) {
    this.sendRaw(JSON.stringify(m));
  }

  /** Throttled "is typing" signal: at most one "on" every 2.5 s, "off" once when the draft is cleared. */
  private typingAt = 0;
  private typingOn = false;
  typing(on: boolean) {
    const now = performance.now();
    if (on) {
      if (this.typingOn && now - this.typingAt < 2500) return;
      this.typingAt = now;
      this.typingOn = true;
      this.send({ t: "typing", on: true });
    } else if (this.typingOn) {
      this.typingOn = false;
      this.send({ t: "typing", on: false });
    }
  }

  close() {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, "bye");
  }
}

export type RoomInfo = { codeRequired: boolean; mode?: "code" | "both" | "kiwify"; online: number };
export async function fetchInfo(room = "salao"): Promise<RoomInfo | null> {
  try {
    const r = await fetch(`${REALTIME_URL}/info?room=${encodeURIComponent(room)}`, { cache: "no-store" });
    return await r.json();
  } catch {
    return null;
  }
}

export async function checkCode(code: string): Promise<boolean> {
  try {
    const r = await fetch(`${REALTIME_URL}/check?c=${encodeURIComponent(code)}`, { cache: "no-store" });
    return (await r.json()).ok;
  } catch {
    return false;
  }
}
