"use client";
import { memo } from "react";
import { DIR_S, drawAvatarSprite, type Look } from "@/lib/portal/avatar";

// Head crop of the Habbo sprite, rendered once per look into a data URL (cheap for 300 rows).
const cache = new Map<string, string>();
let scratch: HTMLCanvasElement | null = null;
const CROP = { x: 9, y: 10, s: 26 };

export function headUrl(look: Look) {
  const key = JSON.stringify(look);
  let u = cache.get(key);
  if (u) return u;
  // one shared scratch canvas: no per-row canvases (room sprites live in a shared atlas)
  const c = (scratch ||= document.createElement("canvas"));
  c.width = c.height = CROP.s;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, CROP.s, CROP.s);
  drawAvatarSprite(ctx, look, DIR_S, 0, -CROP.x, -CROP.y);
  u = c.toDataURL();
  if (cache.size > 800) cache.clear();
  cache.set(key, u);
  return u;
}

export const Head = memo(function Head({ look, size = 32, talking, status }: { look: Look; size?: number; talking?: boolean; status?: "on" | "off" }) {
  return (
    <span className={`pm-sh-head ${talking ? "talk" : ""}`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={headUrl(look)} alt="" width={size} height={size} draggable={false} />
      {status && <i className={`pm-sh-dot ${status}`} />}
    </span>
  );
});
