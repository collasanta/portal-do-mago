/* eslint-disable @typescript-eslint/no-explicit-any */
// Direct messages (1:1) client store. Server side: realtime/src/dm.ts.
// People are addressed by socket id (online) or by an opaque "pk" the server hands out; uids never leave the server.
import type { Look } from "./art";
import type { Net } from "./net";

export type DmPeer = { pk: string; id: string | null; name: string; look: Look };
export type DmMsg = { mid: string; mine: boolean; text: string; ts: number; pending?: boolean; failed?: boolean };
export type DmConv = { peer: DmPeer; last?: { x: string; ts: number; mine: boolean }; unread: number; ts: number };
export type DmTarget = { id?: string | null; pk?: string; name: string; look: Look };

const SOUND_KEY = "pdm.dmsound";
const BLOCK_KEY = "pdm.dmblock";

function loadJson<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function saveJson(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export class DmStore {
  private net: Net | null = null;
  private subs = new Set<() => void>();
  version = 0;
  myPk = "";
  convs = new Map<string, DmConv>();
  threads = new Map<string, DmMsg[]>();
  /** people blocked by me (pk), mirrored in localStorage so the client ignores them even before the list arrives */
  blocked = new Set<string>(typeof window === "undefined" ? [] : loadJson<string[]>(BLOCK_KEY, []));
  /** currently open conversation (pk), or a pending open by socket id until the server answers */
  openPk: string | null = null;
  opening: DmTarget | null = null;
  /** true while the open conversation is actually on screen (window visible + tab focused) */
  visible = false;
  loaded = false;
  /** bumps on every open() so the UI can bring the panel up (phones: open the drawer) */
  openSeq = 0;
  sound = typeof window === "undefined" ? true : loadJson<boolean>(SOUND_KEY, true);
  /** "Nova mensagem de X" */
  onNotify: (peer: DmPeer, text: string) => void = () => {};
  onError: (msg: string) => void = () => {};
  private listTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const f of this.subs) f();
  }

  attach(net: Net) {
    this.net = net;
    const off = net.on((e: any) => this.onEvent(e));
    if (net.status === "online") net.send({ t: "dm_list" });
    return () => {
      off();
      if (this.net === net) this.net = null;
    };
  }

  get unreadTotal() {
    let n = 0;
    for (const c of this.convs.values()) if (!this.blocked.has(c.peer.pk)) n += c.unread;
    return n;
  }

  sortedConvs() {
    return [...this.convs.values()].filter((c) => !this.blocked.has(c.peer.pk)).sort((a, b) => b.ts - a.ts);
  }

  pkForId(id: string) {
    for (const c of this.convs.values()) if (c.peer.id === id) return c.peer.pk;
    return null;
  }

  private refreshList(delay = 2500) {
    if (this.listTimer) return;
    this.listTimer = setTimeout(() => {
      this.listTimer = null;
      this.net?.send({ t: "dm_list" });
    }, delay);
  }

  private upsertPeer(p: DmPeer) {
    const c = this.convs.get(p.pk);
    if (c) c.peer = { ...c.peer, ...p };
    else this.convs.set(p.pk, { peer: p, unread: 0, ts: Date.now() });
    if (this.opening && ((this.opening.id && this.opening.id === p.id) || this.opening.pk === p.pk)) {
      this.opening = null;
      this.openPk = p.pk;
    }
    return this.convs.get(p.pk)!;
  }

  private onEvent(e: any) {
    switch (e.t) {
      case "welcome":
        this.net?.send({ t: "dm_list" });
        if (this.openPk) this.net?.send({ t: "dm_hist", to: this.openPk });
        return;
      case "join":
        // someone (maybe a DM peer) came back: refresh the online flags lazily
        for (const c of this.convs.values()) if (!c.peer.id) return this.refreshList();
        return;
      case "leave": {
        let hit = false;
        for (const c of this.convs.values())
          if (c.peer.id === e.id) {
            c.peer = { ...c.peer, id: null };
            hit = true;
          }
        if (hit) this.emit();
        return;
      }
      case "dm_list": {
        this.myPk = e.me;
        const next = new Map<string, DmConv>();
        for (const c of e.convs as DmConv[]) {
          const old = this.convs.get(c.peer.pk);
          // an open + visible conversation stays read
          next.set(c.peer.pk, { ...c, unread: this.openPk === c.peer.pk && this.visible ? 0 : c.unread, peer: { ...old?.peer, ...c.peer } });
        }
        // keep local-only conversations (opened but not yet messaged)
        for (const [pk, c] of this.convs) if (!next.has(pk) && this.threads.has(pk)) next.set(pk, c);
        this.convs = next;
        this.blocked = new Set(e.blocked as string[]);
        saveJson(BLOCK_KEY, [...this.blocked]);
        this.loaded = true;
        this.emit();
        return;
      }
      case "dm_hist": {
        const c = this.upsertPeer(e.peer);
        this.threads.set(e.peer.pk, e.msgs);
        if (e.blocked) this.blocked.add(e.peer.pk);
        if (this.openPk === e.peer.pk && this.visible && c.unread) this.markRead(e.peer.pk);
        this.emit();
        return;
      }
      case "dm_gone":
        if (this.opening) {
          this.onError(`${this.opening.name} saiu do salão.`);
          this.opening = null;
        }
        this.emit();
        return;
      case "dm": {
        const peer = e.peer as DmPeer;
        if (!e.m.mine && this.blocked.has(peer.pk)) return;
        const c = this.upsertPeer(peer);
        const t = this.threads.get(peer.pk) || [];
        const i = e.cid ? t.findIndex((m) => m.mid === "c:" + e.cid) : -1;
        const msg: DmMsg = { mid: e.m.mid, mine: e.m.mine, text: e.m.text, ts: e.m.ts };
        if (i >= 0) t[i] = msg;
        else if (!t.some((m) => m.mid === msg.mid)) t.push(msg);
        if (t.length > 200) t.splice(0, t.length - 200);
        this.threads.set(peer.pk, t);
        c.last = { x: msg.text.slice(0, 80), ts: msg.ts, mine: msg.mine };
        c.ts = msg.ts;
        if (!msg.mine) {
          const seen = this.openPk === peer.pk && this.visible;
          if (seen) this.markRead(peer.pk);
          else {
            c.unread = typeof e.unread === "number" ? e.unread : c.unread + 1;
            this.onNotify(c.peer, msg.text);
            if (this.sound) blip();
          }
        }
        this.emit();
        return;
      }
      case "dm_err": {
        if (e.cid)
          for (const t of this.threads.values()) {
            const m = t.find((x) => x.mid === "c:" + e.cid);
            if (m) {
              m.pending = false;
              m.failed = true;
            }
          }
        this.onError(e.msg);
        this.emit();
        return;
      }
      case "dm_blocked":
        if (e.on) this.blocked.add(e.pk);
        else this.blocked.delete(e.pk);
        saveJson(BLOCK_KEY, [...this.blocked]);
        this.emit();
        return;
    }
  }

  /** Open a conversation from a member row (socket id) or from the conversation list (pk). */
  open(t: DmTarget) {
    this.openSeq++;
    const pk = t.pk || (t.id ? this.pkForId(t.id) : null);
    if (pk) {
      this.openPk = pk;
      this.opening = null;
      const c = this.convs.get(pk);
      if (c && t.id && !c.peer.id) c.peer = { ...c.peer, id: t.id };
      this.net?.send({ t: "dm_hist", to: pk });
      if (c?.unread && this.visible) this.markRead(pk);
    } else if (t.id) {
      this.openPk = null;
      this.opening = t;
      this.net?.send({ t: "dm_hist", to: t.id });
    }
    this.emit();
  }

  close() {
    this.openPk = null;
    this.opening = null;
    this.emit();
  }

  setVisible(v: boolean) {
    if (this.visible === v) return;
    this.visible = v;
    if (v && this.openPk && this.convs.get(this.openPk)?.unread) this.markRead(this.openPk);
  }

  markRead(pk: string) {
    const c = this.convs.get(pk);
    if (c) c.unread = 0;
    this.net?.send({ t: "dm_read", to: pk });
    this.emit();
  }

  send(text: string) {
    const pk = this.openPk;
    const t = text.trim().slice(0, 500);
    if (!pk || !t || !this.net) return;
    const cid = Math.random().toString(36).slice(2, 10);
    const list = this.threads.get(pk) || [];
    list.push({ mid: "c:" + cid, mine: true, text: t, ts: Date.now(), pending: true });
    this.threads.set(pk, list);
    // online peers by socket id (always resolvable), offline ones by pk (resolved against my history)
    const peer = this.convs.get(pk)?.peer;
    this.net.send({ t: "dm", to: peer?.id || pk, text: t, cid });
    this.emit();
  }

  block(pk: string, on: boolean) {
    if (on) this.blocked.add(pk);
    else this.blocked.delete(pk);
    saveJson(BLOCK_KEY, [...this.blocked]);
    this.net?.send({ t: "dm_block", to: pk, on });
    this.emit();
  }

  setSound(on: boolean) {
    this.sound = on;
    saveJson(SOUND_KEY, on);
    this.emit();
  }
}

/** Shared instance: one room at a time. Room.tsx's info card and the social panel both open DMs through it. */
export const dmStore = typeof window === "undefined" ? (null as unknown as DmStore) : new DmStore();

let actx: AudioContext | null = null;
/** Subtle two-note chime (WebAudio, no asset). */
export function blip() {
  try {
    actx = actx || new AudioContext();
    if (actx.state === "suspended") void actx.resume();
    const t0 = actx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      const s = t0 + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.07, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g).connect(actx.destination);
      o.start(s);
      o.stop(s + 0.18);
    }
  } catch {}
}
