"use client";
// Habbo-style wardrobe: category tabs, a grid of part thumbnails (drawn from our own sprites) and a colour palette.
import { useEffect, useRef, useState } from "react";
import {
  AV_W, BOTTOMS, GLASSES, HAIRS, HAIR_STYLES, HATS, PANTS, SHIRTS, SHOES, SKINS, TOPS, drawAvatarSprite, normLook, randomLook,
  type Look,
} from "@/lib/portal/avatar";
import { AvatarPreview } from "./bits";

type Part = "hair" | "hat" | "top" | "bottom" | "shoes" | "skin";
type Crop = { y: number; h: number };
const CROP: Record<Part, Crop> = {
  hair: { y: 2, h: 46 },
  hat: { y: 0, h: 46 },
  top: { y: 40, h: 34 },
  bottom: { y: 60, h: 28 },
  shoes: { y: 70, h: 18 },
  skin: { y: 14, h: 46 },
};

/** One option of a category, drawn as a cropped 3/4 sprite (a frame of our own procedural avatar). */
function PartThumb({ look, part }: { look: Look; part: Part }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cr = CROP[part];
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawAvatarSprite(ctx, look, 1, 0, 0, -cr.y);
  }, [look, cr.y]);
  return <canvas ref={ref} width={AV_W} height={cr.h} style={{ width: AV_W, height: cr.h, imageRendering: "pixelated" }} />;
}

const TABS: { id: Part; label: string }[] = [
  { id: "hair", label: "Cabelo" },
  { id: "hat", label: "Acessórios" },
  { id: "top", label: "Blusa" },
  { id: "bottom", label: "Calça" },
  { id: "shoes", label: "Sapatos" },
  { id: "skin", label: "Pele" },
];

export function Wardrobe({ look, setLook }: { look: Look; setLook: (f: (l: Look) => Look) => void }) {
  const [tab, setTab] = useState<Part>("hair");
  const L = normLook(look);
  const set = (k: keyof Look, v: number) => setLook((l) => ({ ...l, [k]: v }));

  const grid = (k: keyof Look, names: string[], part: Part, extra?: Partial<Look>) => (
    <div className="pm-wd-grid" role="listbox" aria-label={TABS.find((t) => t.id === part)?.label}>
      {names.map((n, i) => (
        <button
          type="button"
          key={n}
          role="option"
          aria-selected={L[k] === i}
          title={n}
          className={`pm-wd-item ${L[k] === i ? "on" : ""}`}
          onClick={() => set(k, i)}
        >
          <PartThumb look={{ ...L, ...extra, [k]: i }} part={part} />
          <span>{n}</span>
        </button>
      ))}
    </div>
  );
  const palette = (k: keyof Look, cols: string[], label: string) => (
    <div className="pm-wd-pal" aria-label={`Cor: ${label}`}>
      {cols.map((c, i) => (
        <button type="button" key={c + i} aria-label={`${label} ${i + 1}`} className={`pm-sw ${L[k] === i ? "on" : ""}`} style={{ background: c }} onClick={() => set(k, i)} />
      ))}
    </div>
  );

  return (
    <div className="pm-wd">
      <div className="pm-wd-stage">
        <div className="pm-wd-floor" />
        <AvatarPreview look={look} size={2} />
        <button type="button" className="pm-btn ghost small pm-wd-rand" onClick={() => setLook(() => randomLook())}>
          🎲 Sortear
        </button>
      </div>
      <div className="pm-wd-side">
        <div className="pm-wd-tabs" role="tablist">
          {TABS.map((t) => (
            <button type="button" role="tab" aria-selected={tab === t.id} key={t.id} className={`pm-wd-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} title={t.label}>
              <span className="pm-wd-tabico" aria-hidden>
                <PartThumb look={L} part={t.id} />
              </span>
              <small>{t.label}</small>
            </button>
          ))}
        </div>
        <div className="pm-wd-panel">
          {tab === "hair" && (
            <>
              {grid("hairStyle", HAIR_STYLES, "hair", { hat: 0 })}
              {palette("hair", HAIRS, "Cabelo")}
            </>
          )}
          {tab === "hat" && (
            <>
              {grid("hat", HATS, "hat")}
              <div className="pm-wd-sub">Óculos</div>
              {grid("glasses", GLASSES, "hair", { hat: 0 })}
            </>
          )}
          {tab === "top" && (
            <>
              {grid("top", TOPS, "top")}
              {palette("shirt", SHIRTS, "Blusa")}
            </>
          )}
          {tab === "bottom" && (
            <>
              {grid("bottom", BOTTOMS, "bottom")}
              {palette("pants", PANTS, "Calça")}
            </>
          )}
          {tab === "shoes" && palette("shoes", SHOES.map((x) => x.c), "Sapatos")}
          {tab === "skin" && palette("skin", SKINS, "Pele")}
        </div>
      </div>
    </div>
  );
}

