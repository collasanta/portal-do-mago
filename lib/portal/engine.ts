// Canvas engine: isometric room, avatars, camera, input. Network-agnostic (Portal wires it up).
import {
  AV_AX, AV_AY, AV_W, DIR_S, FRAME_SIT, anyAvatarFrame, atlasStats, avatarFrame, blitSprite, avatarTop, drawFloorFx, drawLights, wallHit, dirFromScreen, TH, TW, blockSprite, buildFloor,
  onAtlasLost, resetAvatarAtlas, resetRoomArt, screenToTile, setSpriteBudget, tileCenter, type Look,
} from "./art";
import {
  BLOCKS, MAP_H, MAP_W, NPC_POS, inLiveZone, inTvZone, SEATS, SPAWN, SPOTS, VOICE_RADIUS, ZONE_TAGS, isWalkable, seatAt, type Block, type Interact, type Seat,
} from "./map";
import { drawStageScreen, resetStageScreen, tvScreen } from "./stage-screen";
import { ORIGIN_X, ORIGIN_Y, SCREEN_IN, TV_SCREEN_IN, WALL_H, liveFx } from "./room-art";
import { findPath, nearestWalkable, type P } from "./path";
import { Overlay, type OvAvatar } from "./overlay";

export type Avatar = {
  id: string;
  name: string;
  look: Look;
  x: number;
  y: number;
  path: P[];
  /** 0..7 screen direction (0=E, 2=S, 6=N), see avatar.ts */
  dir: number;
  flip: boolean;
  walkT: number;
  moving: boolean;
  bubbles: { text: string; until: number }[];
  emote: { e: string; t0: number } | null;
  mic: boolean;
  admin: boolean;
  role?: string;
  me?: boolean;
  npc?: "oracle" | "plaque";
  level?: number;
  /** SEATS index while seated (server-confirmed for others, optimistic for me), -1 = standing */
  seat: number;
};

const SPEED = 3.6; // tiles per second
const EMOTES: Record<string, string> = { wave: "👋", heart: "❤️", laugh: "😂", fire: "🔥", spark: "✨", clap: "👏" };
export const EMOTE_LIST = Object.entries(EMOTES);
/** Centre of the stage LED screen in floor-canvas px (right wall shear: x = i, y = row + i/2). */
const STAGE_SCREEN_C = {
  x: ORIGIN_X + SCREEN_IN.x + SCREEN_IN.w / 2,
  y: ORIGIN_Y - WALL_H + SCREEN_IN.y + SCREEN_IN.h / 2 + (SCREEN_IN.x + SCREEN_IN.w / 2) / 2,
};
/** Centre of the Sala de TV wall TV in floor-canvas px. */
const TV_SCREEN_C = {
  x: ORIGIN_X + TV_SCREEN_IN.x + TV_SCREEN_IN.w / 2,
  y: ORIGIN_Y - WALL_H + TV_SCREEN_IN.y + TV_SCREEN_IN.h / 2 + (TV_SCREEN_IN.x + TV_SCREEN_IN.w / 2) / 2,
};
const CAM_LIFT = 40;
/** screen px a seated avatar is nudged toward its facing (7 = NE / -y, 5 = NW / -x, 3 = SW / +y, 1 = SE / +x) */
const SIT_FWD: Record<number, [number, number]> = { 7: [4, -2], 5: [-4, -2], 3: [-3, 2], 1: [3, 2] }; // camera looks a bit above the feet


const MAGO_LINES = [
  "Bem-vindo ao Salão do Grimório!",
  "Clique no chão pra andar 🪄",
  "Chegue perto da galera pra conversar por voz",
  "Dúvida do curso? Fala com o Oráculo ali na mesa",
  "Mostre seu canal no Canto dos Nichos!",
];

export class Engine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  floor: HTMLCanvasElement;
  avatars = new Map<string, Avatar>();
  npcs: Avatar[] = [];
  meId: string | null = null;
  /** CSS-px per world-px. Always zDev / dpr so the room is drawn at an integer device-pixel scale (crisp pixels). */
  zoom = 1;
  private zoomTarget = 1;
  private zDev = 2;
  private wheelAcc = 0;
  cam = { x: 0, y: 0 };
  private pan = { x: 0, y: 0 };
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private marker: { x: number; y: number; t0: number } | null = null;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private pinch0: { d: number; z: number } | null = null;
  private dragged = false;
  private lastMoveSent = 0;
  private pendingMove: ReturnType<typeof setTimeout> | null = null;
  pixelFont = "Pixelify Sans, monospace";
  speaking = new Map<string, number>();
  micOn = false;
  hover: Interact | null = null;
  overlay = new Overlay();

  onMove: (from: P, to: P) => void = () => {};
  onInteract: (k: Interact) => void = () => {};
  onTileClick: () => void = () => {};
  /** avatar clicked (null = clicked elsewhere); screen coords of the click */
  onAvatarClick: (id: string | null) => void = () => {};
  /** I arrived on a seat I clicked (send it to the server); -1 = stood up without moving */
  onSit: (seat: number) => void = () => {};
  /** clicked a seat someone already sits on */
  onSeatBusy: () => void = () => {};
  /** room seats (debug / automated checks) */
  readonly seats = SEATS;
  /** seat I'm walking to (sit on arrival) */
  private wantSeat = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.floor = this.makeFloor();
    // GPU context loss (memory pressure, driver reset, sleep/wake) wipes every cached canvas: rebuild the art caches
    const lost = () => this.rebuildArt();
    canvas.addEventListener("contextlost", () => (this.ctxLost = true));
    canvas.addEventListener("contextrestored", lost);
    this.offAtlas = onAtlasLost(lost);
    this.lostPoll = setInterval(() => {
      const c = this.ctx as CanvasRenderingContext2D & { isContextLost?: () => boolean };
      const f = this.floorCtx as (CanvasRenderingContext2D & { isContextLost?: () => boolean }) | null;
      const isLost = !!(c.isContextLost?.() || f?.isContextLost?.());
      if (isLost) this.ctxLost = true;
      else if (this.ctxLost) this.rebuildArt();
    }, 2000);
    (globalThis as unknown as { __pmEngine?: Engine }).__pmEngine = this;
    this.overlay.iconFor = (id) => {
      const a = this.avatars.get(id) || this.npcs.find((n) => n.id === id);
      return a ? { icon: () => avatarFrame(a.look, DIR_S, 0, a.npc), iconCrop: { sy: AV_AY - avatarTop(a.look, a.npc), sh: 34 } } : null;
    };
    this.npcs = [
      this.makeNpc("npc-oraculo", "Oráculo", NPC_POS.oraculo.x, NPC_POS.oraculo.y, "oracle"),
      this.makeNpc("npc-mago", "Mago do YouTube", NPC_POS.mago.x, NPC_POS.mago.y, "plaque"),
    ];
    this.npcs[1].dir = DIR_S;
    const c = tileCenter(SPAWN.x, SPAWN.y);
    this.cam = { x: c.x, y: c.y - CAM_LIFT };
    this.bind();
    this.resize();
    canvas.style.imageRendering = "pixelated";
    // Habbo-like default: 1:1 on desktop, a bit wider view on phones; always an integer device scale
    // phones: smallest integer scale at which the room fills the (tall) view, so there is no void under the floor
    this.applyZ(this.w < 600 ? Math.max(Math.round(0.7 * this.dpr), Math.ceil((this.dpr * (this.h - 150)) / this.floor.height)) : this.dpr);
    this.raf = requestAnimationFrame(this.frame);
    let line = 0;
    const mago = this.npcs[1];
    const tick = () => {
      // one welcome round, then only occasionally so the rising chat log is not flooded
      if (line < MAGO_LINES.length || line % 4 === 0) this.overlay.say(mago.id, mago.name, MAGO_LINES[line % MAGO_LINES.length], "npc");
      line++;
    };
    setTimeout(tick, 900);
    this.magoTimer = setInterval(tick, 11000);
  }
  private magoTimer: ReturnType<typeof setInterval>;
  private lostPoll: ReturnType<typeof setInterval>;
  private offAtlas: () => void;
  private ctxLost = false;
  private animated = new Set<Avatar>();
  private coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  private floorCtx: CanvasRenderingContext2D | null = null;
  /** perf counters (read from devtools via globalThis.__pmEngine.perf) */
  perf = { renderMs: 0, visible: 0, rebuilds: 0, atlas: atlasStats };

  private makeFloor() {
    const f = buildFloor();
    this.floorCtx = f.getContext("2d");
    f.addEventListener("contextlost", () => (this.ctxLost = true));
    f.addEventListener("contextrestored", () => this.rebuildArt());
    return f;
  }

  /** Drop and lazily rebuild every cached canvas (atlas, furni, glows, floor). */
  rebuildArt() {
    this.ctxLost = false;
    this.perf.rebuilds++;
    resetAvatarAtlas();
    resetRoomArt();
    resetStageScreen();
    this.floor = this.makeFloor();
  }

  private makeNpc(id: string, name: string, x: number, y: number, npc: "oracle" | "plaque"): Avatar {
    return {
      id, name, x, y, path: [], dir: DIR_S, flip: false, walkT: 0, moving: false, bubbles: [], emote: null, mic: false,
      admin: true, npc, seat: -1, look: { skin: 2, hair: 0, hairStyle: 0, shirt: npc === "plaque" ? 1 : 5, hat: 1 },
    };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.magoTimer);
    clearInterval(this.lostPoll);
    this.offAtlas();
    if ((globalThis as unknown as { __pmEngine?: Engine }).__pmEngine === this) delete (globalThis as unknown as { __pmEngine?: Engine }).__pmEngine;
    window.removeEventListener("resize", this.resize);
  }

  // ------------------------------------------------------------ avatars
  upsert(u: { id: string; name: string; look: Look; x: number; y: number; tx: number; ty: number; mic: boolean; admin: boolean; role?: string; seat?: number }, me = false) {
    let a = this.avatars.get(u.id);
    if (!a) {
      a = {
        id: u.id, name: u.name, look: u.look, x: u.tx, y: u.ty, path: [], dir: DIR_S, flip: false, walkT: 0, moving: false,
        bubbles: [], emote: null, mic: u.mic, admin: u.admin, role: u.role, me, seat: -1,
      };
      const st = u.seat != null && u.seat >= 0 ? SEATS[u.seat] : null;
      if (st) {
        a.x = st.x;
        a.y = st.y;
        a.seat = st.i;
        a.dir = st.dir;
      }
      if (!isWalkable(a.x, a.y)) {
        const n = nearestWalkable({ x: a.x, y: a.y }) || SPAWN;
        a.x = n.x;
        a.y = n.y;
      }
      this.avatars.set(u.id, a);
    } else {
      Object.assign(a, { name: u.name, look: u.look, mic: u.mic, admin: u.admin, role: u.role });
    }
    if (me) {
      this.meId = u.id;
      const c = tileCenter(a.x, a.y);
      this.cam = { x: c.x, y: c.y - CAM_LIFT };
    }
    return a;
  }

  remove(id: string) {
    this.avatars.delete(id);
  }

  me() {
    return this.meId ? this.avatars.get(this.meId) || null : null;
  }

  remoteMove(id: string, x: number, y: number, tx: number, ty: number) {
    const a = this.avatars.get(id);
    if (!a || a.me) return;
    a.seat = -1; // any move stands you up (the server clears the seat too)
    let start = { x: Math.round(a.x), y: Math.round(a.y) };
    if (Math.hypot(a.x - x, a.y - y) > 2) {
      a.x = x;
      a.y = y;
      start = { x, y };
    }
    a.path = findPath(start, { x: tx, y: ty });
    if (!a.path.length && (a.x !== tx || a.y !== ty) && isWalkable(tx, ty)) a.path = [{ x: tx, y: ty }];
  }

  /** Server-confirmed sit / stand of someone (s = seat index, -1 = stood up). */
  setSeat(id: string, s: number) {
    const a = this.avatars.get(id);
    if (!a) return;
    const st = s >= 0 ? SEATS[s] : null;
    a.seat = st ? st.i : -1;
    if (!st) return;
    // free that seat locally if a stale avatar still "sits" there
    for (const o of this.avatars.values()) if (o !== a && o.seat === st.i) o.seat = -1;
    if (!a.me && !a.path.length && Math.hypot(a.x - st.x, a.y - st.y) > 0.01) a.path = findPath({ x: Math.round(a.x), y: Math.round(a.y) }, st);
  }

  /** The server refused my seat (someone got there first): stand up and step off it. */
  seatRefused() {
    const me = this.me();
    if (!me) return;
    me.seat = -1;
    this.onSeatBusy();
    const n = nearestWalkable({ x: Math.round(me.x), y: Math.round(me.y) }, undefined, (x, y) => !seatAt(x, y));
    if (n) this.walkTo(n);
  }

  seatTaken(s: number) {
    for (const a of this.avatars.values()) if (!a.me && a.seat === s) return true;
    return false;
  }

  /** Walk to a seat and sit on arrival (busy -> walk next to it instead). */
  sitAt(st: Seat) {
    const me = this.me();
    if (!me) return;
    if (me.seat === st.i) return;
    if (this.seatTaken(st.i)) {
      this.onSeatBusy();
      const n = nearestWalkable(st, me, (x, y) => !seatAt(x, y));
      if (n) this.walkTo(n);
      return;
    }
    if (Math.round(me.x) === st.x && Math.round(me.y) === st.y && !me.path.length) {
      this.wantSeat = st.i;
      this.arrive(me);
      return;
    }
    this.walkTo(st);
    if (me.path.length && me.path[me.path.length - 1].x === st.x && me.path[me.path.length - 1].y === st.y) this.wantSeat = st.i;
  }

  /** Nearest free seat matching the filter (e.g. the audience), walk there and sit. */
  sitNearest(filter: (s: Seat) => boolean) {
    const me = this.me();
    if (!me) return false;
    let best: Seat | null = null, bd = Infinity;
    for (const st of SEATS) {
      if (!filter(st) || this.seatTaken(st.i)) continue;
      const d = Math.hypot(st.x - me.x, st.y - me.y);
      if (d < bd) ((bd = d), (best = st));
    }
    if (best) this.sitAt(best);
    return !!best;
  }

  private arrive(me: Avatar) {
    const st = this.wantSeat >= 0 ? SEATS[this.wantSeat] : null;
    this.wantSeat = -1;
    if (!st || Math.round(me.x) !== st.x || Math.round(me.y) !== st.y) return;
    if (this.seatTaken(st.i)) return this.seatRefused();
    me.seat = st.i;
    me.dir = st.dir;
    this.onSit(st.i);
  }

  say(id: string, text: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.overlay.say(a.id, a.name, text, a.me ? "me" : a.admin ? "admin" : "user");
  }

  typing(id: string, on: boolean) {
    this.overlay.setTyping(id, on);
  }

  emote(id: string, e: string) {
    const a = this.avatars.get(id);
    if (a && EMOTES[e]) a.emote = { e, t0: performance.now() };
  }

  walkTo(t: P) {
    const me = this.me();
    if (!me) return;
    this.wantSeat = -1;
    // start from the tile we are heading to so we never snap backwards
    const from = me.path.length ? me.path[0] : { x: Math.round(me.x), y: Math.round(me.y) };
    const path = findPath(from, t);
    if (!path.length) return;
    me.path = me.path.length ? [me.path[0], ...path] : path;
    me.seat = -1;
    const dest = path[path.length - 1];
    this.marker = { x: dest.x, y: dest.y, t0: performance.now() };
    this.pan = { x: 0, y: 0 };
    this.sendMove();
  }

  /** Throttled "mv" (current tile -> end of path), shared by click-walk and keyboard-walk. */
  private sendMove() {
    const send = () => {
      this.lastMoveSent = performance.now();
      this.pendingMove = null;
      const cur = this.me();
      if (!cur) return;
      const f = cur.path.length ? cur.path[0] : { x: Math.round(cur.x), y: Math.round(cur.y) };
      const d = cur.path.length ? cur.path[cur.path.length - 1] : f;
      this.onMove(f, d);
    };
    const since = performance.now() - this.lastMoveSent;
    if (this.pendingMove) return;
    if (since > 160) send();
    else this.pendingMove = setTimeout(send, 160 - since);
  }

  /**
   * Keyboard walking: queue one tile in a SCREEN direction (sx,sy in -1..1, 2:1 iso: up = tile (-1,-1)).
   * `fresh` = key just pressed (replaces any click-walk path). Held keys only queue the next tile when the
   * avatar is about to arrive, so a tap is exactly one tile and a held key is continuous.
   */
  keyStep(sx: number, sy: number, fresh: boolean) {
    const me = this.me();
    if (!me || (!sx && !sy)) return;
    if (fresh && me.path.length > 1) me.path.length = 1;
    if (me.path.length) {
      if (me.path.length > 1) return;
      if (Math.hypot(me.path[0].x - me.x, me.path[0].y - me.y) > 0.45) return;
    }
    const base = me.path.length ? me.path[0] : { x: Math.round(me.x), y: Math.round(me.y) };
    const tx = Math.sign(sx + sy), ty = Math.sign(sy - sx);
    const ok = (dx: number, dy: number) =>
      (dx || dy) && isWalkable(base.x + dx, base.y + dy) && (!dx || !dy || (isWalkable(base.x + dx, base.y) && isWalkable(base.x, base.y + dy)));
    // blocked diagonal: slide along either axis
    const pick = ok(tx, ty) ? [tx, ty] : tx && ty ? (ok(tx, 0) ? [tx, 0] : ok(0, ty) ? [0, ty] : null) : null;
    if (!pick) {
      if (!me.path.length && me.seat < 0) me.dir = dirFromScreen(sx, sy);
      return;
    }
    this.pan = { x: 0, y: 0 };
    this.wantSeat = -1;
    me.seat = -1;
    me.path.push({ x: base.x + pick[0], y: base.y + pick[1] });
    this.sendMove();
  }

  // ------------------------------------------------------------ camera / input
  resize = () => {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.zoom = this.zoomTarget = this.zDev / this.dpr;
  };

  /** Habbo-like framing: the room fills the view and the camera never drifts off into the void. */
  private frameCam(x: number, y: number) {
    const W = this.floor.width, H = this.floor.height;
    const vw = this.w / this.zoom, vh = this.h / this.zoom;
    const m = 16, mb = 150 / this.zoom; // the bottom bar overlays the canvas
    const cl = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    return { x: cl(x, vw / 2 - m, W - vw / 2 + m), y: cl(y, vh / 2 - m, H - vh / 2 + mb) };
  }

  private applyZ(n: number) {
    const max = Math.max(2, Math.round(this.dpr * 3));
    this.zDev = Math.max(1, Math.min(max, Math.round(n)));
    this.zoom = this.zoomTarget = this.zDev / this.dpr;
  }

  setZoom(dir: 1 | -1) {
    this.applyZ(this.zDev + dir);
  }

  private toWorld(sx: number, sy: number) {
    return { x: (sx - this.w / 2) / this.zoom + this.cam.x, y: (sy - this.h / 2) / this.zoom + this.cam.y };
  }

  private hitInteract(wx: number, wy: number): { k: Interact; b: Block | Avatar } | null {
    for (const n of this.npcs) {
      const c = tileCenter(n.x, n.y);
      if (wx > c.x - 20 && wx < c.x + 20 && wy > c.y - AV_AY + 4 && wy < c.y + 4) return { k: n.npc === "oracle" ? "oraculo" : "mago", b: n };
    }
    for (const b of BLOCKS) {
      const k: Interact | undefined =
        b.interact || (b.kind.startsWith("otable") ? "oraculo" : b.kind.startsWith("pedestal") ? "grimorio" : undefined);
      if (!k || k === "palco") continue;
      const c = tileCenter(b.x, b.y);
      const big = b.kind === "otable_crystal" || b.kind === "pedestal_book";
      const cx = c.x, cy = big ? c.y - 16 : c.y;
      if (wx > cx - (big ? 56 : 30) && wx < cx + (big ? 56 : 30) && wy > cy - (big ? 84 : 64) && wy < cy + 16) return { k, b };
    }
    // wall-mounted niche board / stage screen
    const w = wallHit(wx, wy);
    if (w) return { k: w, b: BLOCKS[0] };
    return null;
  }

  /** Seat under a click: the furni's silhouette (seat + back), front-most first. */
  private hitSeat(wx: number, wy: number): Seat | null {
    let best: Seat | null = null;
    for (const st of SEATS) {
      const c = tileCenter(st.x, st.y);
      const top = st.kind === "stool" ? 46 : st.kind === "aud" || st.kind.startsWith("sofa") || st.kind.startsWith("tv") ? 40 : 34;
      if (wx < c.x - 24 || wx > c.x + 24 || wy < c.y - top || wy > c.y + 10) continue;
      if (!best || st.x + st.y > best.x + best.y) best = st;
    }
    return best;
  }

  private bind() {
    const c = this.canvas;
    window.addEventListener("resize", this.resize);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.wheelAcc += e.deltaY;
      if (Math.abs(this.wheelAcc) >= 80) {
        this.setZoom(this.wheelAcc > 0 ? -1 : 1);
        this.wheelAcc = 0;
      }
    }, { passive: false });
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY });
      this.dragged = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zDev };
      }
    });
    c.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        const w = this.toWorld(e.offsetX, e.offsetY);
        const hit = this.hitInteract(w.x, w.y);
        this.hover = hit?.k || null;
        const av = this.overlay.pick(e.offsetX, e.offsetY);
        this.overlay.hoverId = av;
        c.style.cursor = hit || av ? "pointer" : "default";
        return;
      }
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      p.x = e.offsetX;
      p.y = e.offsetY;
      if (this.pointers.size === 2 && this.pinch0) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.applyZ((this.pinch0.z * d) / this.pinch0.d);
        this.dragged = true;
        return;
      }
      if (Math.hypot(e.offsetX - p.sx, e.offsetY - p.sy) > 8) this.dragged = true;
      if (this.dragged) {
        this.cam = this.frameCam(this.cam.x - dx / this.zoom, this.cam.y - dy / this.zoom);
        const me = this.me();
        if (me) {
          // keep the pan offset equal to what is actually on screen so dragging back never feels sticky
          const c = tileCenter(me.x, me.y);
          this.pan = { x: this.cam.x - c.x, y: this.cam.y - (c.y - CAM_LIFT) };
        }
      }
    });
    const up = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch0 = null;
      if (!p || this.dragged) return;
      const w = this.toWorld(e.offsetX, e.offsetY);
      this.onTileClick();
      const hit = this.hitInteract(w.x, w.y);
      const av = hit ? null : this.overlay.pick(e.offsetX, e.offsetY);
      if (av && !av.startsWith("npc-")) {
        this.overlay.selectedId = av;
        if (e.pointerType !== "mouse") this.overlay.hoverId = av;
        this.onAvatarClick(av);
        return;
      }
      if (this.overlay.selectedId) {
        this.overlay.selectedId = null;
        this.onAvatarClick(null);
      }
      if (hit) {
        this.onInteract(hit.k);
        // the TV / poster / VHS shelf: take the nearest free seat in the Sala de TV
        if (hit.k === "tv") {
          const me = this.me();
          if (me && me.seat >= 0 && inTvZone(me.x, me.y)) return; // already on a TV seat
          if (!this.sitNearest((s) => inTvZone(s.x, s.y))) this.walkTo(SPOTS.tv);
        } else if ("x" in hit.b && hit.k !== "palco" && hit.k !== "nichos") {
          const near = nearestWalkable({ x: hit.b.x + 1, y: hit.b.y + 1 }, this.me() || undefined);
          if (near) this.walkTo(near);
        } else if (hit.k === "nichos") this.walkTo(SPOTS.nichos);
        else if (hit.k === "palco") this.walkTo(SPOTS.palco);
        return;
      }
      const st = this.hitSeat(w.x, w.y);
      if (st) return this.sitAt(st);
      // feet are at tile centre; screenToTile expects tile-top-vertex coordinates
      const t = screenToTile(w.x, w.y);
      if (t.x < 0 || t.y < 0 || t.x >= MAP_W || t.y >= MAP_H) return;
      this.walkTo(t);
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch0 = null;
    });
  }

  // ------------------------------------------------------------ simulation
  private step(a: Avatar, dt: number) {
    if (!a.path.length) {
      a.moving = false;
      a.walkT = 0;
      return;
    }
    const n = a.path[0];
    const dx = n.x - a.x, dy = n.y - a.y;
    const d = Math.hypot(dx, dy);
    const mv = SPEED * dt * (a.path.length > 6 ? 1.15 : 1);
    // facing: screen-down when dx+dy>0
    const sdx = dx - dy, sdy = dx + dy;
    if (Math.abs(sdx) > 0.01 || Math.abs(sdy) > 0.01) {
      a.dir = dirFromScreen(sdx, sdy);
    }
    if (d <= mv) {
      a.x = n.x;
      a.y = n.y;
      a.path.shift();
    } else {
      a.x += (dx / d) * mv;
      a.y += (dy / d) * mv;
    }
    a.moving = true;
    a.walkT += dt;
  }

  private frame = (t: number) => {
    const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    for (const a of this.avatars.values()) this.step(a, dt);
    const me = this.me();
    if (me && this.wantSeat >= 0 && !me.path.length) this.arrive(me);
    if (me) {
      let c = tileCenter(me.x, me.y);
      // seated in the audience during a live: frame both you and the stage screen
      if (liveFx.on && me.seat >= 0 && inLiveZone(me.x, me.y)) {
        const b = 0.75;
        c = { x: c.x + (STAGE_SCREEN_C.x - c.x) * b, y: c.y + (STAGE_SCREEN_C.y + CAM_LIFT - c.y) * b };
      } else if (tvScreen.video && me.seat >= 0 && inTvZone(me.x, me.y)) {
        // seated in the Sala de TV with a live picked: frame both you and the TV
        const b = 0.6;
        c = { x: c.x + (TV_SCREEN_C.x - c.x) * b, y: c.y + (TV_SCREEN_C.y + CAM_LIFT - c.y) * b };
      }
      const tx = c.x + this.pan.x, ty = c.y - CAM_LIFT + this.pan.y;
      const k = Math.min(1, dt * 6);
      const g = this.frameCam(tx, ty);
      this.cam.x += (g.x - this.cam.x) * k;
      this.cam.y += (g.y - this.cam.y) * k;
    } else this.cam = this.frameCam(this.cam.x, this.cam.y);
    const r0 = performance.now();
    this.render(t);
    this.perf.renderMs += (performance.now() - r0 - this.perf.renderMs) * 0.05;
    this.raf = requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------ render
  private render(t: number) {
    const ctx = this.ctx;
    const z = this.zDev; // integer device-px per world-px
    // at most this many brand-new sprite frames per frame; walk frames over budget fall back to the idle frame
    setSpriteBudget(this.coarse ? 5 : 10);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0d0b1a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const ox = Math.round(this.canvas.width / 2 - this.cam.x * z);
    const oy = Math.round(this.canvas.height / 2 - this.cam.y * z);
    ctx.setTransform(z, 0, 0, z, ox, oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.floor, 0, 0);
    drawStageScreen(ctx, t);
    drawFloorFx(ctx, t);

    const me = this.me();
    // proximity circle
    if (me) {
      const c = tileCenter(me.x, me.y);
      const rx = VOICE_RADIUS * (TW / 2) * Math.SQRT2, ry = VOICE_RADIUS * (TH / 2) * Math.SQRT2;
      ctx.save();
      ctx.lineWidth = 1.2 / this.zoom * 1.5;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -t / 80;
      ctx.strokeStyle = this.micOn ? "rgba(80,220,140,0.75)" : "rgba(68,136,255,0.55)";
      ctx.fillStyle = this.micOn ? "rgba(80,220,140,0.06)" : "rgba(0,102,255,0.05)";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // click marker
    if (this.marker) {
      const age = (t - this.marker.t0) / 700;
      if (age > 1) this.marker = null;
      else {
        const c = tileCenter(this.marker.x, this.marker.y);
        ctx.strokeStyle = `rgba(255,215,0,${1 - age})`;
        ctx.lineWidth = 2;
        const s = 1 - age * 0.4;
        ctx.beginPath();
        ctx.moveTo(c.x - 26 * s, c.y);
        ctx.lineTo(c.x, c.y - 13 * s);
        ctx.lineTo(c.x + 26 * s, c.y);
        ctx.lineTo(c.x, c.y + 13 * s);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // depth-sorted drawables
    type D = { k: number; draw: () => void };
    const list: D[] = [];
    const cw = this.w / this.zoom / 2 + 120, ch = this.h / this.zoom / 2 + 200;
    for (const b of BLOCKS) {
      const s = blockSprite(b.kind);
      if (!s) continue;
      const c = tileCenter(b.x, b.y);
      if (Math.abs(c.x - this.cam.x) > cw || Math.abs(c.y - this.cam.y) > ch) continue;
      list.push({ k: b.x + b.y, draw: () => ctx.drawImage(s.c, Math.round(c.x - s.ax), Math.round(c.y - s.ay)) });
      // backrest facing the camera: drawn after an avatar sitting on this tile
      const f = b.front ? blockSprite(b.kind + "@f") : null;
      if (f) list.push({ k: b.x + b.y + 0.2, draw: () => ctx.drawImage(f.c, Math.round(c.x - f.ax), Math.round(c.y - f.ay)) });
    }
    const all = [...this.avatars.values(), ...this.npcs];
    const vw = this.w / this.zoom / 2 + 60, vh = this.h / this.zoom / 2 + 120;
    const visible: Avatar[] = [];
    for (const a of all) {
      const c = tileCenter(a.x, a.y);
      if (Math.abs(c.x - this.cam.x) > vw || Math.abs(c.y - this.cam.y) > vh) continue;
      visible.push(a);
      list.push({ k: a.x + a.y + 0.1, draw: () => this.drawAvatar(a, c.x, c.y, t) });
    }
    // level of detail: in a crowd only the walkers nearest the camera animate their legs (the rest glide on the
    // idle frame), which keeps the sprite atlas working set small and avoids re-rendering frames every second
    this.animated.clear();
    const maxAnim = this.coarse ? 30 : 60;
    const walkers = visible.filter((a) => a.moving);
    if (walkers.length > maxAnim) {
      const d = (a: Avatar) => {
        const c = tileCenter(a.x, a.y);
        return (c.x - this.cam.x) ** 2 + (c.y - this.cam.y) ** 2;
      };
      walkers.sort((p, q) => d(p) - d(q)).length = maxAnim;
    }
    for (const a of walkers) this.animated.add(a);
    this.perf.visible = visible.length;
    list.sort((p, q) => p.k - q.k);
    for (const d of list) d.draw();

    // lights
    drawLights(ctx, t);

    // screen-space overlays
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const toS = (wx: number, wy: number) => ({ x: (wx - this.cam.x) * this.zoom + this.w / 2, y: (wy - this.cam.y) * this.zoom + this.h / 2 });

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    // zone tags
    ctx.font = `600 ${Math.round(10 + this.zoom * 1.5)}px ${this.pixelFont}`;
    for (const zt of ZONE_TAGS) {
      const c = tileCenter(zt.x, zt.y);
      const s = toS(c.x, c.y);
      ctx.globalAlpha = 0.85;
      const w = ctx.measureText(zt.text).width + 14;
      ctx.fillStyle = "rgba(6,8,26,0.65)";
      ctx.beginPath();
      ctx.roundRect(s.x - w / 2, s.y - 10, w, 20, 4);
      ctx.fill();
      ctx.fillStyle = zt.col;
      ctx.fillText(zt.text, s.x, s.y + 1);
    }
    ctx.globalAlpha = 1;

    // name tags, chat bubbles, typing, emotes: Habbo-style overlay (lib/portal/overlay.ts)
    visible.sort((p, q) => Number(!!p.me) - Number(!!q.me) || p.x + p.y - (q.x + q.y));
    const now = performance.now();
    const ov: OvAvatar[] = [];
    for (const a of visible) {
      const c = tileCenter(a.x, a.y);
      const sat = a.seat >= 0 && !a.moving ? SEATS[a.seat] : null;
      const head = toS(c.x, c.y - avatarTop(a.look, a.npc) + (sat ? 8 - sat.lift : 0));
      const tl = toS(c.x - AV_AX, c.y - AV_AY);
      const lvl = a.me ? this.speaking.get("me") || 0 : this.speaking.get(a.id) || 0;
      let emote: OvAvatar["emote"] = null;
      if (a.emote) {
        const age = (now - a.emote.t0) / 1800;
        if (age > 1) a.emote = null;
        else emote = { e: EMOTES[a.emote.e], age };
      }
      ov.push({
        id: a.id, name: a.name, me: a.me, npc: !!a.npc, admin: a.admin, role: a.role, mic: a.mic, talking: lvl > 0.04, head,
        rect: { x: tl.x, y: tl.y, w: AV_W * this.zoom, h: AV_AY * this.zoom },
        icon: () => avatarFrame(a.look, DIR_S, 0, a.npc), emote,
        iconCrop: { sy: AV_AY - avatarTop(a.look, a.npc), sh: 34 },
      });
    }
    // NPC sorting first keeps the player's own tag on top
    ov.sort((p, q) => Number(!!q.npc) - Number(!!p.npc));
    this.overlay.font = this.pixelFont;
    this.overlay.draw(ctx, this.w, this.h, ov, now);

    // vignette
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawAvatar(a: Avatar, cx: number, cy: number, t: number) {
    const ctx = this.ctx;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const lvl = a.me ? this.speaking.get("me") || 0 : this.speaking.get(a.id) || 0;
    if (lvl > 0.04) {
      ctx.strokeStyle = `rgba(93,255,154,${Math.min(1, 0.4 + lvl * 4)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11 + lvl * 20, 5 + lvl * 9, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const st = a.seat >= 0 && !a.moving ? SEATS[a.seat] : null;
    if (st) {
      a.dir = st.dir;
      cy -= st.lift;
      // sit a little forward on the seat (away from the backrest)
      const f = SIT_FWD[st.dir];
      if (f) {
        cx += f[0];
        cy += f[1];
      }
    }
    const frame = st ? FRAME_SIT : a.moving && (a.me || this.animated.has(a)) ? 1 + (Math.floor(a.walkT * 8) % 4) : 0;
    // over the per-frame render budget: walk frame -> idle frame -> any cached frame of the look -> render anyway
    const spr =
      (frame ? avatarFrame(a.look, a.dir, frame, a.npc, !!a.me) : null) ||
      avatarFrame(a.look, a.dir, 0, a.npc, !!a.me) ||
      anyAvatarFrame(a.look, a.npc) ||
      avatarFrame(a.look, a.dir, 0, a.npc)!;
    const bob = a.npc ? Math.round(Math.sin(t / 500 + a.x) * 1) : 0;
    blitSprite(ctx, spr, Math.round(cx - AV_AX), Math.round(cy - AV_AY + bob));
    if (a.npc === "oracle") {
      // floating sparkles around the oracle
      for (let i = 0; i < 4; i++) {
        const ang = t / 700 + (i * Math.PI) / 2;
        ctx.fillStyle = i % 2 ? "#7cf3ff" : "#ffd700";
        ctx.fillRect(Math.round(cx + Math.cos(ang) * 13), Math.round(cy - 22 + Math.sin(ang * 1.3) * 8), 1, 1);
      }
    }
  }
}

