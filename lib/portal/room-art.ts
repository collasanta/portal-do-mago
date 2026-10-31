// Habbo-style room art for the Salão do Grimório: 64x32 tiles, crisp 2:1 pixel lines, 1px dark outlines on furni,
// patterned floors, two back walls with wallpaper and a thick edge. Everything is drawn procedurally; the floor + walls
// are pre-rendered once into a single canvas, every furni kind into its own cached sprite.
import { BLOCKS, MAP_W, MAP_H, isStage, type Block } from "./map";

export const TW = 64; // tile width (base px)
export const TH = 32; // tile height (base px)
export const WALL_H = 136; // wall height above the floor
const WALL_T = 8; // wall thickness (screen px of the cap)
const SLAB = 12; // floor thickness at the front edges
const PAD = 12;

export const ORIGIN_X = MAP_H * (TW / 2) + PAD + WALL_T; // screen x of tile (0,0) top vertex in floor canvas
export const ORIGIN_Y = WALL_H + WALL_T + PAD; // screen y of tile (0,0) top vertex

export function tileToScreen(x: number, y: number) {
  return { x: ORIGIN_X + (x - y) * (TW / 2), y: ORIGIN_Y + (x + y) * (TH / 2) };
}
/** Centre of tile (x,y) in floor-canvas space. Accepts fractional tiles. */
export function tileCenter(x: number, y: number) {
  return { x: ORIGIN_X + (x - y) * (TW / 2), y: ORIGIN_Y + (x + y + 1) * (TH / 2) };
}
export function screenToTile(sx: number, sy: number) {
  const u = (sx - ORIGIN_X) / (TW / 2);
  const v = (sy - ORIGIN_Y) / (TH / 2);
  return { x: Math.floor((u + v) / 2), y: Math.floor((v - u) / 2) };
}

// ---------------------------------------------------------------- colour + pixel primitives
type Ctx = CanvasRenderingContext2D;

function hexN(hex: string) {
  return parseInt(hex.slice(1, 7), 16);
}
function shade(hex: string, amt: number) {
  const n = hexN(hex);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5;
    s ^= s >>> 13;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function mk(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, col: string) {
  ctx.fillStyle = col;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Scanline polygon fill with no anti-aliasing: a pixel is filled when its centre is inside. */
function fillPoly(ctx: Ctx, pts: number[], col: string) {
  ctx.fillStyle = col;
  const n = pts.length / 2;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pts[i * 2 + 1]);
    maxY = Math.max(maxY, pts[i * 2 + 1]);
  }
  const xs: number[] = [];
  for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const x0 = pts[i * 2], y0 = pts[i * 2 + 1];
      const j = (i + 1) % n;
      const x1 = pts[j * 2], y1 = pts[j * 2 + 1];
      if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.round(xs[k]), b = Math.round(xs[k + 1]);
      if (b > a) ctx.fillRect(a, y, b - a, 1);
    }
  }
}

function fillEll(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, col: string) {
  ctx.fillStyle = col;
  for (let y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const hw = rx * Math.sqrt(1 - dy * dy);
    const a = Math.round(cx - hw), b = Math.round(cx + hw);
    if (b > a) ctx.fillRect(a, y, b - a, 1);
  }
}

/** Upright cylinder (ellipse footprint). */
function cyl(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, h: number, side: string, top: string) {
  fillEll(ctx, cx, cy, rx, ry, shade(side, -0.15));
  rect(ctx, cx - rx, cy - h, rx * 2, h, side);
  rect(ctx, cx + rx * 0.35, cy - h, rx * 0.65, h, shade(side, -0.2));
  rect(ctx, cx - rx * 0.7, cy - h, Math.max(2, rx * 0.2), h, shade(side, 0.18));
  fillEll(ctx, cx, cy - h, rx, ry, top);
}

function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, col: string) {
  ctx.fillStyle = col;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

type Pt = [number, number];
type BoxR = {
  L: Pt; F: Pt; R: Pt; B: Pt; // top corners
  /** point on the left (front-left, faces +y) face: t 0..1 from left corner to front corner, z above box base */
  fl: (t: number, z: number) => Pt;
  /** point on the right (front-right, faces +x) face: t 0..1 from front corner to right corner */
  fr: (t: number, z: number) => Pt;
  /** point on the top face, u/v in -0.5..0.5 */
  tp: (u: number, v: number) => Pt;
};

/**
 * Iso cuboid centred on ground point (cx,cy). sx/sy = footprint along the +x/+y tile axes (1 = full tile),
 * ox/oy = centre offset in tiles, z = elevation, h = height. Habbo shading: top light, left mid, right dark.
 */
function box(
  ctx: Ctx, cx: number, cy: number, h: number, top: string,
  o: { s?: number; sx?: number; sy?: number; ox?: number; oy?: number; z?: number; left?: string; right?: string; rim?: boolean } = {},
): BoxR {
  const ax = o.sx ?? o.s ?? 1, ay = o.sy ?? o.s ?? 1, z = o.z ?? 0, ox = o.ox ?? 0, oy = o.oy ?? 0;
  const X = (u: number, v: number) => cx + (ox + u * ax - oy - v * ay) * (TW / 2);
  const Y = (u: number, v: number) => cy + (ox + u * ax + oy + v * ay) * (TH / 2);
  const g = (u: number, v: number, d: number): Pt => [X(u, v), Y(u, v) - d];
  const L0 = g(-0.5, 0.5, z), F0 = g(0.5, 0.5, z), R0 = g(0.5, -0.5, z);
  const t = z + h;
  const L = g(-0.5, 0.5, t), F = g(0.5, 0.5, t), R = g(0.5, -0.5, t), B = g(-0.5, -0.5, t);
  const lc = o.left ?? shade(top, -0.2), rc = o.right ?? shade(top, -0.4);
  if (h > 0) {
    fillPoly(ctx, [...L0, ...F0, ...F, ...L], lc);
    fillPoly(ctx, [...F0, ...R0, ...R, ...F], rc);
  }
  fillPoly(ctx, [...L, ...F, ...R, ...B], top);
  if (o.rim !== false && h > 0) {
    const hl = shade(top, 0.28);
    line(ctx, L[0], L[1], F[0] - 1, F[1], hl);
    line(ctx, F[0], F[1], R[0], R[1], shade(top, 0.12));
    if (h > 3) line(ctx, F[0], F[1] + 1, F0[0], F0[1] - 1, shade(lc, 0.12));
  }
  return {
    L, F, R, B,
    fl: (tt, zz) => [L0[0] + (F0[0] - L0[0]) * tt, L0[1] + (F0[1] - L0[1]) * tt - zz],
    fr: (tt, zz) => [F0[0] + (R0[0] - F0[0]) * tt, F0[1] + (R0[1] - F0[1]) * tt - zz],
    tp: (u, v) => g(u, v, t),
  };
}

/** Quad on a face given a mapper (t,z) -> point. */
function faceQuad(ctx: Ctx, f: (t: number, z: number) => Pt, t0: number, t1: number, z0: number, z1: number, col: string) {
  fillPoly(ctx, [...f(t0, z0), ...f(t1, z0), ...f(t1, z1), ...f(t0, z1)], col);
}

/**
 * Habbo-style floor shadow: a flat, hard-edged iso diamond (2:1) nudged toward the bottom-right, away from the
 * top-left light. Translucent, so the outline pass skips it.
 */
function shadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number) {
  ctx.save();
  ctx.globalAlpha = 0.3;
  const x = cx + Math.round(rx * 0.18), y = cy + 1;
  const w = Math.round(rx * 1.05), h = Math.max(3, Math.round(Math.min(ry * 1.1, w / 2)));
  fillPoly(ctx, [x - w, y, x, y - h, x + w, y, x, y + h], "#000000");
  ctx.restore();
}

/** Habbo-style 1px dark outline around every opaque silhouette of a sprite canvas. */
function outline(c: HTMLCanvasElement, col = 0x0b0a10) {
  const ctx = c.getContext("2d")!;
  const W = c.width, H = c.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = d[i * 4 + 3] >= 200 ? 1 : 0;
  const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (solid[i]) continue;
      if ((x > 0 && solid[i - 1]) || (x < W - 1 && solid[i + 1]) || (y > 0 && solid[i - W]) || (y < H - 1 && solid[i + W])) {
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- crisp sign text (font rasterised, alpha thresholded)
function pixText(ctx: Ctx, s: string, x: number, y: number, px: number, col: string) {
  const w = pixTextW(s, px) + 4, h = Math.ceil(px * 1.3) + 2;
  const t = mk(w, h);
  t.ctx.font = `bold ${px}px Verdana, Arial, sans-serif`;
  t.ctx.textBaseline = "top";
  t.ctx.fillStyle = "#fff";
  t.ctx.fillText(s, 1, 1);
  const img = t.ctx.getImageData(0, 0, w, h);
  const n = hexN(col), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  for (let i = 0; i < w * h; i++) {
    const on = img.data[i * 4 + 3] > 110;
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = on ? 255 : 0;
  }
  t.ctx.putImageData(img, 0, 0);
  ctx.drawImage(t.c, Math.round(x) - 1, Math.round(y) - 1);
}
let measureCtx: Ctx | null = null;
function pixTextW(s: string, px: number) {
  measureCtx = measureCtx || mk(1, 1).ctx;
  measureCtx.font = `bold ${px}px Verdana, Arial, sans-serif`;
  return Math.ceil(measureCtx.measureText(s).width);
}

// ---------------------------------------------------------------- furni sprites
export type Sprite = { c: HTMLCanvasElement; ax: number; ay: number };
const spriteCache = new Map<string, Sprite | null>();
const SW = 200, SH = 280, SCX = 100, SCY = 236;

const BOOKS = ["#e8442e", "#2f6fdc", "#ffc93a", "#2fae6a", "#8a4fd8", "#f2efe6", "#f28c28", "#18c0c8", "#d6407a"];

export function blockSprite(key: string): Sprite | null {
  if (spriteCache.has(key)) return spriteCache.get(key)!;
  // "<kind>@f" = only the part drawn in front of a seated avatar (backrest facing the camera); "<kind>" then skips it
  const front = key.endsWith("@f");
  const kind = front ? key.slice(0, -2) : key;
  const { c, ctx } = mk(SW, SH);
  const cx = SCX, cy = SCY;
  const r = rng(kind.length * 977 + kind.charCodeAt(0) * 31 + kind.charCodeAt(kind.length - 1));
  let drawn = true;
  switch (kind) {
    case "plant": {
      shadow(ctx, cx, cy, 22, 10);
      const p = box(ctx, cx, cy, 24, "#d56a3c", { s: 0.42 });
      box(ctx, cx, cy, 5, "#e88a56", { s: 0.5, z: 22 });
      fillPoly(ctx, [...p.tp(-0.42, 0), ...p.tp(0, 0.42), ...p.tp(0.42, 0), ...p.tp(0, -0.42)].map((v, i) => (i % 2 ? v - 3 : v)), "#3a2414");
      // round bush of leaves
      const greens = ["#2a7f37", "#38a143", "#4fbf4c", "#78d65e"];
      for (let i = 0; i < 22; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 20;
        const lx = cx + Math.cos(a) * d * 1.2, ly = cy - 52 + Math.sin(a) * d * 0.9;
        fillEll(ctx, lx, ly, 8, 6, greens[Math.min(3, Math.floor((1 - (ly - (cy - 72)) / 44) * 2.6 + r() * 1.2))]);
      }
      for (let i = 0; i < 6; i++) rect(ctx, cx - 14 + r() * 28, cy - 66 + r() * 24, 2, 2, "#a6ec7e");
      break;
    }
    case "palm": {
      shadow(ctx, cx, cy, 26, 12);
      box(ctx, cx, cy, 26, "#3a6fd8", { s: 0.5 });
      box(ctx, cx, cy, 5, "#5a8ff0", { s: 0.58, z: 24 });
      // trunk
      for (let i = 0; i < 9; i++) rect(ctx, cx - 4 + Math.sin(i * 0.6) * 2, cy - 32 - i * 8, 9, 8, i % 2 ? "#8a5a32" : "#a8703e");
      // fronds
      const top: Pt = [cx + 1, cy - 104];
      const fr = [
        [-2.6, 46], [-2.1, 52], [-1.5, 40], [-0.9, 34], [-0.3, 44], [0.2, 50], [0.7, 38], [1.2, 30], [2.4, 42], [-3.0, 30], [3.0, 36],
      ];
      for (const [k, len] of fr) {
        const a = -Math.PI / 2 + k * 0.62;
        const tx = top[0] + Math.cos(a) * len * 1.25, ty = top[1] + Math.sin(a) * len * 0.75 + Math.abs(k) * 9;
        const mx = (top[0] + tx) / 2, my = (top[1] + ty) / 2 - 8;
        const nx = -(ty - top[1]), ny = tx - top[0];
        const nl = Math.hypot(nx, ny) || 1;
        const w = 9;
        const col = k < -1 || k > 1.5 ? "#2a8a3a" : k < 0 ? "#3aa846" : "#58c454";
        fillPoly(ctx, [top[0], top[1], mx + (nx / nl) * w, my + (ny / nl) * w, tx, ty, mx - (nx / nl) * w * 0.5, my - (ny / nl) * w * 0.5], col);
        line(ctx, top[0], top[1], tx, ty, shade(col, 0.3));
      }
      fillEll(ctx, top[0], top[1] + 2, 5, 4, "#6b4424");
      break;
    }
    case "lamp": {
      shadow(ctx, cx, cy, 14, 7);
      box(ctx, cx, cy, 5, "#2e3142", { s: 0.32 });
      rect(ctx, cx - 2, cy - 98, 4, 94, "#4a4f66");
      rect(ctx, cx - 2, cy - 98, 1, 94, "#8a90aa");
      // shade (trapezoid)
      fillPoly(ctx, [cx - 11, cy - 132, cx + 11, cy - 132, cx + 19, cy - 98, cx - 19, cy - 98], "#ffd25e");
      fillPoly(ctx, [cx - 11, cy - 132, cx, cy - 132, cx - 2, cy - 98, cx - 19, cy - 98], "#ffe89c");
      fillEll(ctx, cx, cy - 98, 19, 5, "#fff6cf");
      rect(ctx, cx - 11, cy - 133, 22, 2, "#e8a83a");
      break;
    }
    case "bookshelf": {
      shadow(ctx, cx - 8, cy, 30, 14);
      const b = box(ctx, cx, cy, 108, "#9a6236", { sx: 0.42, sy: 0.98, ox: -0.27, right: "#7a4a26" });
      faceQuad(ctx, b.fr, 0.05, 0.95, 6, 102, "#3a2214");
      const rows = [8, 33, 58, 83];
      for (const z0 of rows) {
        faceQuad(ctx, b.fr, 0.05, 0.95, z0 - 3, z0, "#c58a50");
        let t = 0.08;
        while (t < 0.9) {
          const w = 0.045 + r() * 0.035;
          const hgt = 14 + Math.floor(r() * 7);
          if (r() < 0.12) { t += w; continue; }
          const col = BOOKS[Math.floor(r() * BOOKS.length)];
          faceQuad(ctx, b.fr, t, Math.min(0.92, t + w), z0, z0 + hgt, col);
          faceQuad(ctx, b.fr, t, Math.min(0.92, t + w * 0.3), z0, z0 + hgt, shade(col, 0.25));
          t += w + 0.006;
        }
      }
      faceQuad(ctx, b.fr, 0.05, 0.95, 100, 103, "#c58a50");
      break;
    }
    case "mural": {
      // Mural de Links: wooden frame + cork board pinned with coloured link cards
      shadow(ctx, cx - 8, cy, 30, 14);
      const b = box(ctx, cx, cy, 108, "#9a6236", { sx: 0.42, sy: 0.98, ox: -0.27, right: "#7a4a26" });
      faceQuad(ctx, b.fr, 0.05, 0.95, 6, 102, "#3a2214");
      faceQuad(ctx, b.fr, 0.09, 0.91, 10, 98, "#b98a55");
      const cards: [number, number, number, number, string][] = [
        [0.14, 0.46, 62, 90, "#ffd700"], [0.52, 0.86, 66, 92, "#7cc8ff"],
        [0.14, 0.40, 30, 56, "#ff8aa0"], [0.46, 0.60, 36, 54, "#ffffff"], [0.64, 0.86, 26, 58, "#6ee7a0"],
        [0.16, 0.50, 14, 26, "#c9a8ff"],
      ];
      for (const [t0, t1, z0, z1, col] of cards) {
        faceQuad(ctx, b.fr, t0, t1, z0, z1, col);
        faceQuad(ctx, b.fr, t0 + 0.02, t1 - 0.02, z1 - 4, z1 - 3, shade(col, 0.3));
        faceQuad(ctx, b.fr, (t0 + t1) / 2 - 0.01, (t0 + t1) / 2 + 0.01, z1 - 2, z1, "#d83a3a");
      }
      break;
    }
    case "speaker": {
      shadow(ctx, cx, cy, 26, 12);
      const b = box(ctx, cx, cy, 88, "#34364a", { s: 0.74, left: "#262838", right: "#1a1b28" });
      const woofer = (z: number, rr: number) => {
        const [x, y] = b.fl(0.5, z);
        fillEll(ctx, x, y, rr, rr * 1.05, "#0e0f16");
        fillEll(ctx, x, y, rr - 2, rr * 1.05 - 2, "#4a4e66");
        fillEll(ctx, x, y, rr * 0.55, rr * 0.58, "#2a2c3c");
        fillEll(ctx, x - 1, y - 1, rr * 0.25, rr * 0.28, "#8a90b0");
      };
      woofer(24, 13);
      woofer(56, 10);
      woofer(78, 4);
      line(ctx, b.L[0], b.L[1] + 1, b.F[0], b.F[1] + 1, "#ff4fd8");
      line(ctx, b.F[0], b.F[1] + 1, b.R[0], b.R[1] + 1, "#c23aa8");
      for (let z = 12; z < 80; z += 8) faceQuad(ctx, b.fr, 0.2, 0.8, z, z + 2, "#121320");
      break;
    }
    case "dj_l":
    case "dj_r": {
      shadow(ctx, cx, cy, 34, 14);
      const b = box(ctx, cx, cy, 38, "#3a2f66", { sx: 1, sy: 0.8, left: "#2a2150", right: "#1d1740", rim: false });
      faceQuad(ctx, b.fl, 0, 1, 20, 23, "#45f0ff");
      faceQuad(ctx, b.fl, 0, 1, 23, 24, "#1d9ab8");
      faceQuad(ctx, b.fl, 0, 1, 6, 8, "#ff4fd8");
      if (kind === "dj_r") faceQuad(ctx, b.fr, 0, 1, 20, 23, "#2bb5d0");
      // slab
      box(ctx, cx, cy, 4, "#20202c", { sx: 1, sy: 0.86, z: 38 });
      const [tx, ty] = b.tp(0, 0);
      if (kind === "dj_l") {
        fillEll(ctx, tx - 6, ty - 5, 15, 8, "#0c0c12");
        fillEll(ctx, tx - 6, ty - 5, 12, 6, "#262633");
        fillEll(ctx, tx - 6, ty - 5, 4, 2, "#ff4f7a");
        line(ctx, tx + 8, ty - 10, tx - 2, ty - 4, "#c9ced6");
        rect(ctx, tx + 7, ty - 11, 3, 3, "#c9ced6");
      } else {
        box(ctx, tx - cx - 6 + cx, ty - 4 + 4, 4, "#3a3b4c", { sx: 0.32, sy: 0.4 });
        for (let i = 0; i < 4; i++) rect(ctx, tx - 12 + i * 4, ty - 8 + i * 2, 2, 2, ["#45f0ff", "#ff4fd8", "#ffd25e", "#7cf06b"][i]);
        // laptop
        fillPoly(ctx, [tx + 4, ty - 2, tx + 20, ty - 10, tx + 20, ty - 30, tx + 4, ty - 22], "#2b2d3a");
        fillPoly(ctx, [tx + 6, ty - 5, tx + 18, ty - 11, tx + 18, ty - 27, tx + 6, ty - 21], "#5fd0ff");
        rect(ctx, tx + 9, ty - 18, 6, 2, "#ffffff");
      }
      break;
    }
    case "bench": {
      shadow(ctx, cx, cy, 30, 10);
      box(ctx, cx, cy, 8, "#2a2240", { sx: 0.96, sy: 0.42 });
      const s = box(ctx, cx, cy, 10, "#a05ae0", { sx: 1, sy: 0.5, z: 8 });
      for (const u of [-0.25, 0.25]) {
        const [x, y] = s.tp(u, 0);
        rect(ctx, x - 1, y, 2, 1, "#6b34a8");
      }
      break;
    }
    case "otable_crystal": {
      const ox = cx, oy = cy - 16; // centre of the 2x2
      shadow(ctx, ox, oy, 56, 26);
      // pedestal foot
      cyl(ctx, ox, oy, 14, 7, 10, "#3a2a1c", "#5a3f28");
      // cloth-covered round table (cylinder)
      fillEll(ctx, ox, oy - 12, 52, 26, "#3a1d6b");
      rect(ctx, ox - 52, oy - 30, 104, 18, "#4c2a88");
      rect(ctx, ox + 10, oy - 30, 42, 18, "#3c1f70");
      rect(ctx, ox - 46, oy - 30, 8, 18, "#5e38a0");
      for (let x = -50; x < 50; x += 6) rect(ctx, ox + x, oy - 14 + Math.round(Math.sqrt(Math.max(0, 1 - (x / 52) ** 2)) * 26) - 1 + (x / 6) % 2, 3, 2, "#ffc93a");
      fillEll(ctx, ox, oy - 30, 52, 26, "#ffc93a");
      fillEll(ctx, ox, oy - 31, 49, 24, "#7a4ac8");
      fillEll(ctx, ox, oy - 31, 40, 19, "#6a3cb8");
      // star pattern on cloth
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        rect(ctx, ox + Math.cos(a) * 44, oy - 31 + Math.sin(a) * 21, 2, 2, "#ffe68a");
      }
      // tarot cards + candle
      fillPoly(ctx, [ox - 34, oy - 30, ox - 24, oy - 35, ox - 16, oy - 31, ox - 26, oy - 26], "#f6ecd0");
      fillPoly(ctx, [ox - 32, oy - 30, ox - 25, oy - 33, ox - 19, oy - 31, ox - 26, oy - 28], "#c23a4a");
      fillPoly(ctx, [ox + 14, oy - 22, ox + 24, oy - 27, ox + 32, oy - 23, ox + 22, oy - 18], "#f6ecd0");
      fillPoly(ctx, [ox + 16, oy - 22, ox + 23, oy - 25, ox + 29, oy - 23, ox + 22, oy - 20], "#2f6fdc");
      cyl(ctx, ox + 30, oy - 38, 3, 2, 10, "#f6ecd0", "#fff8e8");
      rect(ctx, ox + 29, oy - 53, 3, 5, "#ffb03a");
      rect(ctx, ox + 30, oy - 55, 1, 3, "#fff2a0");
      // crystal ball on a gold stand
      fillPoly(ctx, [ox - 12, oy - 32, ox + 12, oy - 32, ox + 8, oy - 40, ox - 8, oy - 40], "#d4a02a");
      fillEll(ctx, ox, oy - 32, 12, 4, "#b8861e");
      fillEll(ctx, ox, oy - 56, 18, 18, "#2f8fd8");
      fillEll(ctx, ox - 2, oy - 58, 15, 15, "#5fd0ff");
      fillEll(ctx, ox - 4, oy - 61, 9, 9, "#a8ecff");
      fillEll(ctx, ox + 3, oy - 52, 5, 4, "#c47cff");
      rect(ctx, ox - 9, oy - 67, 5, 4, "#ffffff");
      rect(ctx, ox - 10, oy - 63, 2, 2, "#ffffff");
      break;
    }
    case "pedestal_book": {
      const ox = cx, oy = cy - 16;
      shadow(ctx, ox, oy, 60, 28);
      box(ctx, ox, oy, 10, "#b9b2d0", { s: 1.75 });
      box(ctx, ox, oy, 10, "#d4cde6", { s: 1.35, z: 10 });
      const col = box(ctx, ox, oy, 34, "#ece6f8", { s: 0.78, z: 20 });
      faceQuad(ctx, col.fl, 0, 1, 14, 18, "#e0b23a");
      faceQuad(ctx, col.fr, 0, 1, 14, 18, "#b88a1e");
      box(ctx, ox, oy, 6, "#f0c64a", { s: 1.05, z: 54 });
      // open book
      const by = oy - 66;
      fillPoly(ctx, [ox - 30, by + 2, ox, by + 16, ox + 30, by + 2, ox + 30, by + 6, ox, by + 20, ox - 30, by + 6], "#8a1f34");
      fillPoly(ctx, [ox - 28, by, ox, by + 13, ox, by - 1, ox - 26, by - 13], "#efe2bd");
      fillPoly(ctx, [ox, by + 13, ox + 28, by, ox + 26, by - 13, ox, by - 1], "#fbf2d8");
      for (let i = 0; i < 5; i++) {
        line(ctx, ox - 22 + i, by - 8 + i * 3, ox - 5, by + i * 3 - 0 + 1, "#a8946a");
        line(ctx, ox + 5, by + 1 + i * 3, ox + 21 - i, by - 7 + i * 3, "#a8946a");
      }
      rect(ctx, ox - 1, by - 1, 2, 14, "#d4c49a");
      // floating sparkle runes
      for (const [dx, dy] of [[-22, -24], [18, -30], [2, -40]]) {
        rect(ctx, ox + dx, by + dy, 2, 6, "#ffe68a");
        rect(ctx, ox + dx - 2, by + dy + 2, 6, 2, "#ffe68a");
      }
      break;
    }
    case "desk":
    case "desk_pc": {
      shadow(ctx, cx, cy, 30, 14);
      for (const [u, v] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) box(ctx, cx, cy, 26, "#6e4526", { s: 0.08, ox: u, oy: v, rim: false });
      const top = box(ctx, cx, cy, 6, "#d4955a", { s: 0.94, z: 26 });
      if (kind === "desk_pc") {
        const m = box(ctx, cx, cy, 30, "#dcd8ca", { sx: 0.42, sy: 0.38, z: 32, oy: -0.18 });
        faceQuad(ctx, m.fl, 0.1, 0.9, 6, 26, "#1a2a6e");
        faceQuad(ctx, m.fl, 0.16, 0.84, 9, 23, "#2f6fdc");
        faceQuad(ctx, m.fl, 0.22, 0.6, 18, 20, "#9fd8ff");
        faceQuad(ctx, m.fl, 0.22, 0.75, 13, 15, "#ffd25e");
        box(ctx, cx, cy, 2, "#f0eee6", { sx: 0.36, sy: 0.14, z: 32, oy: 0.26 });
      } else {
        const [x, y] = top.tp(-0.05, 0.05);
        fillPoly(ctx, [x - 14, y, x, y + 7, x + 14, y, x, y - 7], "#f6f2e6");
        fillPoly(ctx, [x - 10, y - 2, x + 2, y + 4, x + 14, y - 2, x + 2, y - 8], "#ffffff");
        line(ctx, x - 4, y - 1, x + 6, y - 6, "#8a90aa");
        cyl(ctx, x + 18, y + 4, 4, 2, 8, "#e8442e", "#5a2a14");
      }
      break;
    }
    case "chair": {
      if (front) {
        box(ctx, cx, cy, 28, "#3a7bd5", { sx: 0.56, sy: 0.1, oy: 0.24, z: 26 });
        break;
      }
      shadow(ctx, cx, cy, 20, 9);
      for (const [u, v] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) box(ctx, cx, cy, 20, "#2a2d3a", { s: 0.06, ox: u, oy: v, rim: false });
      box(ctx, cx, cy, 6, "#3a7bd5", { s: 0.56, z: 20 });
      break;
    }
    case "aud": {
      // theatre chair facing the stage (-y): velvet seat + armrests; the tall backrest (+y side) is the "@f" part
      if (front) {
        box(ctx, cx, cy, 20, "#a8203a", { sx: 0.74, sy: 0.12, oy: 0.3, z: 8, left: "#7a1426", right: "#5a0e1c" });
        box(ctx, cx, cy, 3, "#ffc93a", { sx: 0.76, sy: 0.14, oy: 0.3, z: 28 });
        break;
      }
      shadow(ctx, cx, cy, 24, 11);
      box(ctx, cx, cy, 10, "#2a1d30", { sx: 0.6, sy: 0.5, oy: 0.04, rim: false });
      box(ctx, cx, cy, 6, "#d0304e", { sx: 0.66, sy: 0.6, oy: 0.02, z: 10 });
      for (const u of [-0.38, 0.38]) box(ctx, cx, cy, 20, "#3a2a40", { sx: 0.08, sy: 0.62, ox: u, oy: 0.04, left: "#2a1d30", right: "#1d1424" });
      break;
    }
    case "stool": {
      shadow(ctx, cx, cy, 14, 7);
      fillEll(ctx, cx, cy, 11, 5, "#5a6278");
      rect(ctx, cx - 2, cy - 32, 4, 32, "#9aa3b5");
      rect(ctx, cx - 2, cy - 32, 1, 32, "#dfe4ee");
      cyl(ctx, cx, cy - 32, 14, 7, 7, "#b8233c", "#e43c58");
      rect(ctx, cx - 7, cy - 42, 6, 2, "#ff8aa0");
      break;
    }
    case "cauldron": {
      shadow(ctx, cx, cy, 28, 12);
      for (const dx of [-14, 12]) rect(ctx, cx + dx, cy - 8, 4, 8, "#1a1b22");
      fillPoly(ctx, [cx - 14, cy - 2, cx - 4, cy - 14, cx + 2, cy - 4, cx + 8, cy - 16, cx + 14, cy - 2], "#ff7a2a");
      fillPoly(ctx, [cx - 8, cy - 2, cx - 2, cy - 10, cx + 4, cy - 2], "#ffd25e");
      fillEll(ctx, cx, cy - 26, 26, 19, "#23242e");
      fillEll(ctx, cx - 8, cy - 30, 10, 8, "#3a3c4c");
      fillEll(ctx, cx, cy - 40, 25, 10, "#4a4c5e");
      fillEll(ctx, cx, cy - 40, 21, 8, "#3ad46a");
      fillEll(ctx, cx - 4, cy - 41, 12, 4, "#7cf096");
      for (const [dx, dy, rr] of [[-8, -42, 3], [6, -39, 2], [2, -44, 2]]) fillEll(ctx, cx + dx, cy + dy, rr, rr, "#c8ffd4");
      fillEll(ctx, cx + 4, cy - 56, 4, 4, "#7cf096");
      fillEll(ctx, cx - 6, cy - 64, 3, 3, "#a8ffbe");
      break;
    }
    case "bar":
    case "bar_tap":
    case "bar_glass": {
      const b = box(ctx, cx, cy, 44, "#4a3478", { sx: 0.66, sy: 1, left: "#3a2862", right: "#2e1f52", rim: false });
      faceQuad(ctx, b.fr, 0, 1, 30, 33, "#45f0ff");
      faceQuad(ctx, b.fr, 0, 1, 33, 34, "#1d9ab8");
      faceQuad(ctx, b.fr, 0, 1, 0, 4, "#1a1230");
      for (const t of [0.25, 0.75]) faceQuad(ctx, b.fr, t - 0.004, t + 0.012, 6, 28, "#3a2862");
      faceQuad(ctx, b.fl, 0, 1, 30, 33, "#45f0ff");
      const top = box(ctx, cx, cy, 6, "#ece6f4", { sx: 0.84, sy: 1, z: 44, ox: 0.06, left: "#bdb4d0", right: "#9e94b8" });
      const [x, y] = top.tp(0.05, 0);
      if (kind === "bar_tap") {
        rect(ctx, x - 10, y - 24, 22, 4, "#c9ced6");
        for (const [i, colr] of [[0, "#ffc93a"], [1, "#e8442e"], [2, "#45f0ff"]] as [number, string][]) {
          rect(ctx, x - 8 + i * 8, y - 20, 3, 14, "#9aa3b5");
          rect(ctx, x - 9 + i * 8, y - 34, 5, 10, colr);
        }
      } else if (kind === "bar_glass") {
        // cocktail glass + bottle
        fillPoly(ctx, [x - 14, y - 26, x - 2, y - 26, x - 8, y - 16], "#ff7ad0");
        fillPoly(ctx, [x - 13, y - 26, x - 3, y - 26, x - 8, y - 22], "#ffb8e6");
        rect(ctx, x - 9, y - 16, 2, 12, "#dfe4ee");
        rect(ctx, x - 12, y - 5, 8, 2, "#dfe4ee");
        rect(ctx, x - 4, y - 30, 2, 4, "#7cf06b");
        rect(ctx, x + 6, y - 30, 8, 24, "#2f9a58");
        rect(ctx, x + 8, y - 38, 4, 8, "#2f9a58");
        rect(ctx, x + 6, y - 22, 8, 7, "#f6ecd0");
        rect(ctx, x + 7, y - 29, 2, 20, "#6bd88e");
      } else {
        cyl(ctx, x - 4, y - 4, 5, 2, 12, "#ffc93a", "#fff6cf");
        rect(ctx, x - 9, y - 13, 10, 3, "#ffffff");
      }
      break;
    }
    case "barrels": {
      for (const [dx, dy] of [[-10, -4], [10, 4]]) {
        shadow(ctx, cx + dx, cy + dy, 14, 6);
        cyl(ctx, cx + dx, cy + dy, 13, 6, 32, "#a8642e", "#c98a4e");
        rect(ctx, cx + dx - 13, cy + dy - 8, 26, 3, "#4a3a30");
        rect(ctx, cx + dx - 13, cy + dy - 26, 26, 3, "#4a3a30");
        fillEll(ctx, cx + dx, cy + dy - 32, 9, 4, "#a8703e");
        rect(ctx, cx + dx - 1, cy + dy - 18, 3, 3, "#2a1a10");
      }
      break;
    }
    case "sofaX0":
    case "sofaX1":
    case "sofaY0":
    case "sofaY1":
    case "sofaX0b":
    case "sofaX1b":
    case "sofaY0b":
    case "sofaY1b": {
      const col = kind.endsWith("b") ? "#3a6fe0" : "#d03a56";
      const alongX = kind.startsWith("sofaX");
      const end = kind.includes("0") ? -1 : 1;
      if (!front) shadow(ctx, cx, cy, 34, 14);
      type Part = { k: number; f: () => void };
      const parts: Part[] = [];
      if (alongX) {
        parts.push({ k: -0.33, f: () => box(ctx, cx, cy, 38, shade(col, -0.05), { sx: 1, sy: 0.26, oy: -0.34 }) });
        parts.push({ k: 0.1, f: () => box(ctx, cx, cy, 18, col, { sx: 1, sy: 0.72, oy: 0.12 }) });
        parts.push({ k: end * 0.42 + 0.12, f: () => box(ctx, cx, cy, 28, shade(col, 0.06), { sx: 0.18, sy: 0.96, ox: end * 0.41 }) });
      } else {
        // the backrest (+x) is in front of whoever sits here: "@f" draws only it, the base skips it
        if (front) {
          // lower than the far-side backrest so whoever sits here still shows from the chest up
          box(ctx, cx, cy, 27, shade(col, -0.05), { sx: 0.24, sy: 1, ox: 0.36 });
          break;
        }
        parts.push({ k: 0.0, f: () => box(ctx, cx, cy, 18, col, { sx: 0.72, sy: 1, ox: -0.12 }) });
        parts.push({ k: end * 0.42 + 0.1, f: () => box(ctx, cx, cy, 28, shade(col, 0.06), { sx: 0.96, sy: 0.18, oy: end * 0.41 }) });
      }
      parts.sort((a, b) => a.k - b.k).forEach((p) => p.f());
      break;
    }
    case "ctable": {
      shadow(ctx, cx, cy, 26, 12);
      rect(ctx, cx - 2, cy - 18, 4, 18, "#9aa3b5");
      fillEll(ctx, cx, cy, 10, 4, "#6b7385");
      fillEll(ctx, cx, cy - 20, 26, 13, "#4a8fb0");
      fillEll(ctx, cx, cy - 22, 26, 13, "#9fe6ff");
      fillEll(ctx, cx - 6, cy - 25, 12, 5, "#d8f6ff");
      cyl(ctx, cx - 8, cy - 22, 4, 2, 10, "#ffc93a", "#fff6cf");
      cyl(ctx, cx + 8, cy - 18, 4, 2, 9, "#e8442e", "#ff9a8a");
      break;
    }
    case "rtable": {
      shadow(ctx, cx, cy, 20, 9);
      fillEll(ctx, cx, cy, 12, 5, "#5a6278");
      rect(ctx, cx - 2, cy - 40, 4, 40, "#9aa3b5");
      rect(ctx, cx - 2, cy - 40, 1, 40, "#dfe4ee");
      cyl(ctx, cx, cy - 40, 22, 11, 4, "#2a2240", "#45f0ff");
      fillEll(ctx, cx, cy - 44, 19, 9, "#1f2a5a");
      cyl(ctx, cx - 6, cy - 44, 3, 2, 9, "#ff7ad0", "#ffc4f2");
      cyl(ctx, cx + 7, cy - 42, 3, 2, 8, "#ffc93a", "#fff6cf");
      break;
    }
    case "arcade":
    case "arcade2": {
      const col = kind === "arcade" ? "#7a3fd0" : "#d6304a";
      shadow(ctx, cx, cy, 30, 14);
      const b = box(ctx, cx, cy, 92, col, { sx: 0.62, sy: 0.82, ox: -0.18 });
      faceQuad(ctx, b.fr, 0.12, 0.88, 46, 76, "#0a0e24");
      faceQuad(ctx, b.fr, 0.16, 0.84, 49, 73, "#14205a");
      const [sx0, sy0] = b.fr(0.5, 60);
      fillEll(ctx, sx0 - 4, sy0 - 2, 5, 5, "#ffd25e");
      fillPoly(ctx, [sx0 - 4, sy0 - 2, sx0 + 1, sy0 - 5, sx0 + 1, sy0 + 1], "#14205a");
      for (let i = 0; i < 3; i++) rect(ctx, sx0 + 4 + i * 4, sy0 - 4 + i * 2 - 2, 2, 2, "#f2efe6");
      rect(ctx, sx0 - 14, sy0 + 6, 3, 3, "#ff4fd8");
      faceQuad(ctx, b.fr, 0.1, 0.9, 80, 88, "#ffd25e");
      faceQuad(ctx, b.fr, 0.2, 0.8, 82, 86, "#fff2a0");
      // control deck
      const d = box(ctx, cx, cy, 6, "#262838", { sx: 0.26, sy: 0.8, ox: 0.25, z: 36 });
      const [jx, jy] = d.tp(0, 0.2);
      rect(ctx, jx - 1, jy - 10, 2, 10, "#9aa3b5");
      fillEll(ctx, jx, jy - 11, 3, 3, "#e8442e");
      const [bx, by] = d.tp(0, -0.2);
      rect(ctx, bx - 3, by - 3, 3, 2, "#45f0ff");
      rect(ctx, bx + 2, by - 1, 3, 2, "#7cf06b");
      // side stripes
      faceQuad(ctx, b.fl, 0, 1, 30, 34, shade(col, 0.35));
      faceQuad(ctx, b.fl, 0, 1, 40, 42, "#ffd25e");
      break;
    }
    // ------------------------------------------------ Sala de TV
    case "tvstand0":
    case "tvstand1":
    case "tvstand2": {
      // low walnut media console against the back wall (y = 0); drawers face the room (+y, left face)
      shadow(ctx, cx, cy, 30, 12);
      const b = box(ctx, cx, cy, 24, "#8a5530", { sx: 1, sy: 0.5, oy: -0.22, left: "#6e4122", right: "#4e2d16" });
      faceQuad(ctx, b.fl, 0.06, 0.94, 4, 20, "#5a341a");
      faceQuad(ctx, b.fl, 0.1, 0.9, 6, 18, "#7a4a26");
      const [kx, ky] = b.fl(0.5, 12);
      rect(ctx, kx - 3, ky - 1, 6, 2, "#ffc93a");
      if (kind === "tvstand1") {
        // VHS player with a blinking-clock display
        const v = box(ctx, cx, cy, 8, "#2a2d3a", { sx: 0.7, sy: 0.36, oy: -0.2, z: 24, left: "#1d1f2a", right: "#14151d" });
        faceQuad(ctx, v.fl, 0.12, 0.5, 2, 6, "#0a0b10");
        faceQuad(ctx, v.fl, 0.62, 0.86, 3, 5, "#45f0ff");
      } else if (kind === "tvstand0") {
        // stack of tapes
        for (let i = 0; i < 3; i++) box(ctx, cx, cy, 4, ["#1c1b26", "#2a2240", "#1c1b26"][i], { sx: 0.34, sy: 0.22, oy: -0.2, ox: -0.1, z: 24 + i * 4 });
        box(ctx, cx, cy, 1, "#f2efe6", { sx: 0.2, sy: 0.12, oy: -0.2, ox: -0.1, z: 36, rim: false });
      } else {
        // game console + controller
        box(ctx, cx, cy, 6, "#d8d4c8", { sx: 0.4, sy: 0.3, oy: -0.2, ox: 0.05, z: 24 });
        box(ctx, cx, cy, 2, "#3a3f52", { sx: 0.22, sy: 0.12, oy: 0.08, ox: -0.22, z: 24 });
      }
      break;
    }
    case "vhsshelf": {
      // "Lives anteriores" shelf: VHS tapes with coloured labels, against the back wall under the poster
      shadow(ctx, cx, cy, 30, 12);
      const b = box(ctx, cx, cy, 62, "#6a3f22", { sx: 0.96, sy: 0.42, oy: -0.27, left: "#7a4a26", right: "#4e2d16" });
      faceQuad(ctx, b.fl, 0.05, 0.95, 4, 58, "#2a1a10");
      for (const z0 of [6, 32]) {
        faceQuad(ctx, b.fl, 0.05, 0.95, z0 - 3, z0, "#c58a50");
        let t = 0.08;
        while (t < 0.88) {
          const w = 0.07;
          const lab = ["#ffc93a", "#e8283c", "#45f0ff", "#ffffff", "#7cf06b"][Math.floor(r() * 5)];
          faceQuad(ctx, b.fl, t, t + w, z0, z0 + 20, "#14131c");
          faceQuad(ctx, b.fl, t + 0.012, t + w - 0.012, z0 + 6, z0 + 14, lab);
          t += w + 0.012;
        }
      }
      faceQuad(ctx, b.fl, 0.05, 0.95, 56, 59, "#c58a50");
      break;
    }
    case "tvsofa0":
    case "tvsofa1":
    case "tvsofa2":
    case "tvarm": {
      // 3-piece sofa (0 = -x end, 2 = +x end) and an armchair, facing the TV (-y); the backrest (+y) is the "@f" part
      const col = kind === "tvarm" ? "#2a9d8f" : "#d9822b";
      if (front) {
        box(ctx, cx, cy, 30, shade(col, -0.08), { sx: kind === "tvarm" ? 0.92 : 1, sy: 0.24, oy: 0.36 });
        break;
      }
      shadow(ctx, cx, cy, 34, 14);
      const ends = kind === "tvarm" ? [-1, 1] : kind === "tvsofa0" ? [-1] : kind === "tvsofa2" ? [1] : [];
      for (const e of ends.filter((e) => e < 0)) box(ctx, cx, cy, 28, shade(col, 0.06), { sx: 0.18, sy: 0.96, ox: e * 0.41 });
      box(ctx, cx, cy, 18, col, { sx: kind === "tvarm" ? 0.7 : 1, sy: 0.72, oy: -0.12 });
      for (const e of ends.filter((e) => e > 0)) box(ctx, cx, cy, 28, shade(col, 0.06), { sx: 0.18, sy: 0.96, ox: e * 0.41 });
      break;
    }
    case "beanbag": {
      shadow(ctx, cx, cy, 24, 11);
      fillEll(ctx, cx, cy - 8, 22, 12, "#6a2fb0");
      fillEll(ctx, cx, cy - 12, 19, 10, "#8a4fd8");
      fillEll(ctx, cx + 4, cy - 20, 13, 9, "#7a3fc8");
      fillEll(ctx, cx - 6, cy - 15, 7, 4, "#b48cf0");
      break;
    }
    case "cat": {
      const k = "#1c1b26";
      shadow(ctx, cx, cy, 14, 5);
      fillEll(ctx, cx - 2, cy - 10, 12, 9, k);
      fillEll(ctx, cx + 8, cy - 22, 8, 7, k);
      fillPoly(ctx, [cx + 1, cy - 26, cx + 3, cy - 34, cx + 7, cy - 27], k);
      fillPoly(ctx, [cx + 9, cy - 27, cx + 14, cy - 34, cx + 15, cy - 24], k);
      rect(ctx, cx - 16, cy - 16, 4, 12, k);
      rect(ctx, cx - 18, cy - 20, 4, 6, k);
      rect(ctx, cx + 5, cy - 23, 2, 2, "#ffd25e");
      rect(ctx, cx + 11, cy - 23, 2, 2, "#ffd25e");
      rect(ctx, cx + 8, cy - 19, 2, 1, "#ff9ab0");
      rect(ctx, cx - 6, cy - 16, 4, 2, "#34333f");
      break;
    }
    default:
      drawn = false;
  }
  let s: Sprite | null = null;
  if (drawn) {
    outline(c);
    s = { c, ax: cx, ay: cy };
  }
  spriteCache.set(key, s);
  return s;
}

// ---------------------------------------------------------------- floor
type RGB = number;
const C = (hex: string): RGB => hexN(hex);
const adj = (c: RGB, d: number): RGB => {
  const f = (v: number) => Math.max(0, Math.min(255, v + d));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
};

const DISCO = ["#ff4fd8", "#45f0ff", "#ffd25e", "#7cf06b", "#a06bff", "#ff8a3a"].map(C);
const HALL_A = C("#5f6a8e"), HALL_B = C("#56618a");
const NEON = C("#7af8ff"), NEON_G = C("#2fb7d6"), PINK = C("#ff6ae0"), PINK_G = C("#b83aa8");
const WOOD = ["#b5713c", "#c2804a", "#a86635", "#bb7843"].map(C), WOOD_SEAM = C("#6b3e1e");
const GREEN_A = C("#3f9a5a"), GREEN_B = C("#3a9054");

function inRect(tx: number, ty: number, x0: number, y0: number, x1: number, y1: number) {
  return tx >= x0 && tx < x1 && ty >= y0 && ty < y1;
}
const isTaverna = (x: number, y: number) => x >= 0 && x <= 9 && y >= 30 && y <= 37;
const isNichos = (x: number, y: number) => x >= 27 && x <= 35 && y >= 1 && y <= 8;
const AUD_RED = [C("#7a1a30"), C("#701628")], AUD_EDGE = C("#ffc93a");

/** Colour of the floor at fractional tile coords (pixel shader). px = 1/32 tile along each axis per screen row. */
function floorColor(tx: number, ty: number): RGB {
  const ix = Math.floor(tx), iy = Math.floor(ty);
  const fx = tx - ix, fy = ty - iy;
  const E = 1 / 32;
  const edgeHi = fx < E || fy < E;
  const edgeLo = fx > 1 - E || fy > 1 - E;

  // stage: light-up disco floor
  if (isStage(ix, iy)) {
    const h = hash(ix * 7, iy * 13);
    const base = DISCO[Math.floor(h * DISCO.length)];
    const bx = Math.min(fx, 1 - fx), by = Math.min(fy, 1 - fy);
    if (bx < 2.5 / 32 || by < 2.5 / 32) return 0x1a1430;
    const on = hash(ix, iy * 3) > 0.35;
    const col = on ? base : adj(base, -110);
    if (bx > 0.32 && by > 0.32) return adj(col, 60);
    if (bx < 4.5 / 32 || by < 4.5 / 32) return adj(col, 35);
    return col;
  }
  // stage front neon lip
  if (inRect(tx, ty, 11, 6, 23.06, 6.08) || inRect(tx, ty, 23, 1, 23.06, 6.08)) return PINK;
  if (inRect(tx, ty, 11, 6.08, 23.1, 6.14) || inRect(tx, ty, 23.06, 1, 23.12, 6.14)) return PINK_G;

  // plateia: velvet carpet in front of the stage, gold-edged, with a lighter centre aisle
  if (inRect(tx, ty, 10, 6.3, 24, 18)) {
    if (!inRect(tx, ty, 10.1, 6.4, 23.9, 17.9)) return AUD_EDGE;
    if (tx >= 16 && tx < 18) return Math.floor(ty * 4) % 2 ? C("#b82034") : C("#c8283c");
    const c = AUD_RED[(ix + iy) % 2];
    if (edgeHi) return adj(c, 14);
    if (edgeLo) return adj(c, -16);
    return c;
  }

  // entrance carpet
  if (inRect(tx, ty, 15, 35.5, 19, 38)) {
    if (tx < 15.1 || tx > 18.9) return C("#ffc93a");
    return (Math.floor(ty * 4) % 2 ? C("#c8283c") : C("#b82034"));
  }
  // central round rug with an 8-point star
  {
    const dx = tx - 17, dy = ty - 25;
    const d = Math.hypot(dx, dy);
    if (d < 4.2) {
      if (d > 3.95) return C("#ffc93a");
      if (d > 3.85) return C("#b8861e");
      if (d > 3.3) return (Math.floor((Math.atan2(dy, dx) / Math.PI) * 16 + 32) % 2) ? C("#2a3aa8") : C("#3a4cc8");
      if (d > 3.2) return NEON;
      const a = Math.atan2(dy, dx);
      const star = 1.2 + 1.6 * Math.pow(Math.abs(Math.cos(a * 4)), 6);
      if (d < star) return d < star - 0.12 ? C("#ffd25e") : C("#b8861e");
      return C("#1f2a7a");
    }
  }
  // oracle round rug
  {
    const dx = tx - 4, dy = ty - 23;
    const d = Math.hypot(dx, dy);
    if (d < 3.7) {
      if (d > 3.5) return C("#c18cff");
      if (d > 3.35) return C("#3a1d6b");
      const st = hash(Math.floor(tx * 4), Math.floor(ty * 4));
      if (st > 0.965) return C("#ffe68a");
      if (d > 2.9 && d < 3.0) return C("#c18cff");
      return d > 3.0 ? C("#4c2a88") : C("#5b2f9e");
    }
  }
  // taverna rug
  if (inRect(tx, ty, 4.4, 32.6, 8.6, 36.5)) {
    if (!inRect(tx, ty, 4.55, 32.75, 8.45, 36.35)) return C("#ffc93a");
    const u = (tx - 6.5) * 2, v = (ty - 34.55) * 2;
    const m = (Math.abs(u - Math.round(u)) + Math.abs(v - Math.round(v)));
    return m < 0.18 ? C("#ffc93a") : m < 0.5 ? C("#a8233a") : C("#8a1a2c");
  }
  // lounge rug (blue sofas)
  if (inRect(tx, ty, 28.4, 13.4, 33.6, 18.6)) {
    if (!inRect(tx, ty, 28.55, 13.55, 33.45, 18.45)) return C("#e8ecf5");
    const d = Math.hypot(tx - 30.5, ty - 16.2);
    return d < 1.2 ? C("#7af8ff") : d < 1.35 ? C("#e8ecf5") : (Math.floor((tx + ty) * 2) % 2 ? C("#2a4aa8") : C("#2f54b8"));
  }
  // biblioteca rug
  if (inRect(tx, ty, 2.4, 11.4, 8.6, 15.6)) {
    if (!inRect(tx, ty, 2.55, 11.55, 8.45, 15.45)) return C("#c9a8ff");
    return (Math.floor(tx * 2) + Math.floor(ty * 2)) % 2 ? C("#4a2f7a") : C("#42296e");
  }
  // nichos rug
  if (inRect(tx, ty, 27.5, 5.8, 33.6, 8.6)) {
    if (!inRect(tx, ty, 27.62, 5.92, 33.48, 8.48)) return C("#e8f0d0");
    return (Math.floor(tx * 2) + Math.floor(ty * 2)) % 2 ? C("#2a6e44") : C("#24603b");
  }
  // Sala de TV: retro wall-to-wall carpet + a round rug under the sofas
  if (tx >= 35.94 && ty < 12) {
    if (tx < 36.06) return C("#ffc93a");
    if (ty > 11.94) return C("#ffc93a");
    const d = Math.hypot((tx - 39.5) * 0.8, ty - 5.2);
    if (d < 3.6) {
      if (d > 3.42) return C("#ffe6b0");
      if (d > 3.2) return C("#c84a2a");
      const ring = Math.floor(d * 2.2) % 2;
      return ring ? C("#e8783a") : C("#f2a24a");
    }
    let c = (Math.floor(tx * 2) + Math.floor(ty * 2)) % 2 ? C("#5a2e3e") : C("#542a3a");
    if (hash(Math.floor(tx * 16), Math.floor(ty * 16)) > 0.93) c = adj(c, 14);
    return c;
  }
  // neon frame around the lounge
  const nl = (v: number, a: number, b: number, along: number) =>
    along >= a && along < b ? (Math.abs(v) < 1.2 / 32 ? 2 : Math.abs(v) < 2.6 / 32 ? 1 : 0) : 0;
  const nf = Math.max(
    nl(tx - 11, 19, 31, ty), nl(tx - 23, 19, 31, ty), nl(ty - 19, 11, 23, tx), nl(ty - 31, 11, 23, tx),
  );
  if (nf === 2) return NEON;
  if (nf === 1) return NEON_G;

  // taverna wood planks (run along x)
  if (isTaverna(ix, iy)) {
    const plank = Math.floor(ty * 4);
    const pf = ty * 4 - plank;
    if (pf < 1.5 / 8) return WOOD_SEAM;
    const run = tx + hash(plank, 3) * 3;
    const seg = Math.floor(run / 1.5);
    if (run / 1.5 - seg < 1 / 48) return WOOD_SEAM;
    let c = WOOD[Math.floor(hash(seg, plank) * WOOD.length)];
    if (pf < 3 / 8) c = adj(c, 14);
    if (hash(Math.floor(tx * 24), plank) > 0.93) c = adj(c, -18);
    return c;
  }
  // nichos carpet
  if (isNichos(ix, iy)) {
    let c = (ix + iy) % 2 ? GREEN_A : GREEN_B;
    if (hash(Math.floor(tx * 32), Math.floor(ty * 32)) > 0.9) c = adj(c, 16);
    if (edgeHi) c = adj(c, 12);
    else if (edgeLo) c = adj(c, -18);
    return c;
  }
  // main hall: slate checker with bevelled tile edges
  let c = (ix + iy) % 2 ? HALL_A : HALL_B;
  const n = hash(ix, iy);
  if (n > 0.86) c = adj(c, 8);
  if (n < 0.08) c = adj(c, -8);
  if (edgeHi) return adj(c, 26);
  if (edgeLo) return adj(c, -30);
  if (hash(Math.floor(tx * 32), Math.floor(ty * 32)) > 0.985) c = adj(c, 14);
  return c;
}

// ---------------------------------------------------------------- walls
const LX = (y: number) => (MAP_H - y) * (TW / 2); // left-wall texture column for tile-y (texture reads left->right on screen)
const RX = (x: number) => x * (TW / 2); // right-wall texture column for tile-x
const ZR = (z: number) => WALL_H - z; // texture row for height z
/** Stage LED screen on the right wall, in right-wall texture px (column = x, row = y). 16:9 inner area for the live. */
export const SCREEN = { x: Math.round(RX(13.9)), w: 200, top: ZR(122), h: 112 };
/** Inner (video) area of the screen in wall texture px. */
export const SCREEN_IN = { x: SCREEN.x + 4, y: SCREEN.top + 4, w: SCREEN.w - 8, h: SCREEN.h - 8 };
/** Sala de TV wall TV (right wall, x 36.7..42.2) + its inner 16:9 area, in right-wall texture px. */
export const TV_SCREEN = { x: Math.round(RX(36.7)), w: 176, top: ZR(132), h: 102 };
export const TV_SCREEN_IN = { x: TV_SCREEN.x + 4, y: TV_SCREEN.top + 4, w: TV_SCREEN.w - 8, h: TV_SCREEN.h - 8 };
/** "Lives anteriores" poster next to the TV. */
const TV_POSTER = { x: Math.round(RX(42.55)), w: 42, top: ZR(128), h: 58 };
/** Floor-canvas transform of the right wall: texture (i, row) -> (ORIGIN_X + i, ORIGIN_Y - WALL_H + row + i/2). */
export const RIGHT_WALL_SHEAR = [1, 0.5, 0, 1] as const;

function wallpaper(len: number, base: string, stripe: string, panel: string) {
  const { c, ctx } = mk(len, WALL_H);
  rect(ctx, 0, 0, len, WALL_H, base);
  for (let x = 0; x < len; x += 16) {
    rect(ctx, x, 0, 2, ZR(44), stripe);
    for (let y = 6; y < ZR(44); y += 12) rect(ctx, x + 8, y + ((x / 16) % 2) * 6, 2, 2, stripe);
  }
  // wainscot + gold dado rail + baseboard
  rect(ctx, 0, ZR(42), len, 42, panel);
  for (let x = 4; x < len; x += 32) {
    rect(ctx, x, ZR(36), 24, 1, shade(panel, -0.25));
    rect(ctx, x, ZR(36), 1, 28, shade(panel, -0.25));
    rect(ctx, x, ZR(8), 24, 1, shade(panel, 0.18));
    rect(ctx, x + 24, ZR(36), 1, 28, shade(panel, 0.18));
  }
  rect(ctx, 0, ZR(44), len, 4, "#e0b23a");
  rect(ctx, 0, ZR(44), len, 1, "#ffe68a");
  rect(ctx, 0, ZR(41), len, 1, "#8a6414");
  rect(ctx, 0, ZR(5), len, 5, "#1e1638");
  rect(ctx, 0, ZR(5), len, 1, "#3a2e5e");
  return { c, ctx };
}

function frame(ctx: Ctx, x: number, y: number, w: number, h: number, col: string) {
  rect(ctx, x - 1, y - 1, w + 2, h + 2, "#170f24");
  rect(ctx, x, y, w, h, col);
  rect(ctx, x, y, w, 1, shade(col, 0.35));
  rect(ctx, x, y, 1, h, shade(col, 0.2));
  rect(ctx, x, y + h - 1, w, 1, shade(col, -0.35));
  rect(ctx, x + w - 1, y, 1, h, shade(col, -0.25));
}

function cityWindow(ctx: Ctx, x: number, w: number, seed: number) {
  const top = ZR(118), h = 70;
  frame(ctx, x, top, w, h, "#e8ecf5");
  const ix = x + 4, iy = top + 4, iw = w - 8, ih = h - 8;
  const bands = ["#1a1450", "#241a66", "#30207a", "#46298a", "#6a3a98"];
  for (let i = 0; i < ih; i++) rect(ctx, ix, iy + i, iw, 1, bands[Math.min(bands.length - 1, Math.floor((i / ih) * bands.length))]);
  const R = rng(seed);
  for (let i = 0; i < 10; i++) rect(ctx, ix + R() * iw, iy + R() * ih * 0.5, 1, 1, "#ffffff");
  if (seed % 2) {
    fillEll(ctx, ix + iw * 0.72, iy + 12, 6, 6, "#fff6cf");
    fillEll(ctx, ix + iw * 0.72 + 3, iy + 10, 5, 5, bands[0]);
  }
  // skyline
  let bx = ix;
  while (bx < ix + iw) {
    const bw = 6 + Math.floor(R() * 8), bh = 12 + Math.floor(R() * 26);
    const w2 = Math.min(bw, ix + iw - bx);
    rect(ctx, bx, iy + ih - bh, w2, bh, R() > 0.5 ? "#141236" : "#1c1844");
    for (let wy = iy + ih - bh + 3; wy < iy + ih - 2; wy += 4)
      for (let wx = bx + 1; wx < bx + w2 - 1; wx += 3) if (R() > 0.55) rect(ctx, wx, wy, 1, 2, R() > 0.3 ? "#ffd95a" : "#7af8ff");
    bx += bw;
  }
  // muntins + sill
  rect(ctx, x + Math.floor(w / 2) - 1, top, 3, h, "#e8ecf5");
  rect(ctx, x, top + Math.floor(h / 2) - 1, w, 3, "#e8ecf5");
  rect(ctx, x + Math.floor(w / 2) + 1, top, 1, h, "#a8aec8");
  rect(ctx, x - 3, top + h, w + 6, 4, "#f4f6fb");
  rect(ctx, x - 3, top + h + 4, w + 6, 1, "#8a90aa");
}

function buildRightWall() {
  const len = MAP_W * (TW / 2);
  const { c, ctx } = wallpaper(len, "#4a3a8e", "#54449a", "#2e2560");
  cityWindow(ctx, RX(1.6), 54, 3);
  cityWindow(ctx, RX(4.6), 54, 8);
  cityWindow(ctx, RX(24.6), 54, 13);
  // Habbo-style door: a dark doorway cut into the wall, with the wall thickness on the jamb and light spilling in
  {
    const dX = RX(7.2), dW = RX(8.6) - dX, dTop = ZR(86);
    rect(ctx, dX - 3, dTop - 3, dW + 6, ZR(0) - dTop + 3, "#0b0a10");
    rect(ctx, dX - 2, dTop - 2, dW + 4, ZR(0) - dTop + 2, "#d2cbf6");
    rect(ctx, dX, dTop, dW, ZR(0) - dTop, "#0b0a10");
    for (let i = 0; i < ZR(0) - dTop - 2; i++) rect(ctx, dX + 2, dTop + 2 + i, dW - 6, 1, i < 30 ? "#14121e" : i < 60 ? "#1b1828" : "#24203a");
    rect(ctx, dX + dW - 4, dTop, 4, ZR(0) - dTop, "#6a6298"); // jamb (wall thickness)
    rect(ctx, dX + 2, ZR(6), dW - 6, 6, "#3a3456");
  }
  // stage: curtains + big LED screen + LIVE neon
  const s0 = RX(11.2), s1 = RX(22.8);
  for (let x = s0; x < s1; x += 4) rect(ctx, x, ZR(WALL_H) , 4, 12, (x / 4) % 2 ? "#a3203a" : "#c42c48");
  rect(ctx, s0, ZR(WALL_H - 12), s1 - s0, 3, "#ffc93a");
  for (const side of [0, 1]) {
    const cx0 = side ? RX(21.8) : s0;
    for (let x = 0; x < 32; x++) {
      const fold = (x % 8) < 3 ? "#8a1830" : (x % 8) < 6 ? "#c42c48" : "#e04860";
      const sway = side ? x : 31 - x;
      rect(ctx, cx0 + x, ZR(WALL_H - 12), 1, WALL_H - 12 - 10 - Math.floor(sway / 6), fold);
    }
  }
  const { x: scrX, w: scrW, top: scrTop, h: scrH } = SCREEN;
  frame(ctx, scrX, scrTop, scrW, scrH, "#2a2a38");
  rect(ctx, scrX + 4, scrTop + 4, scrW - 8, scrH - 8, "#0a1440");
  for (let y = 0; y < scrH - 8; y += 2) rect(ctx, scrX + 4, scrTop + 4 + y, scrW - 8, 1, "#0d1a52");
  // wizard hat logo
  const hx = scrX + scrW / 2, hy = scrTop + 30;
  fillPoly(ctx, [hx - 18, hy + 44, hx + 18, hy + 44, hx + 4, hy, hx - 2, hy + 2], "#2f6fdc");
  fillPoly(ctx, [hx - 2, hy + 2, hx + 4, hy, hx + 14, hy - 2, hx + 6, hy + 6], "#2f6fdc");
  rect(ctx, hx - 26, hy + 42, 52, 6, "#1d4aa8");
  rect(ctx, hx - 18, hy + 36, 36, 4, "#ffc93a");
  rect(ctx, hx - 2, hy + 18, 4, 4, "#ffc93a");
  rect(ctx, hx - 4, hy + 20, 8, 1, "#ffc93a");
  // AO VIVO pill
  rect(ctx, scrX + 10, scrTop + 10, pixTextW("AO VIVO", 11) + 22, 16, "#e8283c");
  fillEll(ctx, scrX + 16, scrTop + 18, 3, 3, "#ffffff");
  pixText(ctx, "AO VIVO", scrX + 24, scrTop + 12, 11, "#ffffff");
  // neon side signs
  for (const nx of [RX(9.8), RX(23.3)]) {
    rect(ctx, nx, ZR(112), 12, 48, "#2a1f50");
    rect(ctx, nx + 2, ZR(110), 8, 44, "#ff4fd8");
    rect(ctx, nx + 4, ZR(108), 4, 40, "#ffc4f2");
  }
  // niches cork board
  const bX = RX(27.6), bW = RX(33.6) - bX, bTop = ZR(116), bH = 76;
  frame(ctx, bX, bTop, bW, bH, "#8a5a32");
  rect(ctx, bX + 4, bTop + 14, bW - 8, bH - 18, "#d8a868");
  const R = rng(42);
  for (let i = 0; i < 60; i++) rect(ctx, bX + 4 + R() * (bW - 9), bTop + 14 + R() * (bH - 19), 1, 1, "#b8864a");
  rect(ctx, bX + 4, bTop + 3, bW - 8, 10, "#2f9a58");
  pixText(ctx, "CANTO DOS NICHOS", bX + Math.floor((bW - pixTextW("CANTO DOS NICHOS", 9)) / 2), bTop + 3, 9, "#ffffff");
  const notes = ["#ffe68a", "#9fe6ff", "#ffb0b0", "#b8f0b8", "#fff6e0", "#ffc890", "#e0b8ff"];
  let k = 0;
  for (let rr = 0; rr < 3; rr++)
    for (let q = 0; q < 6; q++) {
      const nx = bX + 10 + q * 30 + Math.floor(R() * 6), ny = bTop + 18 + rr * 18 + Math.floor(R() * 3);
      rect(ctx, nx, ny, 20, 14, notes[k++ % notes.length]);
      rect(ctx, nx + 3, ny + 5, 14, 1, "#8a90aa");
      rect(ctx, nx + 3, ny + 8, 10, 1, "#8a90aa");
      rect(ctx, nx + 9, ny - 1, 3, 3, "#e8283c");
    }
  // Sala de TV: big wall TV (idle picture until a past live plays on it) + "Lives anteriores" poster
  {
    const { x: tX, w: tW, top: tTop, h: tH } = TV_SCREEN;
    rect(ctx, tX - 3, tTop - 3, tW + 6, tH + 6, "#0b0a10");
    frame(ctx, tX - 2, tTop - 2, tW + 4, tH + 4, "#1c1d26");
    const iX = tX + 4, iY = tTop + 4, iW = tW - 8, iH = tH - 8;
    for (let i = 0; i < iH; i++) rect(ctx, iX, iY + i, iW, 1, i < iH * 0.5 ? "#101a3a" : "#0c1430");
    // idle screen: a "menu" of tape cards and a play badge
    const R2 = rng(77);
    for (let q = 0; q < 4; q++) {
      const cx0 = iX + 12 + q * 38, cy0 = iY + 26;
      rect(ctx, cx0, cy0, 32, 20, ["#2f6fdc", "#a3203a", "#2f9a58", "#8a4fd8"][q]);
      rect(ctx, cx0 + 3, cy0 + 24, 26, 2, "#5a6ab8");
      rect(ctx, cx0 + 3, cy0 + 28, 18 + Math.floor(R2() * 8), 2, "#3a4a88");
      fillPoly(ctx, [cx0 + 13, cy0 + 6, cx0 + 13, cy0 + 14, cx0 + 20, cy0 + 10], "#ffffff");
    }
    pixText(ctx, "LIVES ANTERIORES", iX + Math.floor((iW - pixTextW("LIVES ANTERIORES", 9)) / 2), iY + 8, 9, "#ffd25e");
    pixText(ctx, "clique pra assistir", iX + Math.floor((iW - pixTextW("clique pra assistir", 7)) / 2), iY + iH - 16, 7, "#9fb4ff");
    rect(ctx, tX + tW - 10, tTop + tH - 2, 4, 1, "#3ddc84"); // power LED on the bezel
    const { x: pX, w: pW, top: pTop, h: pH } = TV_POSTER;
    frame(ctx, pX, pTop, pW, pH, "#c9a040");
    rect(ctx, pX + 3, pTop + 3, pW - 6, pH - 6, "#a3203a");
    for (let y = pTop + 5; y < pTop + pH - 5; y += 6) {
      rect(ctx, pX + 5, y, 3, 3, "#1a0f14");
      rect(ctx, pX + pW - 8, y, 3, 3, "#1a0f14");
    }
    pixText(ctx, "LIVES", pX + Math.floor((pW - pixTextW("LIVES", 9)) / 2), pTop + 8, 9, "#ffe68a");
    fillPoly(ctx, [pX + pW / 2 - 6, pTop + 24, pX + pW / 2 - 6, pTop + 40, pX + pW / 2 + 8, pTop + 32], "#ffffff");
    pixText(ctx, "ANTIGAS", pX + Math.floor((pW - pixTextW("ANTIGAS", 7)) / 2), pTop + pH - 15, 7, "#ffe68a");
  }
  return c;
}

function buildLeftWall() {
  const len = MAP_H * (TW / 2);
  const { c, ctx } = wallpaper(len, "#5a4aa6", "#6454b0", "#382d72");
  cityWindow(ctx, LX(5.6), 54, 5);
  cityWindow(ctx, LX(14.6), 54, 11);
  // oracle: framed star chart + neon crescent
  const chX = LX(24.4), chW = LX(22.0) - chX;
  frame(ctx, chX, ZR(114), chW, 56, "#c9a040");
  rect(ctx, chX + 4, ZR(110), chW - 8, 48, "#1a1450");
  const R = rng(7);
  const pts: Pt[] = [];
  for (let i = 0; i < 7; i++) pts.push([chX + 10 + R() * (chW - 20), ZR(104) + R() * 36]);
  for (let i = 0; i + 1 < pts.length; i++) line(ctx, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], "#5a6ab8");
  for (const [x, y] of pts) rect(ctx, x - 1, y - 1, 3, 3, "#ffe68a");
  for (let i = 0; i < 20; i++) rect(ctx, chX + 5 + R() * (chW - 10), ZR(108) + R() * 44, 1, 1, "#c8d0ff");
  // Grimório banner
  const gX = LX(29.6), gW = LX(27.4) - gX;
  rect(ctx, gX - 4, ZR(124), gW + 8, 4, "#c9a040");
  rect(ctx, gX, ZR(120), gW, 66, "#a3203a");
  rect(ctx, gX + 2, ZR(120), 2, 66, "#c42c48");
  for (let i = 0; i < gW; i += 2) rect(ctx, gX + i, ZR(54) - ((i / 2) % 2 ? 0 : 4) + (i < gW / 2 ? Math.floor(i / 4) : Math.floor((gW - i) / 4)), 2, 4, "#a3203a");
  fillPoly(ctx, [gX + gW / 2 - 16, ZR(92), gX + gW / 2, ZR(86), gX + gW / 2 + 16, ZR(92), gX + gW / 2 + 16, ZR(76), gX + gW / 2, ZR(70), gX + gW / 2 - 16, ZR(76)], "#ffc93a");
  rect(ctx, gX + gW / 2 - 1, ZR(88), 2, 18, "#b8861e");
  pixText(ctx, "GRIMÓRIO", gX + Math.floor((gW - pixTextW("GRIMÓRIO", 9)) / 2), ZR(110), 9, "#ffe68a");
  // Taverna back bar: bottle shelves + neon sign
  const tX = LX(36.4), tW = LX(30.6) - tX;
  rect(ctx, tX, ZR(96), tW, 56, "#2a1d40");
  for (const z of [62, 88]) {
    rect(ctx, tX, ZR(z), tW, 4, "#c58a50");
    rect(ctx, tX, ZR(z) + 4, tW, 1, "#6b3e1e");
    let x = tX + 4;
    while (x < tX + tW - 8) {
      const col = ["#2f9a58", "#a3203a", "#ffc93a", "#45f0ff", "#8a5a32", "#f2efe6", "#ff7ad0"][Math.floor(R() * 7)];
      const hgt = 14 + Math.floor(R() * 8);
      rect(ctx, x, ZR(z) - hgt, 6, hgt, col);
      rect(ctx, x + 2, ZR(z) - hgt - 5, 2, 5, col);
      rect(ctx, x + 1, ZR(z) - hgt + 2, 1, hgt - 4, shade(col, 0.4));
      x += 9 + Math.floor(R() * 4);
    }
  }
  const sign = "TAVERNA";
  const sw = pixTextW(sign, 18);
  const sX = tX + Math.floor((tW - sw) / 2);
  rect(ctx, sX - 8, ZR(126), sw + 16, 27, "#1a1230");
  pixText(ctx, sign, sX + 1, ZR(124), 18, "#ff6a1a");
  pixText(ctx, sign, sX, ZR(125), 18, "#ffd2a0");
  // wall sconces
  for (const y of [4.2, 12.4, 19.5, 23.2, 26.5, 31.5]) {
    const x = LX(y);
    rect(ctx, x - 3, ZR(92), 6, 10, "#c9a040");
    fillPoly(ctx, [x - 8, ZR(100), x + 8, ZR(100), x + 5, ZR(90), x - 5, ZR(90)], "#ffe68a");
    rect(ctx, x - 5, ZR(100), 10, 2, "#fff6cf");
  }
  return c;
}

// ---------------------------------------------------------------- floor canvas (floor + walls, pre-rendered once)
export function buildFloor(): HTMLCanvasElement {
  const W = ORIGIN_X + MAP_W * (TW / 2) + PAD + WALL_T;
  const H = ORIGIN_Y + (MAP_W + MAP_H) * (TH / 2) + SLAB + PAD;
  const { c, ctx } = mk(W, H);

  // 1) floor pixel shader
  const x0 = ORIGIN_X - MAP_H * (TW / 2), x1 = ORIGIN_X + MAP_W * (TW / 2);
  const y0 = ORIGIN_Y, y1 = ORIGIN_Y + (MAP_W + MAP_H) * (TH / 2);
  const img = ctx.createImageData(x1 - x0, y1 - y0);
  const d = img.data;
  for (let py = y0; py < y1; py++) {
    const v = (py + 0.5 - ORIGIN_Y) / (TH / 2);
    for (let px = x0; px < x1; px++) {
      const u = (px + 0.5 - ORIGIN_X) / (TW / 2);
      const tx = (u + v) / 2, ty = (v - u) / 2;
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
      const col = floorColor(tx, ty);
      const i = ((py - y0) * (x1 - x0) + (px - x0)) * 4;
      d[i] = (col >> 16) & 255;
      d[i + 1] = (col >> 8) & 255;
      d[i + 2] = col & 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);

  // 2) walls: flat textures sheared column by column onto clean 2:1 lines
  const rw = buildRightWall(), lw = buildLeftWall();
  for (let i = 0; i < rw.width; i++) ctx.drawImage(rw, i, 0, 1, WALL_H, ORIGIN_X + i, ORIGIN_Y + Math.ceil(i / 2) - WALL_H, 1, WALL_H);
  for (let j = 0; j < lw.width; j++) {
    const k = lw.width - 1 - j;
    ctx.drawImage(lw, k, 0, 1, WALL_H, ORIGIN_X - 1 - j, ORIGIN_Y + Math.ceil(j / 2) - WALL_H, 1, WALL_H);
  }
  // corner seam shadow
  rect(ctx, ORIGIN_X - 1, ORIGIN_Y - WALL_H, 1, WALL_H, "#2a2058");
  // wall caps (thickness) + outer end faces
  const A: Pt = [ORIGIN_X, ORIGIN_Y - WALL_H];
  const Bp: Pt = [ORIGIN_X + MAP_W * (TW / 2), ORIGIN_Y + MAP_W * (TH / 2) - WALL_H];
  const Cp: Pt = [ORIGIN_X - MAP_H * (TW / 2), ORIGIN_Y + MAP_H * (TH / 2) - WALL_H];
  const t = WALL_T;
  fillPoly(ctx, [A[0], A[1], Bp[0], Bp[1], Bp[0] + t, Bp[1] - t / 2, A[0] + t, A[1] - t / 2], "#b9b0ec");
  fillPoly(ctx, [A[0], A[1], Cp[0], Cp[1], Cp[0] - t, Cp[1] - t / 2, A[0] - t, A[1] - t / 2], "#d2cbf6");
  fillPoly(ctx, [A[0] - t, A[1] - t / 2, A[0], A[1], A[0] + t, A[1] - t / 2, A[0], A[1] - t], "#c6bdf2");
  line(ctx, A[0], A[1] - t + 1, Bp[0] + t - 1, Bp[1] - t / 2, "#e8e4ff");
  line(ctx, A[0], A[1] - t + 1, Cp[0] - t + 1, Cp[1] - t / 2, "#f0eeff");
  const endH = WALL_H + SLAB;
  fillPoly(ctx, [Bp[0], Bp[1], Bp[0] + t, Bp[1] - t / 2, Bp[0] + t, Bp[1] - t / 2 + endH, Bp[0], Bp[1] + endH], "#2a2250");
  fillPoly(ctx, [Cp[0], Cp[1], Cp[0] - t, Cp[1] - t / 2, Cp[0] - t, Cp[1] - t / 2 + endH, Cp[0], Cp[1] + endH], "#3a2f6e");

  // 3) floor slab (front edges)
  const fl = tileToScreen(0, MAP_H), fm = tileToScreen(MAP_W, MAP_H), fr = tileToScreen(MAP_W, 0);
  fillPoly(ctx, [fl.x, fl.y, fm.x, fm.y, fm.x, fm.y + SLAB, fl.x, fl.y + SLAB], "#4a4468");
  fillPoly(ctx, [fm.x, fm.y, fr.x, fr.y, fr.x, fr.y + SLAB, fm.x, fm.y + SLAB], "#34304e");
  line(ctx, fl.x, fl.y, fm.x, fm.y, "#8a86aa");
  line(ctx, fm.x, fm.y, fr.x, fr.y, "#6a668a");
  line(ctx, fl.x, fl.y + SLAB, fm.x, fm.y + SLAB, "#170f24");
  line(ctx, fm.x, fm.y + SLAB, fr.x, fr.y + SLAB, "#170f24");
  return c;
}

/** Interactive wall-mounted things, hit-tested in floor-canvas (world) coordinates. */
export function wallHit(wx: number, wy: number): "nichos" | "palco" | "tv" | null {
  const xt = (wx - ORIGIN_X) / (TW / 2);
  const zr = ORIGIN_Y + xt * (TH / 2) - wy; // height above floor on the right wall plane
  if (xt > 27.6 && xt < 33.6 && zr > 38 && zr < 118) return "nichos";
  const sx0 = SCREEN.x / (TW / 2), sx1 = (SCREEN.x + SCREEN.w) / (TW / 2);
  if (xt > sx0 && xt < sx1 && zr > WALL_H - SCREEN.top - SCREEN.h && zr < WALL_H - SCREEN.top) return "palco";
  const tx0 = TV_SCREEN.x / (TW / 2), tx1 = (TV_POSTER.x + TV_POSTER.w) / (TW / 2);
  if (xt > tx0 && xt < tx1 && zr > WALL_H - TV_SCREEN.top - TV_SCREEN.h && zr < WALL_H - TV_SCREEN.top + 2) return "tv";
  return null;
}

// ---------------------------------------------------------------- lights
export const LIGHTS: { x: number; y: number; z: number; col: string; r: number }[] = [
  ...BLOCKS.filter((b: Block) => b.kind === "lamp").map((b) => ({ x: b.x, y: b.y, z: 112, col: "255,214,110", r: 110 })),
  { x: 3.5, y: 22.5, z: 56, col: "110,210,255", r: 110 },
  { x: 16.5, y: 24.5, z: 70, col: "255,205,80", r: 110 },
  { x: 34, y: 7, z: 40, col: "70,232,110", r: 70 },
  { x: 2, y: 33, z: 40, col: "70,240,255", r: 120 },
  { x: 0, y: 33.5, z: 120, col: "255,138,58", r: 100 },
  { x: 0.4, y: 36.5, z: 60, col: "160,110,255", r: 70 },
  { x: 17, y: 1, z: 90, col: "90,140,255", r: 150 },
  { x: 39.5, y: 0.6, z: 80, col: "110,150,255", r: 120 },
];

const glowCache = new Map<string, HTMLCanvasElement>();
function glow(col: string, r: number) {
  const k = `${col}/${r}`;
  let g = glowCache.get(k);
  if (!g) {
    const { c, ctx } = mk(r * 2, r * 2);
    const gr = ctx.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, `rgba(${col},0.5)`);
    gr.addColorStop(0.4, `rgba(${col},0.18)`);
    gr.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, r * 2, r * 2);
    g = c;
    glowCache.set(k, g);
  }
  return g;
}

const STAGE_TILES: [number, number][] = [];
for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (isStage(x, y)) STAGE_TILES.push([x, y]);

/** Animated floor effects drawn right above the floor canvas (world transform active). */
export function drawFloorFx(ctx: Ctx, t: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const beat = Math.floor(t / 420);
  for (const [x, y] of STAGE_TILES) {
    const h = hash(x * 31 + beat, y * 17 + beat * 7);
    if (h < 0.72) continue;
    const p = tileToScreen(x, y);
    ctx.globalAlpha = 0.35 * (1 - ((t % 420) / 420) * 0.6);
    ctx.fillStyle = ["#ff4fd8", "#45f0ff", "#ffd25e", "#7cf06b"][Math.floor(h * 97) % 4];
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + 3);
    ctx.lineTo(p.x + TW / 2 - 6, p.y + TH / 2);
    ctx.lineTo(p.x, p.y + TH - 3);
    ctx.lineTo(p.x - TW / 2 + 6, p.y + TH / 2);
    ctx.closePath();
    ctx.fill();
  }
  // two sweeping spotlights on the stage
  for (let i = 0; i < 2; i++) {
    const a = t / 1600 + i * Math.PI;
    const c = tileCenter(16.5 + Math.cos(a) * 4.6, 3 + Math.sin(a * 1.3) * 1.6);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = i ? "#45f0ff" : "#ff4fd8";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 54, 27, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Live-mode hook: set liveFx.on = true while a live is running (lib/portal/live.ts drives it). */
export const liveFx = { on: false, video: false };

/** Pulsing "AO VIVO" pill + screen glow on the stage LED screen (right wall texture -> sheared world px). */
function drawLiveOn(ctx: Ctx, t: number) {
  const { x: scrX, w: scrW, top: scrTop, h: scrH } = SCREEN;
  const px0 = scrX + 10, pw = pixTextW("AO VIVO", 11) + 22, py0 = scrTop + 10;
  const pulse = 0.5 + 0.5 * Math.sin(t / 260);
  const col = (i: number, row: number, h: number) => ctx.fillRect(ORIGIN_X + i, ORIGIN_Y + Math.ceil(i / 2) - WALL_H + row, 1, h);
  if (!liveFx.video) {
    ctx.globalAlpha = 0.1 + 0.08 * pulse;
    ctx.fillStyle = "#4a7cff";
    for (let i = scrX + 4; i < scrX + scrW - 4; i++) col(i, scrTop + 4, scrH - 8);
  }
  ctx.globalAlpha = 0.35 + 0.5 * pulse;
  ctx.fillStyle = "#ff2a40";
  for (let i = px0 - 2; i < px0 + pw + 2; i++) col(i, py0 - 2, 20);
  const c = { x: ORIGIN_X + px0 + pw / 2, y: ORIGIN_Y + Math.ceil((px0 + pw / 2) / 2) - WALL_H + py0 + 8 };
  ctx.globalAlpha = 0.25 + 0.35 * pulse;
  ctx.drawImage(glow("255,40,64", 46), Math.round(c.x - 46), Math.round(c.y - 46));
  ctx.globalAlpha = 1;
}

/** Additive glows for lamps and magic objects (world transform active). */
export function drawLights(ctx: Ctx, t: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (liveFx.on) drawLiveOn(ctx, t);
  for (const L of LIGHTS) {
    const c = tileCenter(L.x, L.y);
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(t / 130 + L.x * 3) * Math.sin(t / 370 + L.y);
    ctx.drawImage(glow(L.col, L.r), Math.round(c.x - L.r), Math.round(c.y - L.z - L.r));
  }
  ctx.restore();
}

/** Forget every cached furni/glow canvas (their pixels are gone after a GPU context loss); rebuilt lazily. */
export function resetRoomArt() {
  spriteCache.clear();
  glowCache.clear();
}
