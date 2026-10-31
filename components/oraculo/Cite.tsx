"use client";

import { Fragment, useState } from "react";
import { hms, nn, shortTitle } from "@/lib/oraculo/format";

export type Excerpt = { ref: number; lesson: number; title: string; start: number; end: number; text: string; chapter?: string; url?: string | null; label?: string };

/** Clique numa citação [n]: rola até a fonte correspondente na mesma resposta e destaca. */
function focusSource(ev: React.MouseEvent, ref: number) {
  const root = (ev.currentTarget as HTMLElement).closest("[data-msg]");
  const el = root?.querySelector<HTMLElement>(`[data-ref="${ref}"]`);
  if (!el) return;
  const det = el.closest("details");
  if (det) det.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("orc-flash");
  void el.offsetWidth;
  el.classList.add("orc-flash");
}

export function Chip({ e }: { e: Excerpt }) {
  return (
    <button type="button" className="orc-chip" onClick={(ev) => focusSource(ev, e.ref)}
      title={`${e.label ?? `Live ${nn(e.lesson)}`} · ${hms(e.start)} · ${e.chapter ?? shortTitle(e.title)}`}>
      {e.ref}
    </button>
  );
}

function copyText(text: string) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  });
}

export function Source({ e }: { e: Excerpt }) {
  const [copied, setCopied] = useState(false);
  const t = hms(e.start);
  return (
    <li data-ref={e.ref} className="orc-source">
      <span className="orc-ref">{e.ref}</span>
      <div className="orc-source-body">
        <p className="orc-source-head">
          {e.label ?? `Live ${nn(e.lesson)}`} · <span className="orc-tnum">{e.chapter ? `${t}–${hms(e.end)}` : t}</span> ·{" "}
          <span className={e.chapter ? "" : "orc-muted"}>{e.chapter ?? shortTitle(e.title)}</span>
        </p>
        {e.chapter
          ? <p className="orc-source-text">{e.text}</p>
          : <p className="orc-source-text orc-italic">“{e.text}”</p>}
        <div className="orc-source-actions">
          {e.url && (
            <a href={e.url} target="_blank" rel="noopener noreferrer" className="orc-btn orc-btn-accent">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
              {e.url.startsWith("/lives/") ? `Assistir a gravação (pule para ${t})` : `Assistir na Kiwify (pule para ${t})`}
            </a>
          )}
          <button type="button" className="orc-btn"
            onClick={async () => { await copyText(t); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
            {copied ? "minuto copiado ✓" : "copiar minuto"}
          </button>
        </div>
      </div>
    </li>
  );
}

/** Fontes citadas na resposta (sempre visíveis) + os demais trechos encontrados (recolhidos). */
export function Sources({ excerpts, cited }: { excerpts: Excerpt[]; cited: number[] }) {
  if (!excerpts.length) return null;
  const set = new Set(cited);
  const main = cited.map((n) => excerpts.find((e) => e.ref === n)!).filter(Boolean);
  const rest = excerpts.filter((e) => !set.has(e.ref));
  return (
    <div className="orc-sources">
      {main.length > 0 && (
        <div className="orc-card">
          <p className="orc-label">Onde ele fala disso</p>
          <ol className="orc-list">{main.map((e) => <Source key={e.ref} e={e} />)}</ol>
        </div>
      )}
      {rest.length > 0 && (
        <details className="orc-card orc-details" open={!main.length}>
          <summary>
            <span>{main.length ? `Outros trechos encontrados (${rest.length})` : `Trechos mais próximos (${rest.length})`}</span>
            <svg className="orc-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          </summary>
          <ol className="orc-list orc-list-top">{rest.map((e) => <Source key={e.ref} e={e} />)}</ol>
        </details>
      )}
    </div>
  );
}

const CITE = /\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g;
const refsIn = (s: string) => s.split(/[,;–-]/).map((x) => Number(x.trim()));

export function citedRefs(text: string, byRef: Map<number, Excerpt>) {
  return [...new Set([...text.matchAll(CITE)].flatMap((m) => refsIn(m[1])))].filter((n) => byRef.has(n));
}

/** Markdown leve (parágrafos, listas, títulos, negrito, itálico, código) + [n] vira chip. */
export function Markdown({ text, byRef }: { text: string; byRef: Map<number, Excerpt> }) {
  const blocks: { kind: "p" | "ul" | "ol" | "h" | "quote"; items: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { blocks.push({ kind: "p", items: [] }); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    const h = line.match(/^#{1,4}\s+(.*)/);
    const qt = line.match(/^>\s?(.*)/);
    const last = blocks[blocks.length - 1];
    if (ul) { if (last?.kind === "ul") last.items.push(ul[1]); else blocks.push({ kind: "ul", items: [ul[1]] }); }
    else if (ol) { if (last?.kind === "ol") last.items.push(ol[1]); else blocks.push({ kind: "ol", items: [ol[1]] }); }
    else if (h) blocks.push({ kind: "h", items: [h[1]] });
    else if (qt) { if (last?.kind === "quote") last.items.push(qt[1]); else blocks.push({ kind: "quote", items: [qt[1]] }); }
    else if (last?.kind === "p" && last.items.length) last.items.push(line);
    else if ((last?.kind === "ul" || last?.kind === "ol") && /^\s{2,}/.test(raw)) last.items[last.items.length - 1] += " " + line.trim();
    else blocks.push({ kind: "p", items: [line] });
  }
  return (
    <div className="orc-md">
      {blocks.filter((b) => b.items.length).map((b, i) => {
        if (b.kind === "ul") return <ul key={i}>{b.items.map((x, k) => <li key={k}><Inline s={x} byRef={byRef} /></li>)}</ul>;
        if (b.kind === "ol") return <ol key={i}>{b.items.map((x, k) => <li key={k}><Inline s={x} byRef={byRef} /></li>)}</ol>;
        if (b.kind === "h") return <h3 key={i}><Inline s={b.items[0]} byRef={byRef} /></h3>;
        if (b.kind === "quote") return <blockquote key={i}><Inline s={b.items.join(" ")} byRef={byRef} /></blockquote>;
        return <p key={i}><Inline s={b.items.join(" ")} byRef={byRef} /></p>;
      })}
    </div>
  );
}

function Inline({ s, byRef }: { s: string; byRef: Map<number, Excerpt> }) {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[\d+(?:\s*[,;–-]\s*\d+)*\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
        if (/^\*[^*]+\*$/.test(p) || /^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
        const m = p.match(/^\[(.*)\]$/);
        if (m) {
          const refs = refsIn(m[1]).filter((n) => byRef.has(n));
          if (!refs.length) return null;
          return <Fragment key={i}>{refs.map((n) => <Chip key={n} e={byRef.get(n)!} />)}</Fragment>;
        }
        return <Fragment key={i}>{p.replace(/\*\*/g, "")}</Fragment>;
      })}
    </>
  );
}
