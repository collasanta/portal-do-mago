// Video on a wall screen of the room: the stage LED screen (the live) and the Sala de TV (past lives).
// The <video> is copied into ONE small buffer canvas per screen at ~15 fps and drawn every frame onto the right wall
// with the wall's shear, so the room itself shows the video. No per-frame canvases; each buffer is created once (and
// recreated after a GPU context loss via resetStageScreen).
import { ORIGIN_X, ORIGIN_Y, RIGHT_WALL_SHEAR, SCREEN_IN, TV_SCREEN_IN, WALL_H, liveFx } from "./room-art";

const FPS_MS = 66;
const PAUSED_MS = 500;
const SCALE = 2; // buffer px per wall px (a bit sharper than the pixel art when zoomed in)

const ready = (v: HTMLVideoElement | null): v is HTMLVideoElement => !!v && v.readyState >= 2 && v.videoWidth > 0;

type Rect = { x: number; y: number; w: number; h: number };

export class WallScreen {
  video: HTMLVideoElement | null = null;
  pip: HTMLVideoElement | null = null;
  /** frames copied onto the screen (debug / automated checks) */
  frames = 0;
  /** draw a pause badge while the video is paused (TV) */
  pauseBadge = false;
  private buf: HTMLCanvasElement | null = null;
  private bctx: CanvasRenderingContext2D | null = null;
  private lastCopy = -1e9;
  private hasImage = false;
  constructor(readonly rect: Rect) {}

  set(main: HTMLVideoElement | null, pip: HTMLVideoElement | null = null) {
    this.video = main;
    this.pip = pip;
    if (!main) this.hasImage = false;
  }

  reset() {
    this.buf = null;
    this.bctx = null;
    this.hasImage = false;
  }

  ready() {
    return ready(this.video);
  }

  private copy(t: number) {
    const v = this.video;
    if (!ready(v)) return;
    const paused = this.pauseBadge && v.paused;
    if (t - this.lastCopy < (paused ? PAUSED_MS : FPS_MS) && this.hasImage) return;
    this.lastCopy = t;
    if (!this.buf) {
      this.buf = document.createElement("canvas");
      this.buf.width = this.rect.w * SCALE;
      this.buf.height = this.rect.h * SCALE;
      this.bctx = this.buf.getContext("2d");
    }
    const c = this.bctx!;
    const W = this.buf.width, H = this.buf.height;
    c.fillStyle = "#05060c";
    c.fillRect(0, 0, W, H);
    // contain-fit
    const k = Math.min(W / v.videoWidth, H / v.videoHeight);
    const w = v.videoWidth * k, h = v.videoHeight * k;
    c.imageSmoothingEnabled = true;
    c.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
    const p = this.pip;
    if (ready(p)) {
      const pw = W * 0.26, ph = (pw * p.videoHeight) / p.videoWidth;
      c.fillStyle = "#ffffff";
      c.fillRect(W - pw - 10, H - ph - 10, pw + 4, ph + 4);
      c.drawImage(p, W - pw - 8, H - ph - 8, pw, ph);
    }
    // faint LED scanlines
    c.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    if (paused) {
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.fillRect(0, 0, W, H);
      c.fillStyle = "#ffffff";
      const s = H * 0.22;
      c.fillRect(W / 2 - s * 0.55, H / 2 - s / 2, s * 0.35, s);
      c.fillRect(W / 2 + s * 0.2, H / 2 - s / 2, s * 0.35, s);
    }
    this.hasImage = true;
    this.frames++;
  }

  /** World transform active (floor-canvas px). Call right after drawing the floor canvas. */
  draw(ctx: CanvasRenderingContext2D, t: number) {
    this.copy(t);
    if (!this.buf || !this.hasImage) return;
    const r = this.rect;
    ctx.save();
    const [a, b, c, d] = RIGHT_WALL_SHEAR;
    ctx.transform(a, b, c, d, ORIGIN_X, ORIGIN_Y - WALL_H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.buf, r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

/** The live on the stage's LED screen. */
export const stageScreen = new WallScreen(SCREEN_IN);
/** Sala de TV: the past live this viewer picked (each person watches their own). */
export const tvScreen = new WallScreen(TV_SCREEN_IN);
tvScreen.pauseBadge = true;

export function setStageVideo(main: HTMLVideoElement | null, pip: HTMLVideoElement | null) {
  stageScreen.set(main, pip);
}

export function setTvVideo(v: HTMLVideoElement | null) {
  tvScreen.set(v);
}

export function resetStageScreen() {
  stageScreen.reset();
  tvScreen.reset();
}

/** World transform active (floor-canvas px). Call right after drawing the floor canvas. */
export function drawStageScreen(ctx: CanvasRenderingContext2D, t: number) {
  const on = liveFx.on && stageScreen.ready();
  liveFx.video = on;
  if (on) stageScreen.draw(ctx, t);
  if (tvScreen.ready()) tvScreen.draw(ctx, t);
}
