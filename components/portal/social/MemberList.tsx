"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PX, PixelIcon } from "../bits";
import { Head } from "./Head";
import type { Member } from "./Social";

const ROW = 40;
const HEAD = 30;

type Row = { k: "h"; label: string; n: number } | { k: "m"; p: Member };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function roleOf(p: { role?: string; admin?: boolean }) {
  return p.role === "host" ? "host" : p.admin || p.role === "admin" ? "admin" : "member";
}

/** Discord-style member list: role groups with counts, windowed rendering (only visible rows are in the DOM). */
export function MemberList({
  people, stage, talking, onPick, selected,
}: { people: Member[]; stage: Set<string>; talking: Set<string>; onPick: (p: Member, el: HTMLElement) => void; selected: string | null }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [h, setH] = useState(600);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq ? people.filter((p) => norm(p.name).includes(nq)) : people;
    const g: Record<"host" | "admin" | "stage" | "online", Member[]> = { host: [], admin: [], stage: [], online: [] };
    for (const p of list) {
      const r = roleOf(p);
      if (r === "host") g.host.push(p);
      else if (r === "admin") g.admin.push(p);
      else if (stage.has(p.id)) g.stage.push(p);
      else g.online.push(p);
    }
    const by = (a: Member, b: Member) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name, "pt-BR");
    const out: Row[] = [];
    const add = (label: string, arr: Member[]) => {
      if (!arr.length) return;
      out.push({ k: "h", label, n: arr.length });
      for (const p of arr.sort(by)) out.push({ k: "m", p });
    };
    add("MAGO", g.host);
    add("ADMINS", g.admin);
    add("NO PALCO", g.stage);
    add("ONLINE", g.online);
    return out;
  }, [people, stage, q]);

  // offsets: headers are shorter than member rows
  const tops = useMemo(() => {
    const t: number[] = [];
    let y = 0;
    for (const r of rows) {
      t.push(y);
      y += r.k === "h" ? HEAD : ROW;
    }
    t.push(y);
    return t;
  }, [rows]);
  const total = tops[tops.length - 1] || 0;
  let first = 0;
  while (first < rows.length && tops[first + 1] < scroll - 200) first++;
  let last = first;
  while (last < rows.length && tops[last] < scroll + h + 200) last++;

  return (
    <div className="pm-sm">
      <label className="pm-sh-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${people.length}`} aria-label="Buscar membros" />
        {q ? (
          <button onClick={() => setQ("")} aria-label="Limpar busca">
            ×
          </button>
        ) : (
          <span aria-hidden>⌕</span>
        )}
      </label>
      <div className="pm-sm-scroll" ref={box} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        {rows.length === 0 && <div className="pm-sh-empty">Ninguém com esse nome por aqui.</div>}
        <div style={{ height: total, position: "relative" }}>
          {rows.slice(first, last).map((r, i) => {
            const idx = first + i;
            return r.k === "h" ? (
              <div key={"h" + r.label} className="pm-sm-group" style={{ top: tops[idx] }}>
                {r.label} — {r.n}
              </div>
            ) : (
              <MemberRow key={r.p.id} p={r.p} top={tops[idx]} talking={talking.has(r.p.me ? "me" : r.p.id)} sel={selected === r.p.id} onPick={onPick} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const MemberRow = memo(function MemberRow({ p, top, talking, sel, onPick }: { p: Member; top: number; talking: boolean; sel: boolean; onPick: (p: Member, el: HTMLElement) => void }) {
  const r = roleOf(p);
  return (
    <button className={`pm-sm-row ${r} ${sel ? "sel" : ""}`} style={{ top }} onClick={(e) => onPick(p, e.currentTarget)} title={p.name}>
      <Head look={p.look} talking={talking} status="on" />
      <span className="pm-sm-name">
        <b>{p.name}</b>
        {p.me && <small>você</small>}
      </span>
      {r === "host" && <span className="pm-sh-badge host">MAGO</span>}
      {r === "admin" && <span className="pm-sh-badge admin">ADMIN</span>}
      {(p.mic || talking) && <PixelIcon className={`pm-sm-mic ${talking ? "talk" : ""}`} art={PX.mic} swap={{ G: "K" }} />}
    </button>
  );
});
