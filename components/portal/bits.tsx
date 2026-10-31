"use client";
import { useEffect, useRef } from "react";
import { AV_H, AV_W, DIR_S, drawAvatarSprite, type Look } from "@/lib/portal/avatar";

/** Pixel wizard-hat logo mark (blue hat, gold band + star). */
export function HatMark({ className = "pm-hat" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      <rect x="9" y="1" width="3" height="2" fill="#4488ff" />
      <rect x="7" y="3" width="4" height="2" fill="#0066ff" />
      <rect x="6" y="5" width="5" height="2" fill="#0066ff" />
      <rect x="5" y="7" width="7" height="3" fill="#0066ff" />
      <rect x="5" y="10" width="7" height="1" fill="#ffd700" />
      <rect x="2" y="11" width="13" height="2" fill="#0044cc" />
      <rect x="8" y="7" width="1" height="1" fill="#ffd700" />
      <rect x="7" y="8" width="3" height="1" fill="#ffd700" />
      <rect x="8" y="9" width="1" height="1" fill="#ffd700" />
    </svg>
  );
}

/**
 * Avatar preview. walk: turns through all 8 directions while walking (character creator).
 * size <= 1 and !walk: a head-and-shoulders crop for compact lists.
 */
export function AvatarPreview({ look, size = 2, walk = true }: { look: Look; size?: number; walk?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const crop = !walk && size <= 1;
  const cw = crop ? 22 : AV_W;
  const ch = crop ? 44 : AV_H;
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const order = [2, 1, 0, 7, 6, 5, 4, 3];
    let i = 0;
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      const dir = walk ? order[Math.floor(i / 12) % 8] : DIR_S;
      const frame = walk ? 1 + (i % 4) : 0;
      drawAvatarSprite(ctx, look, dir, frame, crop ? -11 : 0, crop ? -18 : 0);
      i++;
    };
    draw();
    if (!walk) return;
    const t = setInterval(draw, 150);
    return () => clearInterval(t);
  }, [look, walk, crop]);
  return <canvas ref={ref} width={cw} height={ch} style={{ width: cw * Math.max(1, size), height: ch * Math.max(1, size), imageRendering: "pixelated" }} />;
}

export const Icon = {
  mic: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
  ),
  micOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 5h16v11H9l-5 4z" /></svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /></svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  ext: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M4 12l16-8-6 17-3-7z" /></svg>
  ),
};

// ------------------------------------------------------------------ Habbo-style pixel UI bits
const PAL: Record<string, string> = {
  X: "#14141c", W: "#ffffff", Y: "#ffd700", B: "#0066ff", L: "#7cc8ff", P: "#7b4fd8", N: "#8a5a2b",
  K: "#3ddc84", R: "#ff4d4d", G: "#b9bdcc", S: "#f6cfa8", O: "#ff9a3c", D: "#5a3a1a",
};

/** 12×12 pixel-art icon from a string grid (one char per pixel, "." = transparent). */
export function PixelIcon({ art, swap, slash, className }: { art: string[]; swap?: Record<string, string>; slash?: boolean; className?: string }) {
  const rects: React.ReactNode[] = [];
  art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      let ch = row[x];
      if (ch === ".") continue;
      if (swap?.[ch]) ch = swap[ch];
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={PAL[ch] || ch} />);
    }
  });
  if (slash)
    for (let i = 1; i < 11; i++) {
      rects.push(<rect key={`s${i}`} x={i} y={i} width="2" height="1" fill={PAL.R} />);
    }
  return (
    <svg className={className} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}

export const PX = {
  orb: ["....XXXX....", "..XXLLLLXX..", ".XLWWLLLLPX.", ".XLWLLLLLPX.", "XLLLLLLLPPPX", "XLLLLLLPPPPX", "XLLLLLPPPPPX", ".XLLPPPPPPX.", ".XPPPPPPPPX.", "..XXPPPPXX..", "..XNNNNNNX..", ".XXXXXXXXXX."],
  board: ["............", "XXXXXXXXXXXX", "XNNNNNNNNNNX", "XNWWWNYYYYNX", "XNWWWNYYYYNX", "XNWWWNNNNNNX", "XNNNNNKKKKNX", "XNRRRNKKKKNX", "XNRRRNNNNNNX", "XNNNNNNNNNNX", "XXXXXXXXXXXX", "..X......X.."],
  link: ["............", "...XXXX.....", "..XLLLLX....", ".XLXXXXLX...", ".XLX..XLX.XX", ".XLX..XLXLLX", "..XLXXXXLXLX", "...XXXXXLXLX", ".......XLLLX", "........XXX.", "............", "............"],
  tv: ["............", "..X.....X...", "...X...X....", "XXXXXXXXXXXX", "XNNNNNNNNNXX", "XNLLLLLLLNXX", "XNLLRLLLLNXY", "XNLLRRLLLNXX", "XNLLRLLLLNXY", "XNNNNNNNNNXX", "XXXXXXXXXXXX", ".X........X."],
  smile: ["...XXXXXX...", "..XYYYYYYX..", ".XYYYYYYYYX.", "XYYXYYYYXYYX", "XYYXYYYYXYYX", "XYYYYYYYYYYX", "XYXYYYYYYXYX", "XYYXYYYYXYYX", ".XYYXXXXYYX.", "..XYYYYYYX..", "...XXXXXX...", "............"],
  mic: ["....XXXX....", "...XGGGGX...", "...XGWGGX...", "...XGGGGX...", "...XGGGGX...", ".X.XGGGGX.X.", ".X.XXXXXX.X.", "..X......X..", "...XXXXXX...", ".....XX.....", "...XXXXXX...", "............"],
  people: ["............", "...XXX......", "..XSSSX.XXX.", "..XSSSXXSSSX", "..XSSSXXSSSX", "...XXX..XXX.", ".XXBBBXXXXX.", "XBBBBBBXOOOX", "XBBBBBBXOOOX", "XBBBBBBXOOOX", "XXXXXXXXXXXX", "............"],
  log: [".XXXXXXXXXX.", "XWWWWWWWWWWX", "XWXXXXXXXWWX", "XWWWWWWWWWWX", "XWXXXXXWWWWX", "XWWWWWWWWWWX", "XWXXXXXXXXWX", "XWWWWWWWWWWX", ".XXXXWWXXXX.", "....XWX.....", "....XX......", "............"],
  gear: [".....XX.....", "..XX.GG.XX..", "..XGXGGXGX..", "...XGGGGX...", "XXXGGXXGGXXX", "XGGGX..XGGGX", "XGGGX..XGGGX", "XXXGGXXGGXXX", "...XGGGGX...", "..XGXGGXGX..", "..XX.GG.XX..", ".....XX....."],
  send: ["............", "..XX........", "..XWXX......", "..XWWWXX....", "..XWWWWWXX..", "..XWWWWWWWX.", "..XWWWWWXX..", "..XWWWXX....", "..XWXX......", "..XX........", "............", "............"],
  door: ["..XXXXXXXX..", "..XNNNNNNX..", "..XNDDDDNX..", "..XNDDDDNX..", "..XNDDDDNX..", "..XNDDDYNX..", "..XNDDDDNX..", "..XNDDDDNX..", "..XNDDDDNX..", "..XNNNNNNX..", ".XXXXXXXXXX.", "............"],
};

/** Habbo dialog window: blue title bar, close X, beveled light body. */
export function HWin({
  title, icon, onClose, className = "", children, bodyClass = "",
}: { title: React.ReactNode; icon?: React.ReactNode; onClose?: () => void; className?: string; children: React.ReactNode; bodyClass?: string }) {
  return (
    <div className={`pm-win ${className}`} role="dialog" aria-label={typeof title === "string" ? title : undefined} onClick={(e) => e.stopPropagation()}>
      <div className="pm-win-title">
        {icon && <span className="pm-win-ico">{icon}</span>}
        <span className="pm-win-name">{title}</span>
        {onClose && (
          <button className="pm-win-x" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        )}
      </div>
      <div className={`pm-win-body ${bodyClass}`}>{children}</div>
    </div>
  );
}
