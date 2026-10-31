// Habbo-style screen-space overlay: rising chat bubbles, "…" typing bubbles, name tags, emotes,
// plus avatar hit-testing for hover/click. The engine feeds it one OvAvatar per visible avatar per frame.
import { AV_H, AV_W, type SpriteRef } from "./avatar";

export type OvAvatar = {
  id: string;
  name: string;
  me?: boolean;
  npc?: boolean;
  admin?: boolean;
  /** server role: "host" (the Mago) / "admin" get a badge on the name tag */
  role?: string;
  mic?: boolean;
  talking?: boolean;
  /** screen point just above the head */
  head: { x: number; y: number };
  /** screen-space bounding box of the sprite, for picking */
  rect: { x: number; y: number; w: number; h: number };
  /** resolves the idle sprite (atlas frame) at draw time, used to cut the tiny head icon */
  icon?: () => SpriteRef | null;
  /** sprite rows holding the head (from avatarTop), for the bubble icon */
  iconCrop?: { sy: number; sh: number };
  /** emoji + 0..1 age, or null */
  emote?: { e: string; age: number } | null;
};

type Variant = "me" | "npc" | "admin" | "user";
type Bubble = {
  id: string;
  name: string;
  text: string;
  variant: Variant;
  born: number;
  lines: string[];
  w: number;
  h: number;
  x: number;
  y: number;
  ty: number;
  spawnTy: number;
  tailX: number;
  icon?: OvAvatar["icon"];
  crop?: OvAvatar["iconCrop"];
  placed: boolean;
};

const LIFE = 13000; // ms a bubble lives
const FADE = 900;
const DRIFT_MS = 3800; // idle rise cadence
const GAP = 3;
const ICON = 16;
const PAD_X = 6;
const FILL: Record<Variant, string> = { me: "#dce9ff", npc: "#fff2c2", admin: "#fffbea", user: "#ffffff" };
const EDGE: Record<Variant, string> = { me: "#0a2a66", npc: "#5a4300", admin: "#5a4300", user: "#1a1a22" };

export function rankOf(a: { admin?: boolean; npc?: boolean; role?: string }) {
  if (a.npc) return "Mago";
  if (a.role === "host") return "O Mago";
  return a.admin ? "Arquimago" : "Aprendiz";
}

export class Overlay {
  font = "Pixelify Sans, monospace";
  hoverId: string | null = null;
  /** head icon for a speaker that is not in this frame's visible list */
  iconFor?: (id: string) => Pick<OvAvatar, "icon" | "iconCrop"> | null;
  selectedId: string | null = null;
  private bubbles: Bubble[] = [];
  private typing = new Map<string, number>();
  private rects: { id: string; x: number; y: number; w: number; h: number; npc?: boolean }[] = [];
  private lastDrift = 0;
  private lastT = 0;

  say(id: string, name: string, text: string, variant: Variant = "user") {
    this.typing.delete(id);
    this.bubbles.push({
      id, name, text, variant, born: performance.now(), lines: [], w: 0, h: 0, x: 0, y: 0, ty: 0, spawnTy: 0, tailX: 0, placed: false,
    });
    if (this.bubbles.length > 40) this.bubbles.splice(0, this.bubbles.length - 40);
  }

  setTyping(id: string, on: boolean) {
    if (on) this.typing.set(id, performance.now() + 4500);
    else this.typing.delete(id);
  }

  clear() {
    this.bubbles = [];
  }

  /** Topmost avatar under a screen point (uses last frame's rects). */
  pick(sx: number, sy: number): string | null {
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return r.id;
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, avs: OvAvatar[], now: number) {
    const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    // hit rects: nearer avatars (later in list) win
    this.rects = avs.map((a) => ({ id: a.id, npc: a.npc, ...a.rect }));
    const byId = new Map(avs.map((a) => [a.id, a]));
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.imageSmoothingEnabled = false;

    // ---- name tags, typing, emotes (under the chat log)
    for (const a of avs) {
      const showTag = a.me || a.npc || a.role === "host" || a.id === this.hoverId || a.id === this.selectedId;
      let top = a.head.y;
      if (showTag) top = this.nameTag(ctx, a) - 4;
      const tu = this.typing.get(a.id);
      if (tu && tu > now) top = this.typingBubble(ctx, a.head.x, top, now) - 4;
      else if (tu) this.typing.delete(a.id);
      if (a.emote) {
        const { e, age } = a.emote;
        ctx.globalAlpha = 1 - age * age;
        ctx.textAlign = "center";
        ctx.font = `${22 + Math.sin(age * 9) * 2}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.fillText(e, a.head.x + 20, top - 10 - age * 30);
        ctx.globalAlpha = 1;
      }
    }

    // ---- rising chat log
    const maxW = w < 480 ? Math.min(200, w - 40) : 260;
    const fresh = this.bubbles.filter((b) => !b.placed);
    for (const b of fresh) this.place(ctx, b, byId.get(b.id), w, h, maxW);
    if (fresh.length) this.lastDrift = now;
    else if (now - this.lastDrift > DRIFT_MS && this.bubbles.length) {
      this.lastDrift = now;
      for (const b of this.bubbles) b.ty -= 24;
    }
    const k = Math.min(1, dt * 9);
    this.bubbles = this.bubbles.filter((b) => {
      b.y += (b.ty - b.y) * k;
      const age = now - b.born;
      return age < LIFE + FADE && b.y + b.h > -10;
    });
    for (const b of this.bubbles) this.bubble(ctx, b, now);
    ctx.restore();
  }

  // ------------------------------------------------------------ pieces
  private place(ctx: CanvasRenderingContext2D, b: Bubble, a: OvAvatar | undefined, w: number, h: number, maxW: number) {
    ctx.font = `700 12px ${this.font}`;
    const nameW = ctx.measureText(b.name + ": ").width;
    ctx.font = `500 12px ${this.font}`;
    b.lines = wrap(ctx, b.text, maxW, nameW);
    const tw = Math.max(nameW + ctx.measureText(b.lines[0]).width, ...b.lines.slice(1).map((l) => ctx.measureText(l).width));
    b.w = Math.ceil(PAD_X * 2 + ICON + 5 + tw);
    b.h = 8 + Math.max(ICON, b.lines.length * 14);
    // speaker off screen: still show their head (resolved from the engine's avatar list)
    const off = a ? null : this.iconFor?.(b.id);
    b.icon = a?.icon || off?.icon;
    b.crop = a?.iconCrop || off?.iconCrop;
    const sx = a ? a.head.x : w / 2;
    const sy = a ? a.head.y : h * 0.45;
    b.x = Math.round(Math.max(6, Math.min(w - b.w - 6, sx - b.w / 2)));
    b.tailX = Math.max(b.x + 8, Math.min(b.x + b.w - 8, sx));
    // spawn a little above the head (name tag room), clamped to the visible stage
    b.ty = b.spawnTy = Math.round(Math.max(8, Math.min(h - 130, sy - 30 - b.h)));
    b.y = b.ty + 6;
    b.placed = true;
    // Habbo rows: every older bubble must sit fully above the next newer one, so the newcomer
    // pushes the whole log up and the order on screen is always chronological (newest lowest).
    let limit = b.ty;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const o = this.bubbles[i];
      if (o === b || !o.placed) continue;
      o.ty = Math.min(o.ty, limit - o.h - GAP);
      limit = o.ty;
    }
  }

  private bubble(ctx: CanvasRenderingContext2D, b: Bubble, now: number) {
    const age = now - b.born;
    const fadeTop = Math.min(1, Math.max(0, (b.y + b.h) / 40));
    const alpha = Math.min(1, age / 140, (LIFE + FADE - age) / FADE, fadeTop);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const x = b.x, y = Math.round(b.y), bw = b.w, bh = b.h;
    // outline + drop shadow, chunky like Habbo
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    pixRect(ctx, x + 1, y + 2, bw, bh);
    ctx.fillStyle = EDGE[b.variant];
    pixRect(ctx, x - 1, y - 1, bw + 2, bh + 2);
    ctx.fillStyle = FILL[b.variant];
    pixRect(ctx, x, y, bw, bh);
    // top highlight
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(x + 3, y + 1, bw - 6, 1);
    // tail while still at the speaker's row
    if (Math.abs(b.ty - b.spawnTy) < 1 && Math.abs(b.y - b.ty) < 2) {
      const tx = Math.round(b.tailX);
      ctx.fillStyle = EDGE[b.variant];
      ctx.fillRect(tx - 4, y + bh, 9, 2);
      ctx.fillRect(tx - 3, y + bh + 2, 7, 2);
      ctx.fillRect(tx - 1, y + bh + 4, 3, 2);
      ctx.fillStyle = FILL[b.variant];
      ctx.fillRect(tx - 3, y + bh - 1, 7, 2);
      ctx.fillRect(tx - 2, y + bh + 1, 5, 2);
      ctx.fillRect(tx, y + bh + 3, 1, 1);
    }
    // head icon
    const ix = x + PAD_X, iy = y + Math.round((bh - ICON) / 2);
    const spr = b.icon?.();
    if (spr) {
      const sw = AV_W;
      const sy = b.crop ? Math.max(0, b.crop.sy) : 0;
      const sh = b.crop ? Math.min(b.crop.sh, AV_H - sy) : Math.round(AV_H * 0.42);
      const s = ICON / Math.max(sw, sh);
      const dw = Math.round(sw * s), dh = Math.round(sh * s);
      ctx.drawImage(spr.img, spr.sx, spr.sy + sy, sw, sh, ix + Math.round((ICON - dw) / 2), iy + ICON - dh, dw, dh);
    } else {
      ctx.fillStyle = "#0066ff";
      ctx.fillRect(ix + 3, iy + 3, ICON - 6, ICON - 6);
    }
    // "Nome: mensagem"
    const tx0 = ix + ICON + 5;
    const ty0 = y + 4 + 7 + Math.max(0, Math.round((ICON - b.lines.length * 14) / 2));
    ctx.textAlign = "left";
    ctx.fillStyle = "#101018";
    ctx.font = `700 12px ${this.font}`;
    const label = b.name + ": ";
    ctx.fillText(label, tx0, ty0);
    const nw = ctx.measureText(label).width;
    ctx.font = `500 12px ${this.font}`;
    b.lines.forEach((l, i) => ctx.fillText(l, i === 0 ? tx0 + nw : tx0, ty0 + i * 14));
    ctx.globalAlpha = 1;
  }

  /** Returns the top y of the tag. */
  private nameTag(ctx: CanvasRenderingContext2D, a: OvAvatar) {
    ctx.font = `600 11px ${this.font}`;
    const label = a.name;
    const tw = ctx.measureText(label).width;
    const badge = a.npc ? "" : a.role === "host" ? "MAGO" : a.role === "admin" ? "ADMIN" : "";
    ctx.font = `700 9px ${this.font}`;
    const bw = badge ? Math.ceil(ctx.measureText(badge).width) + 8 : 0;
    ctx.font = `600 11px ${this.font}`;
    const w = Math.ceil(tw + 12 + (a.npc ? 0 : 8) + (a.mic && !a.npc ? 8 : 0) + (bw ? bw + 4 : 0));
    const hgt = 16;
    const x = Math.round(a.head.x - w / 2), y = Math.round(a.head.y - hgt);
    const sel = a.id === this.selectedId;
    ctx.fillStyle = sel ? "#ffd700" : "#000000";
    pixRect(ctx, x - 1, y - 1, w + 2, hgt + 2);
    ctx.fillStyle = a.me ? "#0066ff" : a.npc ? "#4a3800" : "rgba(14,16,30,0.92)";
    pixRect(ctx, x, y, w, hgt);
    let cx = x + 6;
    if (!a.npc) {
      ctx.fillStyle = a.talking ? "#5dff9a" : "#3ddc84";
      const r = a.talking ? 3 : 2;
      ctx.fillRect(cx, y + hgt / 2 - r, r * 2 - 1, r * 2 - 1);
      cx += 8;
    }
    ctx.textAlign = "left";
    ctx.fillStyle = a.npc || a.admin ? "#ffd700" : "#ffffff";
    ctx.fillText(label, cx, y + hgt / 2 + 1);
    if (a.mic && !a.npc) {
      const mx = cx + tw + 3;
      ctx.fillStyle = a.talking ? "#5dff9a" : "rgba(255,255,255,0.65)";
      ctx.fillRect(mx + 1, y + 4, 3, 6);
      ctx.fillRect(mx, y + 10, 5, 1);
      ctx.fillRect(mx + 2, y + 11, 1, 2);
    }
    if (badge) {
      const bx = x + w - bw - 3;
      ctx.fillStyle = badge === "MAGO" ? "#ffd700" : "#e8283c";
      pixRect(ctx, bx, y + 3, bw, hgt - 6);
      ctx.fillStyle = badge === "MAGO" ? "#3a2a00" : "#ffffff";
      ctx.font = `700 9px ${this.font}`;
      ctx.fillText(badge, bx + 4, y + hgt / 2 + 1);
      ctx.font = `600 11px ${this.font}`;
    }
    return y - 1;
  }

  /** Returns the top y of the typing bubble. */
  private typingBubble(ctx: CanvasRenderingContext2D, cx: number, bottom: number, now: number) {
    const w = 28, hgt = 15;
    const x = Math.round(cx - w / 2), y = Math.round(bottom - hgt - 4);
    ctx.fillStyle = "#1a1a22";
    pixRect(ctx, x - 1, y - 1, w + 2, hgt + 2);
    ctx.fillStyle = "#ffffff";
    pixRect(ctx, x, y, w, hgt);
    ctx.fillStyle = "#1a1a22";
    ctx.fillRect(Math.round(cx) - 3, y + hgt + 1, 7, 1);
    ctx.fillRect(Math.round(cx) - 2, y + hgt + 2, 5, 1);
    ctx.fillRect(Math.round(cx) - 1, y + hgt + 3, 3, 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(cx) - 2, y + hgt, 5, 1);
    ctx.fillRect(Math.round(cx) - 1, y + hgt + 1, 3, 1);
    const step = Math.floor(now / 300) % 4;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < step ? "#1a1a22" : "#b8b8c4";
      ctx.fillRect(x + 7 + i * 6, y + 6, 3, 3);
    }
    return y;
  }
}

/** Rounded rectangle with 2px pixel corners (Habbo bubble shape). */
function pixRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillRect(x, y + 2, w, h - 4);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, firstIndent: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  const lim = () => (lines.length ? max : max - firstIndent);
  for (const wd of words) {
    const test = cur ? cur + " " + wd : wd;
    if (ctx.measureText(test).width > lim() && cur) {
      lines.push(cur);
      cur = wd;
    } else cur = test;
    while (ctx.measureText(cur).width > lim() && cur.length > 6) {
      let i = cur.length - 1;
      while (i > 1 && ctx.measureText(cur.slice(0, i)).width > lim()) i--;
      lines.push(cur.slice(0, i));
      cur = cur.slice(i);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = lines[2].replace(/.{0,2}$/, "…");
  }
  return lines.length ? lines : [""];
}
