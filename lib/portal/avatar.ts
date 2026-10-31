// Habbo-style procedural pixel avatars for the Salão do Grimório.
// Everything is drawn in code into a pixel buffer (pure, no DOM), then wrapped in a cached canvas.
// Sprite: AV_W x AV_H, feet anchor at (AV_AX, AV_AY). 8 facing directions, idle + 4-frame walk + sit.

export type Look = {
  skin: number;
  hair: number;
  hairStyle: number;
  shirt: number;
  hat: number;
  /** top style (camiseta, manga longa, jaqueta, moletom, regata) */
  top?: number;
  pants?: number;
  shoes?: number;
  glasses?: number;
  /** bottom style (calça, bermuda, saia) */
  bottom?: number;
};

export const SKINS = ["#ffe0c4", "#f6cfa8", "#eab48a", "#d99a6c", "#c08055", "#a46a44", "#8a5434", "#6e4026", "#56301b", "#3e2214"];
export const HAIRS = [
  "#2a1d16", "#4a2c1a", "#7a4622", "#a8692e", "#d8a24a", "#f0d27a", "#e8e2d4", "#8c8c94",
  "#b23a2e", "#e0613a", "#2f5bd8", "#7a3fd0", "#d64aa0", "#2fae6a", "#18c0c8", "#f2f2f2",
];
export const SHIRTS = [
  "#0066ff", "#2b3a6b", "#ffd700", "#e8442e", "#2fae6a", "#7a3fd0", "#f07ab0", "#f28c28",
  "#18c0c8", "#efefef", "#33363d", "#8b5a2b", "#c2e04a", "#b0123a", "#5a6b85", "#111216",
];
export const PANTS = ["#2a3a66", "#4a78c0", "#22232b", "#6b5a45", "#c8b48a", "#5a6b85", "#8a1f2a", "#2f6b3e", "#e8e2d4", "#5a2f8a"];
export const SHOES: { c: string; sole: string }[] = [
  { c: "#2a2a33", sole: "#f0f0f4" },
  { c: "#f2f2f4", sole: "#b9bcc6" },
  { c: "#6b3e1f", sole: "#2e1c10" },
  { c: "#e8442e", sole: "#f0f0f4" },
  { c: "#2f5bd8", sole: "#f0f0f4" },
  { c: "#ffd700", sole: "#3b2414" },
  { c: "#16161c", sole: "#16161c" },
  { c: "#7a3fd0", sole: "#f0f0f4" },
];
export const HAIR_STYLES = ["Curto", "Longo", "Espetado", "Coque", "Black power", "Careca", "Topete", "Rabo de cavalo", "Moicano", "Franjão", "Chanel", "Maria-chiquinha"];
export const HATS = ["Nenhum", "Chapéu de Mago", "Chapéu Roxo", "Boné", "Gorro", "Coroa", "Cartola", "Fones", "Bandana"];
export const TOPS = ["Camiseta", "Manga longa", "Jaqueta", "Moletom", "Regata", "Camisa", "Listrada"];
export const BOTTOMS = ["Calça", "Bermuda", "Saia"];
export const GLASSES = ["Nenhum", "Óculos", "Óculos escuros", "Óculos 3D"];

export const DEFAULT_LOOK: Look = { skin: 2, hair: 0, hairStyle: 0, shirt: 0, hat: 1, top: 0, pants: 0, shoes: 1, glasses: 0, bottom: 0 };

/** Fill optional fields and clamp indices, so old saved looks (5 fields) keep working. */
export function normLook(l: Partial<Look> | null | undefined): Required<Look> {
  const i = (v: unknown, n: number, d = 0) => {
    const k = Math.round(Number(v));
    return Number.isFinite(k) ? Math.min(n - 1, Math.max(0, k)) : d;
  };
  return {
    skin: i(l?.skin, SKINS.length, 2),
    hair: i(l?.hair, HAIRS.length),
    hairStyle: i(l?.hairStyle, HAIR_STYLES.length),
    shirt: i(l?.shirt, SHIRTS.length),
    hat: i(l?.hat, HATS.length),
    top: i(l?.top, TOPS.length),
    pants: i(l?.pants, PANTS.length),
    shoes: i(l?.shoes, SHOES.length),
    glasses: i(l?.glasses, GLASSES.length),
    bottom: i(l?.bottom, BOTTOMS.length),
  };
}

export function randomLook(rnd: () => number = Math.random): Look {
  const r = (n: number) => Math.floor(rnd() * n);
  const hs = rnd() < 0.08 ? 5 : r(HAIR_STYLES.length);
  return {
    skin: r(SKINS.length),
    hair: r(rnd() < 0.7 ? 8 : HAIRS.length), // mostly natural colours
    hairStyle: hs,
    shirt: r(SHIRTS.length),
    hat: rnd() < 0.45 ? 0 : r(HATS.length),
    top: r(TOPS.length),
    pants: r(PANTS.length),
    shoes: r(SHOES.length),
    glasses: rnd() < 0.7 ? 0 : 1 + r(GLASSES.length - 1),
    bottom: rnd() < 0.7 ? 0 : 1 + r(BOTTOMS.length - 1),
  };
}

// ---------------------------------------------------------------- geometry
export const AV_W = 44;
export const AV_H = 88;
export const AV_AX = 22; // anchor x (feet centre)
export const AV_AY = 86; // anchor y (ground line under the shoes)
/** Pixels from the feet up to the top of the head (no hat). */
export const AV_HEAD = 64;

/** Directions in screen space: 0=E 1=SE 2=S 3=SW 4=W 5=NW 6=N 7=NE. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const DIR_S = 2 as Dir;
/** Direction from a screen-space delta (iso tile axes map to the 3/4 diagonals). */
export function dirFromScreen(sdx: number, sdy: number): Dir {
  const a = Math.atan2(sdy, sdx);
  return ((Math.round(a / (Math.PI / 4)) + 8) % 8) as Dir;
}
/** Frames: 0 idle, 1..4 walk, 5 sit. */
export const FRAME_SIT = 5;
export type NpcKind = "plaque" | "oracle";

/** Height above the feet of the top of the sprite's head/hat (for name tags). */
export function avatarTop(look: Look, extra?: NpcKind) {
  const l = normLook(look);
  const hat = extra === "plaque" ? 1 : extra === "oracle" ? 0 : l.hat;
  if (extra === "oracle") return AV_HEAD + 4;
  if (hat === 1 || hat === 2) return AV_HEAD + 20;
  if (hat === 6) return AV_HEAD + 12;
  if (hat === 5) return AV_HEAD + 7;
  if (l.hairStyle === 4 || l.hairStyle === 2 || l.hairStyle === 6 || l.hairStyle === 8 || l.hairStyle === 3) return AV_HEAD + 6;
  return AV_HEAD + 3;
}

// ---------------------------------------------------------------- colour utils
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
const packCache = new Map<string, number>();
function pack(hex: string) {
  let v = packCache.get(hex);
  if (v === undefined) {
    const n = parseInt(hex.slice(1), 16);
    v = ((255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0; // ABGR (little-endian RGBA)
    packCache.set(hex, v);
  }
  return v;
}

const OUTLINE = "#0b0a10";

// ---------------------------------------------------------------- raster
class Raster {
  d = new Uint32Array(AV_W * AV_H);
  get(x: number, y: number) {
    return x < 0 || y < 0 || x >= AV_W || y >= AV_H ? 0 : this.d[y * AV_W + x];
  }
  set(x: number, y: number, col: string) {
    if (x < 0 || y < 0 || x >= AV_W || y >= AV_H) return;
    this.d[y * AV_W + x] = pack(col);
  }
  rect(x: number, y: number, w: number, h: number, col: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, col);
  }
  /** 1px dark outline around everything opaque (4-neighbour). */
  outline() {
    const o = pack(OUTLINE);
    const src = this.d.slice();
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= AV_W || y >= AV_H ? 0 : src[y * AV_W + x]);
    for (let y = 0; y < AV_H; y++)
      for (let x = 0; x < AV_W; x++) {
        if (src[y * AV_W + x]) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) this.d[y * AV_W + x] = o;
      }
  }
  mirror() {
    for (let y = 0; y < AV_H; y++) {
      const row = this.d.subarray(y * AV_W, (y + 1) * AV_W);
      row.reverse();
    }
    // keep the anchor stable: AV_W even and AX = W/2, so a plain reverse shifts by one column
    for (let y = 0; y < AV_H; y++) {
      const o = y * AV_W;
      for (let x = AV_W - 1; x > 0; x--) this.d[o + x] = this.d[o + x - 1];
      this.d[o] = 0;
    }
  }
}

/** A shape mask that gets painted with automatic edge shading. */
class Mask {
  m = new Uint8Array(AV_W * AV_H);
  has(x: number, y: number) {
    return x >= 0 && y >= 0 && x < AV_W && y < AV_H && this.m[y * AV_W + x] === 1;
  }
  add(x: number, y: number) {
    if (x >= 0 && y >= 0 && x < AV_W && y < AV_H) this.m[y * AV_W + x] = 1;
    return this;
  }
  del(x: number, y: number) {
    if (x >= 0 && y >= 0 && x < AV_W && y < AV_H) this.m[y * AV_W + x] = 0;
    return this;
  }
  rect(x: number, y: number, w: number, h: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.add(x + i, y + j);
    return this;
  }
  /** rows given as [y, x0, x1] inclusive */
  rows(rs: [number, number, number][]) {
    for (const [y, a, b] of rs) for (let x = a; x <= b; x++) this.add(x, y);
    return this;
  }
  /** a slanted limb: top centre (x,y), width w, length h, horizontal drift dx at the bottom */
  limb(x: number, y: number, w: number, h: number, dx: number) {
    for (let j = 0; j < h; j++) {
      const o = Math.round((dx * j) / Math.max(1, h - 1));
      for (let i = 0; i < w; i++) this.add(x + o + i, y + j);
    }
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = (x - cx) / (rx + 0.35), v = (y - cy) / (ry + 0.35);
        if (u * u + v * v <= 1) this.add(x, y);
      }
    return this;
  }
  each(fn: (x: number, y: number) => void) {
    for (let y = 0; y < AV_H; y++) for (let x = 0; x < AV_W; x++) if (this.m[y * AV_W + x]) fn(x, y);
  }
}

type PaintOpt = { light?: number; dark?: number; sep?: boolean; darkRight?: number; lightLeft?: boolean };

/** Paint a mask: top/left edges lit, right/bottom edges darker, optional separator line where it overlaps earlier paint. */
function paint(r: Raster, m: Mask, base: string, o: PaintOpt = {}) {
  const lt = shade(base, o.light ?? 0.2);
  const dk = shade(base, o.dark ?? -0.22);
  const sepC = shade(base, -0.5);
  const dr = o.darkRight ?? 2;
  const before = o.sep ? r.d.slice() : null;
  m.each((x, y) => {
    let col = base;
    let right = false;
    for (let k = 1; k <= dr; k++) if (!m.has(x + k, y)) right = true;
    if (!m.has(x, y + 1) || right) col = dk;
    else if (!m.has(x, y - 1) || ((o.lightLeft ?? true) && !m.has(x - 1, y))) col = lt;
    if (before) {
      const nb = (xx: number, yy: number) =>
        !m.has(xx, yy) && xx >= 0 && yy >= 0 && xx < AV_W && yy < AV_H && before[yy * AV_W + xx] !== 0;
      if (nb(x - 1, y) || nb(x + 1, y) || nb(x, y + 1)) col = sepC;
    }
    r.set(x, y, col);
  });
}

// ---------------------------------------------------------------- views
type View = "front" | "q3" | "side" | "q3b" | "back";
/** dir -> [view, mirrored] (views are drawn facing right, then mirrored for the left-facing ones) */
const VIEWS: [View, boolean][] = [
  ["side", false], // 0 E
  ["q3", false], // 1 SE
  ["front", false], // 2 S
  ["q3", true], // 3 SW
  ["side", true], // 4 W
  ["q3b", true], // 5 NW
  ["back", false], // 6 N
  ["q3b", false], // 7 NE
];

type Geo = {
  head: [number, number];
  torso: [number, number];
  neck: [number, number];
  /** arms: x of arm's left column, width, layer (behind torso / in front), dimmed (far side) */
  arms: { x: number; w: number; front: boolean; far: boolean; sw: number }[];
  legs: { x: number; w: number; far: boolean; sw: number }[];
  /** shoe extension toward facing (+x) */
  toe: number;
};

const GEO: Record<View, Geo> = {
  front: {
    head: [11, 32],
    torso: [14, 29],
    neck: [19, 24],
    arms: [
      { x: 10, w: 4, front: true, far: false, sw: 1 },
      { x: 30, w: 4, front: true, far: false, sw: -1 },
    ],
    legs: [
      { x: 15, w: 7, far: false, sw: 1 },
      { x: 22, w: 7, far: false, sw: -1 },
    ],
    toe: 0,
  },
  back: {
    head: [11, 32],
    torso: [14, 29],
    neck: [19, 24],
    arms: [
      { x: 10, w: 4, front: true, far: false, sw: 1 },
      { x: 30, w: 4, front: true, far: false, sw: -1 },
    ],
    legs: [
      { x: 15, w: 7, far: false, sw: 1 },
      { x: 22, w: 7, far: false, sw: -1 },
    ],
    toe: 0,
  },
  q3: {
    head: [12, 33],
    torso: [15, 28],
    neck: [20, 25],
    arms: [
      { x: 27, w: 4, front: false, far: true, sw: -1 },
      { x: 12, w: 4, front: true, far: false, sw: 1 },
    ],
    legs: [
      { x: 22, w: 6, far: true, sw: -1 },
      { x: 16, w: 7, far: false, sw: 1 },
    ],
    toe: 2,
  },
  q3b: {
    head: [12, 33],
    torso: [15, 28],
    neck: [19, 24],
    arms: [
      { x: 12, w: 4, front: false, far: true, sw: 1 },
      { x: 28, w: 4, front: true, far: false, sw: -1 },
    ],
    legs: [
      { x: 16, w: 6, far: true, sw: 1 },
      { x: 21, w: 7, far: false, sw: -1 },
    ],
    toe: 1,
  },
  side: {
    head: [13, 33],
    torso: [17, 27],
    neck: [20, 24],
    arms: [
      { x: 20, w: 4, front: false, far: true, sw: -1 },
      { x: 19, w: 4, front: true, far: false, sw: 1 },
    ],
    legs: [
      { x: 19, w: 6, far: true, sw: -1 },
      { x: 18, w: 7, far: false, sw: 1 },
    ],
    toe: 3,
  },
};

// vertical layout (standing)
const HEAD_Y = AV_AY - AV_HEAD; // 24: top row of the head
const HEAD_H = 23;
const SHOULDER_Y = HEAD_Y + 23; // 45
const HIP_Y = HEAD_Y + 43; // 65
const SHOE_Y = AV_AY - 5; // 81

const WALK: { s: number; bob: number }[] = [
  { s: 0, bob: 0 }, // idle
  { s: 1, bob: 0 },
  { s: 0, bob: -1 },
  { s: -1, bob: 0 },
  { s: 0, bob: -1 },
];

// ---------------------------------------------------------------- the avatar
type Ctx = {
  r: Raster;
  view: View;
  g: Geo;
  l: Required<Look>;
  skin: string;
  hair: string;
  s: number; // stride -1..1
  by: number; // body y offset (bob / sit)
  sit: boolean;
  npc?: NpcKind;
};

function headRows(c: Ctx, y0: number) {
  const [a, b] = c.g.head;
  const rows: [number, number, number][] = [];
  const topIn = [5, 3, 2, 1, 1];
  const botIn = [1, 1, 2, 3, 5];
  for (let j = 0; j < HEAD_H; j++) {
    const i = j < topIn.length ? topIn[j] : j >= HEAD_H - botIn.length ? botIn[j - (HEAD_H - botIn.length)] : 0;
    let lo = a + i;
    const hi = b - i;
    // 3/4 + side: the chin sits toward the face
    if ((c.view === "q3" || c.view === "side") && j >= HEAD_H - 4) lo += j - (HEAD_H - 5);
    if (c.view === "q3b" && j >= HEAD_H - 4) lo += 1;
    rows.push([y0 + j, lo, hi]);
  }
  return rows;
}

function drawLegs(c: Ctx) {
  const { r, g, l, s, by } = c;
  const pants = PANTS[l.pants];
  const shoe = SHOES[l.shoes];
  const vert = c.view === "front" || c.view === "back";
  const legTop = HIP_Y + by;
  const bottom = c.npc ? 0 : l.bottom;
  const skinFrom = bottom === 1 ? legTop + 8 : bottom === 2 ? legTop + 3 : 999;
  const bare = (m: Mask, far: boolean) => {
    if (skinFrom > 900) return;
    const sk = new Mask();
    m.each((x, y) => { if (y >= skinFrom) sk.add(x, y); });
    paint(r, sk, far ? shade(c.skin, -0.15) : c.skin, { darkRight: 1, sep: !far });
    if (bottom === 1) for (let x = 0; x < AV_W; x++) if (sk.has(x, skinFrom)) r.set(x, skinFrom, shade(pants, -0.3)); // cuff
  };
  const sorted = [...g.legs].sort((p, q) => Number(!p.far) - Number(!q.far));
  for (const leg of sorted) {
    const m = new Mask();
    const col = leg.far ? shade(pants, -0.18) : pants;
    let dx = 0, footY = SHOE_Y, len = SHOE_Y - legTop;
    if (c.sit) {
      // thigh toward the facing, shin straight down
      if (vert) {
        len = SHOE_Y - legTop;
        m.rect(leg.x, legTop, leg.w, len);
        // knee highlight band
        paint(r, m, col, { sep: true });
        const kneeY = legTop + 2;
        r.rect(leg.x + 1, kneeY, leg.w - 2, 1, shade(col, 0.28));
        bare(m, leg.far);
      } else {
        const fwd = c.view === "q3b" ? 5 : 8;
        m.rect(leg.x, legTop, leg.w + fwd, 5);
        m.rect(leg.x + fwd, legTop, leg.w, SHOE_Y - legTop);
        paint(r, m, col, { sep: !leg.far });
        bare(m, leg.far);
        dx = fwd;
      }
    } else {
      if (vert) {
        // stride shows as one foot lower/closer, the other lifted
        const st = s * leg.sw;
        if (st > 0) footY += 1;
        if (st < 0) footY -= 2;
        len = footY - legTop;
      } else {
        dx = Math.round(3 * s * leg.sw);
      }
      m.limb(leg.x, legTop, leg.w, len, dx);
      paint(r, m, col, { sep: !leg.far && !vert });
      bare(m, leg.far);
    }
    // shoe
    const sx = leg.x + dx - (vert ? 1 : 0);
    const sw = leg.w + (vert ? 1 : 0) + g.toe;
    const sm = new Mask().rect(sx, footY, sw, 5);
    sm.del(sx, footY).del(sx + sw - 1, footY);
    if (!vert && g.toe) sm.del(sx + sw - 1, footY + 1).del(sx + sw - 2, footY); // rounded toe
    const scol = leg.far ? shade(shoe.c, -0.15) : shoe.c;
    paint(r, sm, scol, { light: 0.3, sep: true, darkRight: 1 });
    r.rect(sx, footY + 4, sw, 1, shoe.sole);
    r.rect(sx + 1, footY + 1, Math.max(1, sw - 3), 1, shade(scol, 0.35)); // laces/top highlight
    if (!vert && g.toe) r.set(sx + sw - 1, footY + 4, OUTLINE);
  }
  if (c.view === "front" || c.view === "back") {
    // gap line between the legs, below the crotch
    if (!c.sit) for (let y = legTop + 5; y < Math.min(SHOE_Y - 1, skinFrom); y++) r.set(22, y, shade(pants, -0.55));
  }
  if (bottom === 2) {
    // skirt: flared trapezoid over the hips
    const [t0, t1] = g.torso;
    const sk = new Mask();
    const sideSit = c.sit && !vert;
    const rowsN = c.sit ? 5 : 9;
    for (let k = 0; k < rowsN; k++) {
      const f = Math.floor(k / 3);
      sk.rows([[legTop - 1 + k, t0 - f, t1 + f + (sideSit ? 7 : 0)]]);
    }
    paint(r, sk, pants, { sep: true, darkRight: 2 });
    for (let x = 0; x < AV_W; x++) if (sk.has(x, legTop - 2 + rowsN)) r.set(x, legTop - 2 + rowsN, shade(pants, -0.3));
  }
  // hips / waist block
  const [t0, t1] = g.torso;
  const hm = new Mask().rect(t0 + 1, legTop - 1, t1 - t0 - 1, 4);
  paint(r, hm, pants, { lightLeft: false, darkRight: 0, light: 0 });
}

function drawTorso(c: Ctx) {
  const { r, g, l, by } = c;
  const shirt = SHIRTS[l.shirt];
  const top = c.npc === "plaque" ? 1 : l.top;
  const [t0, t1] = g.torso;
  const y0 = SHOULDER_Y + by;
  const m = new Mask();
  m.rows([[y0, t0 + 2, t1 - 2], [y0 + 1, t0 + 1, t1 - 1]]);
  m.rect(t0, y0 + 2, t1 - t0 + 1, HIP_Y - SHOULDER_Y - 1);
  // 3/4 views: the hem follows the iso floor (2:1), lower on the back side like Habbo's box-shaped bodies
  const hemOff = (x: number) => (c.view === "q3" ? Math.max(-1, Math.min(3, Math.round((t0 + 6 - x) / 2))) : 0);
  if (c.view === "q3") for (let x = t0; x <= t1; x++) {
    const o = hemOff(x);
    for (let y = HIP_Y + by - 1; y < HIP_Y + by - 1 + o; y++) m.add(x, y);
    for (let y = HIP_Y + by - 1 + o; y < HIP_Y + by; y++) m.del(x, y);
  }
  paint(r, m, shirt, { darkRight: 3 });
  const front = c.view === "front" || c.view === "q3" || c.view === "side";
  const back = c.view === "back" || c.view === "q3b";
  const mid = Math.round((g.neck[0] + g.neck[1]) / 2) + (c.view === "q3" ? 1 : c.view === "side" ? 2 : 0);
  // stripes (listrada)
  if (top === 6) m.each((x, y) => { if ((y - y0) % 4 === 2 && m.has(x, y + 1)) r.set(x, y, shade(shirt, shirt === "#efefef" ? -0.35 : 0.42)); });
  // Habbo shading: the big head casts a dithered shadow across the shoulders
  const [ha, hb] = c.g.head;
  const shd = shade(shirt, -0.26);
  m.each((x, y) => {
    const k = y - y0;
    if (k > 3 || x < ha + 1 || x > hb - 1 || !m.has(x, y + 1)) return;
    if (k <= 1 ? (x + y) % 2 === 0 : k === 2 ? (x + y) % 4 === 0 : (x + 2 * y) % 6 === 0) r.set(x, y, shd);
  });
  // bottom hem
  for (let x = t0; x <= t1; x++) r.set(x, HIP_Y + by - 1 + hemOff(x), shade(shirt, -0.32));
  if (top === 2) {
    // open jacket over a white tee
    if (front && c.view !== "side") {
      const w = c.view === "front" ? 2 : 1;
      r.rect(mid - w, y0 + 1, w * 2, HIP_Y - SHOULDER_Y - 1, "#eceef4");
      r.rect(mid - w - 1, y0 + 1, 1, HIP_Y - SHOULDER_Y - 1, shade(shirt, -0.45));
      r.rect(mid + w, y0 + 1, 1, HIP_Y - SHOULDER_Y - 1, shade(shirt, -0.45));
      r.rect(mid - w - 3, y0 + 1, 2, 3, shade(shirt, 0.18)); // lapels
      r.rect(mid + w + 1, y0 + 1, 2, 3, shade(shirt, 0.08));
    } else if (c.view === "side") {
      r.rect(t1 - 2, y0 + 2, 2, HIP_Y - SHOULDER_Y - 3, "#eceef4");
    }
  } else if (top === 3) {
    // hoodie: pouch pocket + strings in front, hood on the back
    if (front && c.view !== "side") {
      const pw = c.view === "front" ? 10 : 8;
      const px = mid - pw / 2;
      r.rect(px, y0 + 10, pw, 6, shade(shirt, -0.12));
      r.rect(px, y0 + 10, pw, 1, shade(shirt, -0.35));
      r.set(mid - 2, y0 + 2, "#f2f2f2"); r.set(mid - 2, y0 + 3, "#f2f2f2"); r.set(mid - 2, y0 + 4, "#f2f2f2");
      r.set(mid + 1, y0 + 2, "#f2f2f2"); r.set(mid + 1, y0 + 3, "#f2f2f2"); r.set(mid + 1, y0 + 4, "#f2f2f2");
    }
    if (back) {
      const hm = new Mask().rows([
        [y0 - 1, mid - 5, mid + 5], [y0, mid - 6, mid + 6], [y0 + 1, mid - 6, mid + 6], [y0 + 2, mid - 5, mid + 5],
        [y0 + 3, mid - 4, mid + 4], [y0 + 4, mid - 3, mid + 3],
      ]);
      paint(r, hm, shade(shirt, -0.06), { sep: true });
    }
  } else if (top === 4) {
    // tank top: skin shoulders
    const sk = c.skin;
    r.rect(t0, y0, 3, 4, sk); r.rect(t1 - 2, y0, 3, 4, shade(sk, -0.15));
  } else if (top === 5) {
    // button-up shirt: white collar points + placket
    if (front && c.view !== "side") {
      r.rect(mid - 3, y0, 2, 2, "#f4f4f8"); r.rect(mid + 1, y0, 2, 2, "#f4f4f8");
      r.set(mid - 1, y0 + 2, "#f4f4f8"); r.set(mid, y0 + 2, "#f4f4f8");
      for (let y = y0 + 3; y < HIP_Y + by - 2; y++) r.set(mid, y, shade(shirt, -0.3));
      for (let y = y0 + 5; y < HIP_Y + by - 2; y += 4) r.set(mid + 1, y, "#f4f4f8");
    } else if (c.view === "side") r.rect(t1 - 2, y0, 3, 2, "#f4f4f8");
    else r.rect(mid - 4, y0, 8, 1, "#f4f4f8");
  } else {
    // tee / long sleeve: collar + a subtle chest stripe
    if (front) {
      const w = c.view === "side" ? 2 : 3;
      r.rect(mid - w, y0, w * 2, 1, shade(shirt, -0.4));
      r.rect(mid - w + 1, y0 + 1, w * 2 - 2, 1, shade(shirt, -0.4));
      if (c.view === "side") r.rect(t1 - 3, y0, 3, 1, shade(shirt, -0.4));
    }
  }
}

function drawArm(c: Ctx, a: Geo["arms"][number]) {
  const { r, l, by } = c;
  const top = c.npc === "plaque" ? 1 : c.npc === "oracle" ? 1 : l.top;
  const shirt = c.npc === "oracle" ? "#4c2c88" : SHIRTS[l.shirt];
  const vert = c.view === "front" || c.view === "back";
  const y0 = SHOULDER_Y + 1 + by;
  let len = 20;
  let dx = 0;
  if (c.sit) {
    dx = vert ? 0 : 3;
    len = 15;
  } else if (vert) len += c.s * a.sw > 0 ? 1 : c.s * a.sw < 0 ? -2 : 0;
  else dx = -Math.round(3 * c.s * a.sw);
  const sleeveCol = a.far ? shade(shirt, -0.2) : shirt;
  const skinCol = a.far ? shade(c.skin, -0.15) : c.skin;
  const sleeveLen = top === 4 ? 0 : top === 0 || top === 6 ? 6 : len - 3;
  // whole arm in skin, then sleeve on top
  const arm = new Mask().limb(a.x, y0, a.w, len, dx);
  // round the shoulder & hand
  arm.del(a.x, y0);
  arm.del(a.x + a.w - 1, y0);
  const hy = y0 + len - 1;
  const hx = a.x + dx;
  arm.del(hx, hy).del(hx + a.w - 1, hy);
  paint(r, arm, skinCol, { sep: a.front, darkRight: 1 });
  if (sleeveLen > 0) {
    const sl = new Mask();
    for (let j = 0; j < sleeveLen; j++) {
      const o = Math.round((dx * j) / Math.max(1, len - 1));
      for (let i = 0; i < a.w; i++) if (arm.has(a.x + o + i, y0 + j)) sl.add(a.x + o + i, y0 + j);
    }
    // keep the separator look by copying edge pixels that border other paint
    paint(r, sl, sleeveCol, { darkRight: 1 });
    if (a.front) {
      sl.each((x, y) => {
        if (!sl.has(x - 1, y) && r.get(x - 1, y) && !arm.has(x - 1, y)) r.set(x, y, shade(sleeveCol, -0.5));
        if (!sl.has(x + 1, y) && r.get(x + 1, y) && !arm.has(x + 1, y)) r.set(x, y, shade(sleeveCol, -0.5));
      });
    }
    // cuff
    const cy = y0 + sleeveLen - 1;
    const o = Math.round((dx * (sleeveLen - 1)) / Math.max(1, len - 1));
    r.rect(a.x + o, cy, a.w, 1, shade(sleeveCol, -0.3));
  }
}

const EYE_DY = 12; // eye row below the top of the head

/** Habbo-style face: white eyes with a dark pupil + brow, tiny nose shade, short mouth line. No blush. */
function drawFace(c: Ctx, hy: number) {
  const { r, view, skin } = c;
  const [a, b] = c.g.head;
  const sd = shade(skin, -0.2);
  const mouth = shade(skin, -0.42);
  const brow = c.npc ? "#6a6a72" : shade(HAIRS[c.l.hair], -0.35);
  const W = "#ffffff", P = "#0b0a10";
  const ey = hy + EYE_DY;
  const eye = (ex: number, w: number, inner: "l" | "r") => {
    r.rect(ex, ey, w, 3, W);
    r.rect(inner === "l" ? ex : ex + w - 1, ey + 1, 1, 2, P);
    r.rect(ex, ey - 2, w, 1, brow);
  };
  if (view === "front") {
    r.rect(a - 1, ey - 1, 1, 5, skin); r.set(a - 1, ey + 1, sd); r.set(a - 1, ey, sd);
    r.rect(b + 1, ey - 1, 1, 5, sd);
    eye(a + 5, 2, "r");
    eye(b - 6, 2, "l");
    r.rect(21, ey + 4, 2, 1, sd); // nose shadow
    r.rect(20, ey + 7, 4, 1, mouth);
  } else if (view === "q3") {
    r.rect(a + 4, ey - 1, 3, 5, skin);
    r.rect(a + 4, ey - 1, 1, 5, sd);
    r.set(a + 5, ey + 1, sd);
    eye(a + 11, 2, "r");
    eye(b - 3, 2, "r");
    r.set(b + 1, ey + 3, skin); r.set(b + 1, ey + 4, sd); // nose tip
    r.rect(b - 5, ey + 7, 4, 1, mouth);
    r.rect(b - 7, ey + 4, 1, 2, sd); // cheek line
  } else if (view === "side") {
    r.rect(a + 6, ey - 1, 3, 5, skin);
    r.rect(a + 6, ey - 1, 1, 5, sd);
    r.set(a + 7, ey + 1, sd);
    eye(b - 3, 2, "r");
    r.set(b + 1, ey + 3, skin); r.set(b + 1, ey + 4, sd);
    r.rect(b - 3, ey + 7, 3, 1, mouth);
  } else if (view === "q3b") {
    r.rect(b - 7, ey - 1, 3, 5, skin);
    r.rect(b - 5, ey - 1, 1, 5, sd);
    r.set(b - 6, ey + 1, sd);
  } else {
    r.rect(a - 1, ey - 1, 1, 5, skin);
    r.rect(b + 1, ey - 1, 1, 5, sd);
  }
}

function drawGlasses(c: Ctx, hy: number) {
  const g = c.l.glasses;
  if (!g || c.npc) return;
  const { r, view } = c;
  const [a, b] = c.g.head;
  const ey = hy + EYE_DY;
  const frame = g === 3 ? "#f2f2f2" : "#0b0a10";
  const lensL = g === 2 ? "#15111c" : g === 3 ? "#e8442e" : null;
  const lensR = g === 2 ? "#15111c" : g === 3 ? "#2fa8ff" : null;
  const lens = (x: number, w: number, col: string | null) => {
    r.rect(x - 1, ey - 1, w + 2, 1, frame);
    r.rect(x - 1, ey + 3, w + 2, 1, frame);
    r.rect(x - 1, ey - 1, 1, 5, frame);
    r.rect(x + w, ey - 1, 1, 5, frame);
    if (col) r.rect(x, ey, w, 3, col);
    if (g === 2) r.set(x, ey, "#5a5f6e");
  };
  if (view === "front") {
    lens(a + 5, 2, lensL);
    lens(b - 6, 2, lensR);
    r.rect(a + 8, ey, b - a - 15, 1, frame);
  } else if (view === "q3") {
    lens(a + 11, 2, lensL);
    lens(b - 3, 2, lensR);
    r.rect(a + 7, ey, 3, 1, frame);
  } else if (view === "side") {
    lens(b - 3, 2, lensR);
    r.rect(a + 9, ey, b - a - 13, 1, frame);
  } else if (view === "q3b") {
    r.rect(b - 4, ey, 5, 1, frame);
  }
}

/** Hair as a mask, then shaded with highlight streaks. */
function drawHair(c: Ctx, hy: number, behind: boolean) {
  const { r, view, l } = c;
  const hs = c.npc ? 0 : l.hairStyle;
  if (hs === 5) return;
  const hatOn = (c.npc === "plaque" ? 1 : c.npc ? 0 : l.hat) !== 0;
  const [a, b] = c.g.head;
  const m = new Mask();
  const front = view === "front";
  const q3 = view === "q3";
  const side = view === "side";
  const q3b = view === "q3b";
  const back = view === "back";
  const mid = (a + b) / 2;
  const Y = (n: number) => hy + (n <= 5 ? n : Math.round(n * 1.17));

  if (behind) {
    // long hair / ponytail parts that sit behind the head and shoulders
    if (hs === 1) {
      if (front) m.rect(a - 1, Y(8), b - a + 3, 25);
      if (q3) m.rect(a - 1, Y(6), 10, 26);
      if (side) m.rect(a - 1, Y(6), 9, 26);
    }
    if (hs === 7 && (q3 || front)) {
      if (q3) m.limb(a - 2, Y(6), 4, 14, -2);
    }
    if (hs === 4 && (front || q3)) {
      m.ellipse(mid, Y(7), (b - a) / 2 + 4, 11);
    }
    if (!m.m.some((v) => v)) return;
    paint(r, m, shade(HAIRS[l.hair], -0.18), { darkRight: 1 });
    return;
  }

  // cap of hair over the skull (common to most styles)
  const capTop = hy - 2;
  const capRows: [number, number, number][] = [
    [capTop - 2, a + 7, b - 7],
    [capTop - 1, a + 4, b - 4],
    [capTop, a + 2, b - 2],
    [capTop + 1, a, b],
    [capTop + 2, a - 1, b + 1],
    [capTop + 3, a - 2, b + 2],
    [capTop + 4, a - 2, b + 2],
  ];
  if (hs !== 8) m.rows(capRows);
  const fill = (y0: number, y1: number, x0: number, x1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.add(x, y);
  };

  if (hs === 8) {
    // mohawk: tall central strip
    const cx = side ? Math.round(mid) - 1 : q3 ? Math.round(mid) : Math.round(mid) - 1;
    const w = side || q3 || q3b ? 10 : 4;
    const x0 = side || q3 || q3b ? cx - 6 : cx - 1;
    for (let j = 0; j < 7; j++) fill(hy - 6 + j, hy - 6 + j, x0 + (j < 2 ? 2 - j : 0), x0 + w - 1);
    fill(Y(1), hy + (back || q3b ? 14 : 3), x0 + (side ? 0 : 0), x0 + w - 1);
    // shaved sides: stubble tone on the skull
    const stub = shade(c.skin, -0.28);
    for (let y = Y(1); y < Y(6); y++) {
      r.set(a + 1, y, stub); r.set(b - 1, y, stub);
    }
  } else if (front) {
    fill(Y(1), hy + 6, a - 1, b + 1);
    fill(Y(5), Y(10), a - 1, a + 1); // sideburns
    fill(Y(5), Y(10), b - 1, b + 1);
    if (hs === 9) {
      fill(Y(5), Y(7), a + 1, b - 5); // swept fringe over one eye
      fill(Y(8), Y(10), a + 2, a + 7);
    } else if (hs !== 6 && hs !== 3) {
      // jagged fringe
      if (hs === 10) fill(hy + 7, hy + 8, a, b);
      else for (let x = a + 2; x <= b - 2; x++) if ((x * 7) % 3 !== 0) m.add(x, hy + 7);
    }
  } else if (q3) {
    fill(Y(1), hy + 6, a - 1, b + 1);
    fill(Y(5), Y(15), a - 1, a + 2); // back of the head
    fill(Y(5), Y(8), a + 3, a + 6);
    if (hs === 10) fill(hy + 7, hy + 8, a + 7, b);
    else for (let x = a + 8; x <= b - 1; x++) if ((x * 5) % 3 !== 0) m.add(x, hy + 7);
    fill(Y(5), Y(9), a + 7, a + 7);
    if (hs === 9) fill(Y(5), Y(7), a + 7, b - 2);
  } else if (side) {
    fill(Y(1), hy + 6, a - 1, b);
    fill(Y(5), Y(15), a - 1, a + 4);
    fill(Y(5), Y(8), a + 5, a + 8);
    if (hs === 10) fill(hy + 7, hy + 8, a + 9, b);
    else for (let x = a + 9; x <= b - 1; x++) if ((x * 5) % 3 !== 0) m.add(x, hy + 7);
    if (hs === 9) fill(Y(5), Y(7), b - 6, b);
  } else if (q3b) {
    fill(Y(1), Y(15), a - 1, b + 1);
    const cut0 = hs === 1 || hs === 4 || hs === 10 ? b - 3 : b - 7;
    for (let y = Y(8); y <= Y(15); y++) for (let x = cut0; x <= b + 1; x++) m.del(x, y);
    if (cut0 === b - 7) fill(Y(8), Y(10), b - 7, b - 6);
  } else if (back) {
    fill(Y(1), Y(15), a - 1, b + 1);
    for (let x = a + 1; x <= b - 1; x++) if ((x * 7) % 3 !== 0) m.add(x, Y(16));
  }

  // style extras
  if (hs === 1) {
    // long: sides down to the shoulders
    if (front) {
      fill(Y(5), Y(26), a - 2, a + 1);
      fill(Y(5), Y(26), b - 1, b + 2);
    } else if (q3) {
      fill(Y(5), Y(26), a - 2, a + 3);
    } else if (side) {
      fill(Y(5), Y(26), a - 2, a + 5);
    } else {
      fill(Y(15), Y(27), a - 1, b + 1);
      if (q3b) fill(Y(15), Y(27), a - 1, b - 3);
    }
  }
  if (hs === 2) {
    // spikes
    const tips = front || back ? [a + 1, a + 6, a + 11, b - 1] : [a + 1, a + 5, a + 10, b - 2];
    for (const t of tips)
      for (let k = 0; k < 5; k++) fill(capTop - k, capTop - k, t - Math.max(0, 2 - Math.floor(k / 2)), t + Math.max(0, 2 - Math.floor(k / 2)) - (k > 2 ? 1 : 0));
  }
  if (hs === 3) {
    // bun on top-back
    const bx = front || back ? Math.round(mid) : side ? a + 3 : q3 ? a + 4 : b - 4;
    m.ellipse(bx, capTop - 3, 4, 3);
  }
  if (hs === 4) {
    // big round curls
    const rx = (b - a) / 2 + 3;
    const cxx = front || back ? mid : side || q3 ? mid - 1 : mid + 1;
    m.ellipse(cxx, Y(4), rx, 9);
    if (front || q3 || side) {
      // keep the face open
      const fx0 = front ? a + 2 : q3 ? a + 7 : a + 8;
      for (let y = Y(7); y <= Y(20); y++) for (let x = fx0; x <= b + 3; x++) m.del(x, y);
      if (front) {
        fill(Y(6), Y(13), a - 3, a + 1);
        fill(Y(6), Y(13), b - 1, b + 3);
      }
    } else {
      fill(Y(6), Y(15), a - 3, b + 3);
    }
  }
  if (hs === 6) {
    // quiff / pompadour toward the front
    const qx = front ? Math.round(mid) - 5 : side ? b - 9 : q3 ? b - 9 : q3b ? b - 8 : Math.round(mid) - 5;
    for (let k = 0; k < 4; k++) fill(capTop - 1 - k, capTop - k, qx + k, qx + 10 - (k > 1 ? k - 1 : 0) + (side || q3 ? 2 : 0));
  }
  if (hs === 7) {
    // ponytail
    if (side) m.limb(a - 3, Y(4), 4, 16, -2);
    if (back) m.limb(Math.round(mid) - 2, Y(14), 4, 12, 0);
    if (q3b) m.limb(a, Y(13), 4, 12, -2);
    if (q3 && !hatOn) m.rect(a - 2, Y(3), 3, 3);
  }
  if (hs === 10) {
    // bob: straight sides down to the jaw
    if (front) {
      fill(Y(5), hy + 20, a - 2, a + 1);
      fill(Y(5), hy + 20, b - 1, b + 2);
    } else if (q3) fill(Y(5), hy + 20, a - 2, a + 4);
    else if (side) fill(Y(5), hy + 20, a - 2, a + 6);
    else fill(Y(5), hy + 21, a - 2, b + 2);
  }
  if (hs === 11) {
    // pigtails sticking out at the sides
    const tail = (x: number, dir: number) => {
      m.ellipse(x, hy + 9, 2.5, 3);
      m.ellipse(x + dir * 2, hy + 13, 2, 3);
    };
    if (front || back) {
      tail(a - 3, -1);
      tail(b + 3, 1);
    } else if (q3 || side) tail(a - 2, -1);
    else tail(b + 2, 1);
    if (front) fill(Y(5), Y(10), a - 1, a + 1), fill(Y(5), Y(10), b - 1, b + 1);
  }
  if (hs === 0 && (back || q3b)) {
    // short: show the nape
    for (let y = Y(13); y <= Y(16); y++) for (let x = a - 1; x <= b + 1; x++) if (y > Y(14)) m.del(x, y);
  }

  // hats sit over the top: drop the hair the hat hides so it doesn't poke out
  const hat = c.npc === "plaque" ? 1 : c.npc ? 0 : l.hat;
  if (hat === 1 || hat === 2 || hat === 4 || hat === 6) {
    for (let y = 0; y <= Y(1); y++) for (let x = 0; x < AV_W; x++) m.del(x, y);
  } else if (hat === 3) {
    for (let y = 0; y <= hy; y++) for (let x = 0; x < AV_W; x++) m.del(x, y);
  }

  const base = HAIRS[l.hair];
  paint(r, m, base, { light: 0.0, dark: -0.28, darkRight: 1 });
  // Habbo-style gloss: a dithered (checkerboard) highlight band across the crown, darker underside
  const hl = shade(base, base === HAIRS[0] || base === HAIRS[1] ? 0.22 : 0.3);
  const dk = shade(base, -0.4);
  const gx0 = side || q3 ? a + 2 : q3b ? a + 4 : a + 1;
  const gx1 = side || q3 ? b - 1 : q3b ? b : b - 3;
  m.each((x, y) => {
    if (!m.has(x, y + 1) || !m.has(x, y - 1)) return;
    const rel = y - capTop;
    if (rel >= 1 && rel <= 5 && x >= gx0 && x <= gx1) {
      const solid = rel >= 2 && rel <= 3 && x >= gx0 + 3 && x <= gx1 - 4;
      if (solid || (x + y) % 2 === 0) r.set(x, y, hl);
    } else if (!m.has(x, y + 2) && y > Y(2)) r.set(x, y, dk);
  });
}

function drawHat(c: Ctx, hy: number) {
  const { r, view } = c;
  const hat = c.npc === "plaque" ? 1 : c.npc ? 0 : c.l.hat;
  if (!hat) return;
  const [a, b] = c.g.head;
  const mid = Math.round((a + b) / 2);
  const front = view === "front", q3 = view === "q3", side = view === "side", q3b = view === "q3b";
  const facing = front || q3 || side;
  if (hat === 1 || hat === 2) {
    const col = hat === 1 ? "#2b5be0" : "#6b33c9";
    const brim = new Mask().ellipse(mid + (side ? 1 : 0), hy + 1, (b - a) / 2 + 4, 2.2);
    const cone = new Mask();
    // cone rows: wide at the base, tip bends back
    const lean = side || q3 ? -1 : q3b ? 1 : 0;
    for (let j = 0; j < 18; j++) {
      const w = Math.max(1, Math.round(8 - j * 0.42));
      const cx = mid + Math.round(lean * Math.max(0, j - 9) * 0.9);
      for (let x = cx - w; x <= cx + w - 1; x++) cone.add(x, hy - j);
    }
    // floppy tip
    const tx = mid + lean * 8 + (lean === 0 ? 3 : 0);
    cone.rect(tx - 1, hy - 19, 3, 2);
    paint(r, cone, col, { darkRight: 3, light: 0.25 });
    paint(r, brim, shade(col, -0.25), { sep: true, darkRight: 2 });
    // gold band
    for (let x = mid - 7; x <= mid + 6; x++) if (cone.has(x, hy - 1)) r.set(x, hy - 1, "#ffd700");
    for (let x = mid - 7; x <= mid + 6; x++) if (cone.has(x, hy - 2)) r.set(x, hy - 2, "#e0a800");
    if (facing) {
      const sx = mid + (side ? 2 : q3 ? 1 : 0) - 1;
      const sy = hy - 8;
      r.set(sx + 1, sy - 1, "#ffd700");
      r.rect(sx, sy, 3, 1, "#ffd700");
      r.set(sx + 1, sy + 1, "#ffd700");
      r.set(sx + 1, sy, "#fff3a0");
      r.set(sx - 3, sy - 4, "#ffe680");
      r.set(sx + 4, sy + 3, "#ffe680");
    }
  } else if (hat === 3) {
    // cap
    const col = "#e8442e";
    const dome = new Mask();
    dome.rows([[hy - 3, a + 3, b - 3], [hy - 2, a + 1, b - 1], [hy - 1, a, b], [hy, a - 1, b + 1], [hy + 1, a - 1, b + 1], [hy + 2, a - 1, b + 1]]);
    paint(r, dome, col, { light: 0.25 });
    r.rect(mid - 1, hy - 3, 2, 1, shade(col, 0.4));
    const visor = new Mask();
    if (front) visor.rows([[hy + 3, a + 1, b - 1], [hy + 4, a + 3, b - 3]]);
    else if (q3) visor.rows([[hy + 2, b - 4, b + 4], [hy + 3, b - 2, b + 4]]);
    else if (side) visor.rows([[hy + 2, b - 2, b + 6], [hy + 3, b, b + 6]]);
    else if (q3b) visor.rows([[hy + 1, b - 1, b + 3]]);
    paint(r, visor, shade(col, -0.25), { sep: true, darkRight: 1 });
    r.rect(a + 1, hy + 2, b - a - 1, 1, shade(col, -0.35));
  } else if (hat === 4) {
    // beanie with fold + pompom
    const col = "#2fae6a";
    const m = new Mask().rows([
      [hy - 4, a + 4, b - 4], [hy - 3, a + 2, b - 2], [hy - 2, a + 1, b - 1], [hy - 1, a, b], [hy, a - 1, b + 1], [hy + 1, a - 1, b + 1],
    ]);
    paint(r, m, col, { light: 0.22 });
    for (let x = a; x <= b; x += 2) for (let y = hy - 3; y <= hy + 1; y++) if (m.has(x, y)) r.set(x, y, shade(col, -0.12));
    const fold = new Mask().rect(a - 1, hy + 2, b - a + 3, 3);
    paint(r, fold, shade(col, -0.1), { sep: true });
    const pom = new Mask().ellipse(mid, hy - 6, 2.5, 2);
    paint(r, pom, "#f2f2f2", { dark: -0.15 });
  } else if (hat === 5) {
    // crown
    const gold = "#ffd23a";
    const m = new Mask().rect(a + 2, hy - 2, b - a - 3, 4);
    for (const px of [a + 2, mid - 1, b - 3]) m.rect(px, hy - 6, 2, 4);
    for (const px of [a + 5, b - 6]) m.rect(px, hy - 4, 2, 2);
    m.add(mid - 1, hy - 7).add(mid, hy - 7);
    paint(r, m, gold, { light: 0.4, dark: -0.3 });
    if (facing) {
      r.rect(mid - 1, hy - 1, 2, 2, "#e8442e");
      r.set(a + 4, hy, "#2fa8ff");
      r.set(b - 5, hy, "#2fae6a");
    }
  } else if (hat === 6) {
    // top hat
    const col = "#22202a";
    const brim = new Mask().ellipse(mid, hy + 1, (b - a) / 2 + 3, 2);
    const tube = new Mask().rect(a + 2, hy - 11, b - a - 3, 12);
    tube.del(a + 2, hy - 11).del(b - 2, hy - 11);
    paint(r, tube, col, { light: 0.25 });
    r.rect(a + 2, hy - 2, b - a - 3, 2, "#b0123a");
    paint(r, brim, shade(col, 0.1), { sep: true });
  } else if (hat === 7) {
    // headphones
    const band = "#2a2d36", cup = "#e8442e";
    const m = new Mask();
    m.rows([[hy - 3, a + 2, b - 2], [hy - 2, a, a + 1], [hy - 2, b - 1, b], [hy - 1, a - 1, a], [hy - 1, b, b + 1]]);
    paint(r, m, band);
    const cm = new Mask();
    if (front || view === "back") {
      cm.rect(a - 3, hy + 6, 4, 7);
      cm.rect(b, hy + 6, 4, 7);
    } else if (q3 || side) cm.rect(a + (side ? 4 : 2), hy + 7, 5, 7);
    else cm.rect(b - 7, hy + 7, 5, 7);
    paint(r, cm, cup, { sep: true, light: 0.3 });
  } else if (hat === 8) {
    // bandana band across the forehead
    const col = "#e8442e";
    const m = new Mask().rect(a - 1, hy + 3, b - a + 3, 3);
    paint(r, m, col, { sep: true, light: 0.25 });
    for (let x = a; x <= b; x += 3) r.set(x, hy + 4, "#f2f2f2");
    if (q3b || view === "back" || side) {
      const kx = side ? a - 2 : q3b ? a : mid;
      const k = new Mask().rect(kx - 1, hy + 5, 3, 4);
      paint(r, k, shade(col, -0.1), { sep: true });
    }
  }
}

function drawPlaque(c: Ctx) {
  // Silver YouTube play button plaque held in front of the chest
  if (c.view === "back" || c.view === "q3b") return;
  const { r, by } = c;
  const side = c.view === "side";
  const x = side ? 25 : c.view === "q3" ? 17 : 15;
  const w = side ? 5 : 14;
  const y = SHOULDER_Y + 6 + by;
  const m = new Mask().rect(x, y, w, 15);
  paint(r, m, "#c9ced6", { light: 0.5, sep: true });
  if (!side) {
    r.rect(x + 2, y + 2, w - 4, 11, "#e4e8ee");
    r.rect(x + 4, y + 4, w - 8, 6, "#e8442e");
    r.rect(x + 4, y + 4, w - 8, 1, "#ff6a55");
    r.set(x + 6, y + 6, "#ffffff"); r.set(x + 6, y + 7, "#ffffff"); r.set(x + 7, y + 6, "#ffffff"); r.set(x + 7, y + 7, "#ffffff");
    r.set(x + 8, y + 7, "#ffffff"); r.set(x + 6, y + 8, "#ffffff");
    r.rect(x + 3, y + 11, w - 6, 1, "#8d939c");
    // hands gripping the sides
    r.rect(x - 1, y + 7, 2, 3, c.skin);
    r.rect(x + w - 1, y + 7, 2, 3, shade(c.skin, -0.12));
  } else {
    r.rect(x - 1, y + 7, 2, 3, c.skin);
  }
}

function drawOracle(c: Ctx) {
  const { r, view, by } = c;
  const robe = "#4c2c88";
  const front = view === "front" || view === "q3" || view === "side";
  const [t0, t1] = c.g.torso;
  // robe flaring to the floor
  const m = new Mask();
  for (let y = SHOULDER_Y + by; y <= AV_AY - 1; y++) {
    const k = (y - SHOULDER_Y) / (AV_AY - SHOULDER_Y);
    const sp = Math.round(k * 4);
    const top = y === SHOULDER_Y + by ? 2 : y === SHOULDER_Y + by + 1 ? 1 : 0;
    m.rows([[y, t0 - sp + top, t1 + sp - top]]);
  }
  paint(r, m, robe, { darkRight: 4, light: 0.18 });
  // hem + gold trim
  r.rect(t0 - 4, AV_AY - 2, t1 - t0 + 9, 1, "#ffd700");
  if (front) {
    const mid = Math.round((t0 + t1) / 2) + (view === "q3" ? 1 : view === "side" ? 3 : 0);
    for (let y = SHOULDER_Y + 2 + by; y < AV_AY - 2; y++) r.set(mid, y, "#ffd700");
    // stars on the robe
    for (const [sx, sy] of [[t0 + 2, 58], [t1 - 3, 66], [t0 + 1, 74], [t1 - 1, 79]] as const) {
      r.set(sx, sy + by, "#ffe680");
      r.set(sx + 1, sy + 1 + by, "#7cf3ff");
    }
    // sleeves meeting in front, hands holding a little orb
    const sl = new Mask().rows([
      [SHOULDER_Y + 10 + by, mid - 7, mid + 6], [SHOULDER_Y + 11 + by, mid - 7, mid + 6], [SHOULDER_Y + 12 + by, mid - 6, mid + 5],
    ]);
    for (let y = SHOULDER_Y + 2 + by; y < SHOULDER_Y + 10 + by; y++) {
      sl.add(t0, y).add(t0 + 1, y).add(t1, y).add(t1 - 1, y);
    }
    paint(r, sl, shade(robe, 0.1), { sep: true });
    const orb = new Mask().ellipse(mid, SHOULDER_Y + 9 + by, 2.5, 2.5);
    paint(r, orb, "#7cc8ff", { light: 0.6 });
  }
}

function drawOracleHead(c: Ctx, hy: number) {
  const { r, view } = c;
  const [a, b] = c.g.head;
  const hood = "#5a35a0";
  const m = new Mask();
  m.rows([[hy - 3, a + 3, b - 3], [hy - 2, a + 1, b - 1], [hy - 1, a, b]]);
  m.rect(a - 1, hy, b - a + 3, HEAD_H + 3);
  // pointed hood tip leaning back
  const back = view === "back" || view === "q3b";
  const tip = view === "side" || view === "q3" ? a + 3 : view === "q3b" ? b - 3 : Math.round((a + b) / 2);
  m.rect(tip - 1, hy - 6, 3, 3).rect(tip, hy - 8, 2, 2);
  paint(r, m, hood, { darkRight: 3, light: 0.2 });
  if (!back) {
    const o0 = view === "front" ? a + 2 : view === "q3" ? a + 6 : a + 9;
    const o1 = b - 1;
    const op = new Mask();
    for (let y = hy + 4; y <= hy + 17; y++) {
      const i = y < hy + 6 ? 6 - (y - hy) : y > hy + 15 ? y - (hy + 15) : 0;
      for (let x = o0 + i; x <= o1 - i; x++) op.add(x, y);
    }
    op.each((x, y) => r.set(x, y, "#120a22"));
    const ey = hy + 10;
    if (view === "front") {
      r.rect(a + 5, ey, 2, 1, "#7cf3ff"); r.rect(b - 6, ey, 2, 1, "#7cf3ff");
      r.set(a + 5, ey + 1, "#2a8a9a"); r.set(b - 5, ey + 1, "#2a8a9a");
    } else if (view === "q3") {
      r.rect(a + 10, ey, 2, 1, "#7cf3ff"); r.rect(b - 3, ey, 2, 1, "#7cf3ff");
    } else r.rect(b - 3, ey, 2, 1, "#7cf3ff");
  }
}

function render(look: Look, dir: Dir, frame: number, npc?: NpcKind): Raster {
  const l = normLook(look);
  if (npc === "plaque") {
    l.hat = 1; l.top = 1; l.shirt = 1; l.hairStyle = 0; l.hair = 7; l.glasses = 0; l.pants = 2; l.shoes = 6; l.skin = 2;
  }
  const [view, mirrored] = VIEWS[((dir % 8) + 8) % 8];
  const sit = frame === FRAME_SIT;
  const w = WALK[sit ? 0 : Math.max(0, Math.min(4, frame))];
  const r = new Raster();
  const c: Ctx = {
    r, view, g: GEO[view], l, skin: SKINS[l.skin], hair: HAIRS[l.hair], s: w.s, by: w.bob + (sit ? 8 : 0), sit, npc,
  };
  const hy = HEAD_Y + c.by;
  const backish = view === "back" || view === "q3b";

  if (npc === "oracle") {
    drawOracle(c);
    drawOracleHead(c, hy);
  } else {
    drawHair(c, hy, true); // long hair behind the body
    // far arm first (behind torso)
    for (const a of c.g.arms) if (!a.front) drawArm(c, a);
    drawLegs(c);
    drawTorso(c);
    for (const a of c.g.arms) if (a.front) drawArm(c, a);
    if (npc === "plaque") drawPlaque(c);
    // neck
    const [n0, n1] = c.g.neck;
    r.rect(n0, hy + HEAD_H - 1, n1 - n0 + 1, 3, shade(c.skin, -0.18));
    // head
    const head = new Mask().rows(headRows(c, hy));
    paint(r, head, c.skin, { light: 0.12, dark: -0.14, darkRight: 2 });
    drawFace(c, hy);
    if (npc === "plaque") {
      // grey beard for the Mago
      const [a, b] = c.g.head;
      const bd = new Mask();
      if (view === "front") bd.rows([[hy + 17, a + 2, b - 2], [hy + 18, a + 2, b - 2], [hy + 19, a + 3, b - 3], [hy + 20, a + 4, b - 4], [hy + 21, a + 5, b - 5], [hy + 22, a + 6, b - 6], [hy + 23, a + 7, b - 7]]);
      else if (view === "q3") bd.rows([[hy + 17, a + 8, b], [hy + 18, a + 8, b], [hy + 19, a + 9, b - 1], [hy + 20, a + 10, b - 2], [hy + 21, a + 11, b - 3], [hy + 22, a + 12, b - 4]]);
      else if (view === "side") bd.rows([[hy + 17, a + 10, b], [hy + 18, a + 10, b], [hy + 19, a + 11, b - 1], [hy + 20, a + 12, b - 2], [hy + 21, a + 13, b - 3]]);
      if (!backish) {
        paint(r, bd, "#e6e3dc", { light: 0.3 });
        const [ma, mb] = view === "front" ? [19, 24] : view === "q3" ? [b - 6, b - 1] : [b - 4, b];
        r.rect(ma, hy + 18, mb - ma + 1, 1, "#7a6a60");
      }
    }
    drawGlasses(c, hy);
    drawHair(c, hy, false);
    drawHat(c, hy);
  }
  r.outline();
  if (mirrored) r.mirror();
  return r;
}

/** Raw RGBA pixels (for node-side sprite sheets / tests). */
export function avatarPixels(look: Look, dir: Dir, frame: number, npc?: NpcKind): Uint8ClampedArray {
  return new Uint8ClampedArray(render(look, dir, frame, npc).d.buffer);
}

function lookKey(l: Look) {
  const n = normLook(l);
  return `${n.skin}.${n.hair}.${n.hairStyle}.${n.shirt}.${n.hat}.${n.top}.${n.pants}.${n.shoes}.${n.glasses}.${n.bottom}`;
}

// ---------------------------------------------------------------- sprite atlas
// Every (look, dir, frame) used to get its own canvas: with 300 people walking that meant 12k+ canvases churned
// through a 4000-entry cache (cleared wholesale), and Chrome eventually lost the GPU canvases -> blank room art and
// heads. Now frames live in a few fixed atlas pages (1024x1024) with slot-level LRU eviction, a per-frame budget
// for new renders, and a full rebuild when the browser drops/restores canvas contexts.
/** flip: draw mirrored (left-facing dirs share the right-facing frame, see blitSprite) */
export type SpriteRef = { img: HTMLCanvasElement; sx: number; sy: number; flip: boolean };
/** left-facing dirs reuse the frame of their right-facing twin, drawn mirrored (halves the working set) */
const TWIN: Dir[] = [0, 1, 2, 1, 0, 7, 6, 7];
const PAGE = 1024;
const COLS = Math.floor(PAGE / AV_W), ROWS = Math.floor(PAGE / AV_H), PER_PAGE = COLS * ROWS;
const pages: { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D }[] = [];
const slotOf = new Map<string, number>(); // key -> slot; Map order = LRU (oldest first)
const lastOfLook = new Map<string, string>(); // look|npc -> key of the frame rendered most recently for it
let usedSlots = 0;
let renderBudget = Infinity;
let scratchImg: ImageData | null = null;
const lostListeners = new Set<() => void>();
export const atlasStats = { renders: 0, evictions: 0, pages: 0, renderMs: 0 };

function maxPages() {
  // phones: 6 pages (~1500 frames, 24 MB); desktop: 10 pages (~2500 frames, 40 MB)
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return coarse ? 6 : 10;
}

/** Called by the engine when an atlas page reports context loss/restore (contents are gone). */
export function onAtlasLost(fn: () => void) {
  lostListeners.add(fn);
  return () => lostListeners.delete(fn);
}

/** Drop every cached frame (after a GPU context loss). Pages are recreated lazily. */
export function resetAvatarAtlas() {
  pages.length = 0;
  slotOf.clear();
  lastOfLook.clear();
  usedSlots = 0;
  atlasStats.pages = 0;
}

/** Engine: allow at most n brand-new frame renders until the next call (walk frames fall back to idle). */
export function setSpriteBudget(n: number) {
  renderBudget = n;
}

function page(i: number) {
  while (pages.length <= i) {
    const c = document.createElement("canvas");
    c.width = COLS * AV_W;
    c.height = ROWS * AV_H;
    const ctx = c.getContext("2d")!;
    const lost = () => lostListeners.forEach((f) => f());
    c.addEventListener("contextlost", lost);
    c.addEventListener("contextrestored", lost);
    pages.push({ c, ctx });
    atlasStats.pages = pages.length;
  }
  return pages[i];
}

function refOf(slot: number, flip = false): SpriteRef {
  const p = Math.floor(slot / PER_PAGE), s = slot % PER_PAGE;
  return { img: page(p).c, sx: (s % COLS) * AV_W, sy: Math.floor(s / COLS) * AV_H, flip };
}

/**
 * Atlas-backed sprite frame. dir: 0..7 (0=E, 2=S facing camera, 6=N), already mirrored for the left-facing dirs.
 * frame: 0 idle, 1..4 walk cycle, 5 sit. Returns null only when !force and this frame's render budget is spent.
 */
export function avatarFrame(look: Look, dir: number, frame: number, extra?: NpcKind, force = true): SpriteRef | null {
  const d0 = (((Math.round(dir) % 8) + 8) % 8) as Dir;
  const d = TWIN[d0], flip = d !== d0;
  const key = `${lookKey(look)}|${d}|${frame}|${extra || ""}`;
  const hit = slotOf.get(key);
  if (hit !== undefined) {
    slotOf.delete(key); // touch (LRU)
    slotOf.set(key, hit);
    return refOf(hit, flip);
  }
  if (!force && renderBudget <= 0) return null;
  renderBudget--;
  let slot: number;
  if (usedSlots < maxPages() * PER_PAGE) slot = usedSlots++;
  else {
    const [oldKey, oldSlot] = slotOf.entries().next().value as [string, number];
    slotOf.delete(oldKey);
    slot = oldSlot;
    atlasStats.evictions++;
  }
  slotOf.set(key, slot);
  if (lastOfLook.size > 4000) lastOfLook.clear();
  lastOfLook.set(`${lookKey(look)}|${extra || ""}`, key);
  const ref = refOf(slot, flip);
  const t0 = performance.now();
  const img = (scratchImg ||= new ImageData(AV_W, AV_H));
  img.data.set(avatarPixels(look, d, frame, extra));
  page(Math.floor(slot / PER_PAGE)).ctx.putImageData(img, ref.sx, ref.sy); // replaces the slot, transparency included
  atlasStats.renders++;
  atlasStats.renderMs += performance.now() - t0;
  return ref;
}

/** Any frame of this look still in the atlas (crowd fallback when the render budget is spent), or null. */
export function anyAvatarFrame(look: Look, extra?: NpcKind): SpriteRef | null {
  const k = lastOfLook.get(`${lookKey(look)}|${extra || ""}`);
  const slot = k === undefined ? undefined : slotOf.get(k);
  return slot === undefined ? null : refOf(slot);
}

/** Draw a frame at (x, y) = sprite top-left, optionally scaled. */
export function drawAvatarSprite(ctx: CanvasRenderingContext2D, look: Look, dir: number, frame: number, x: number, y: number, extra?: NpcKind) {
  blitSprite(ctx, avatarFrame(look, dir, frame, extra)!, x, y);
}

/** Draw an atlas frame with its top-left at (x, y); mirrored frames match Raster.mirror() pixel for pixel. */
export function blitSprite(ctx: CanvasRenderingContext2D, r: SpriteRef, x: number, y: number) {
  if (!r.flip) return ctx.drawImage(r.img, r.sx, r.sy, AV_W, AV_H, x, y, AV_W, AV_H);
  // Raster.mirror(): column c -> AV_W - c (reverse + 1px shift keeps the feet anchor)
  ctx.save();
  ctx.translate(x + AV_W + 1, y);
  ctx.scale(-1, 1);
  ctx.drawImage(r.img, r.sx, r.sy, AV_W, AV_H, 0, 0, AV_W, AV_H);
  ctx.restore();
}

// ---------------------------------------------------------------- typing indicator
const typingCache = new Map<number, HTMLCanvasElement>();
/** Small Habbo-style "…" speech bubble; frame 0..3 animates the dots. Anchor: bottom-centre of the tail. */
export function typingBubble(frame: number): HTMLCanvasElement {
  const f = ((frame % 4) + 4) % 4;
  const hit = typingCache.get(f);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 22;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  const p = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  p(2, 0, 18, 1, OUTLINE); p(2, 11, 18, 1, OUTLINE); p(1, 1, 1, 10, OUTLINE); p(20, 1, 1, 10, OUTLINE);
  p(0, 2, 1, 8, OUTLINE); p(21, 2, 1, 8, OUTLINE);
  p(2, 1, 18, 10, "#ffffff"); p(1, 2, 20, 8, "#ffffff");
  p(2, 9, 18, 2, "#dfe3ea");
  // tail
  p(9, 12, 4, 1, "#ffffff"); p(10, 13, 2, 1, "#ffffff"); p(8, 12, 1, 1, OUTLINE); p(13, 12, 1, 1, OUTLINE);
  p(9, 13, 1, 1, OUTLINE); p(12, 13, 1, 1, OUTLINE); p(10, 14, 2, 1, OUTLINE);
  for (let i = 0; i < 3; i++) {
    const up = f === i + 1 ? 1 : 0;
    p(5 + i * 5, 5 - up, 2, 2, f === i + 1 ? "#11131c" : "#5a5f6e");
  }
  typingCache.set(f, c);
  return c;
}
/** Draw the typing bubble above a point (e.g. the avatar's head), animated by time in ms. */
export function drawTyping(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, scale = 1) {
  const b = typingBubble(Math.floor(t / 220));
  ctx.drawImage(b, Math.round(x - 11 * scale), Math.round(y - 15 * scale), 22 * scale, 16 * scale);
}
