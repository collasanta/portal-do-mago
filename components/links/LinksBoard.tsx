"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type L = { id: number; category: string; title: string; url: string; description: string; sort: number };
type Draft = { id?: number; category: string; title: string; url: string; description: string };

const API = "/api/links";

function adminKey(): string {
  try {
    const v = localStorage.getItem("pdm.admin"); // same key the room uses (Portal.tsx)
    const k = v ? (JSON.parse(v) as string) : "";
    return k && k !== "off" ? k : "";
  } catch {
    return "";
  }
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Site's own /favicon.ico (no third-party favicon service); letter avatar when it fails. */
function Fav({ url, title }: { url: string; title: string }) {
  const [bad, setBad] = useState(false);
  let src = "";
  try {
    src = new URL("/favicon.ico", url).toString();
  } catch {}
  const hue = [...host(url)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (bad || !src)
    return (
      <span className="lk-fav lk-letter" style={{ background: `hsl(${hue} 55% 38%)` }} aria-hidden>
        {title.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="lk-fav" src={src} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer" ref={(el) => { if (el && el.complete && el.naturalWidth === 0) setBad(true); }} onError={() => setBad(true)} />;
}

const EMPTY: Draft = { category: "", title: "", url: "", description: "" };

export default function LinksBoard({ initial, embed }: { initial: L[] | null; embed: boolean }) {
  const [links, setLinks] = useState<L[]>(initial ?? []);
  const [failed, setFailed] = useState(initial === null);
  const [qs, setQs] = useState("");
  const [admin, setAdmin] = useState(false);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const k = adminKey();
    try {
      const r = await fetch(API, { cache: "no-store", headers: k ? { "x-portal-key": k } : {} });
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { links: L[]; admin: boolean };
      setLinks(j.links);
      setAdmin(j.admin);
      setFailed(false);
    } catch {
      if (!initial?.length) setFailed(true);
    }
  }, [initial]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(); // also learns whether the saved key is an admin key
  }, [refresh]);

  const send = async (method: "POST" | "PATCH" | "DELETE", body?: unknown, query = "") => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(API + query, {
        method,
        headers: { "content-type": "application/json", "x-portal-key": adminKey() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(j.error || "Não deu certo.");
        return false;
      }
      await refresh();
      return true;
    } catch {
      setErr("Sem conexão.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const t = qs.trim().toLowerCase();
    const out: { cat: string; items: L[] }[] = [];
    for (const l of links) {
      if (t && !`${l.title} ${l.description} ${l.category} ${host(l.url)}`.toLowerCase().includes(t)) continue;
      let g = out.find((x) => x.cat === l.category);
      if (!g) out.push((g = { cat: l.category, items: [] }));
      g.items.push(l);
    }
    return out;
  }, [links, qs]);

  const cats = useMemo(() => [...new Set(links.map((l) => l.category))], [links]);

  const save = async () => {
    if (!draft) return;
    const ok = draft.id ? await send("PATCH", draft) : await send("POST", draft);
    if (ok) setDraft(null);
  };

  return (
    <div className={"lk-shell" + (embed ? " lk-embed" : "")}>
      <header className="lk-header">
        {!embed && (
          <Link href="/" className="lk-back" aria-label="Voltar para a sala">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
            <span className="lk-hide-xs">Sala</span>
          </Link>
        )}
        <h1 className="lk-title">Links úteis</h1>
        {admin && (
          <button type="button" className={"lk-btn" + (edit ? " lk-btn-on" : "")} onClick={() => (setEdit(!edit), setDraft(null), setErr(""))}>
            {edit ? "Concluir" : "Editar"}
          </button>
        )}
        {!embed && <span className="lk-spacer" />}
        {embed && (
          <a className="lk-ext" href="/links" target="_blank" rel="noopener">
            abrir em nova aba ↗
          </a>
        )}
      </header>

      <div className="lk-bar">
        <input
          className="lk-search"
          type="search"
          placeholder="Buscar link, ferramenta ou categoria…"
          value={qs}
          onChange={(e) => setQs(e.target.value)}
          aria-label="Buscar links"
        />
        {admin && edit && (
          <button type="button" className="lk-btn lk-btn-primary" onClick={() => (setDraft({ ...EMPTY, category: cats[0] || "" }), setErr(""))}>
            + Novo link
          </button>
        )}
      </div>

      {err && <p className="lk-err" role="alert">{err}</p>}

      <main className="lk-main">
        {draft && (
          <form
            className="lk-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <b>{draft.id ? "Editar link" : "Novo link"}</b>
            <label>
              Categoria
              <input list="lk-cats" value={draft.category} maxLength={40} required onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Ex.: Design e thumbnails" />
              <datalist id="lk-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label>
              Título
              <input value={draft.title} maxLength={80} required onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label>
              Endereço (http/https)
              <input value={draft.url} maxLength={500} required inputMode="url" onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" />
            </label>
            <label>
              Descrição (opcional)
              <input value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <div className="lk-form-actions">
              <button type="submit" className="lk-btn lk-btn-primary" disabled={busy}>Salvar</button>
              <button type="button" className="lk-btn" onClick={() => setDraft(null)}>Cancelar</button>
            </div>
          </form>
        )}

        {failed && <p className="lk-empty">Não consegui carregar os links agora. Tente de novo em instantes.</p>}
        {!failed && !groups.length && (
          <p className="lk-empty">{qs ? "Nenhum link com essa busca." : "Ainda não tem links por aqui."}</p>
        )}

        {groups.map((g) => (
          <section key={g.cat} className="lk-cat">
            <h2 className="lk-cat-name">{g.cat}</h2>
            <ul className="lk-grid">
              {g.items.map((l, i) => (
                <li key={l.id} className="lk-card">
                  <a className="lk-link" href={l.url} target="_blank" rel="noopener noreferrer">
                    <Fav url={l.url} title={l.title} />
                    <span className="lk-txt">
                      <span className="lk-name">{l.title}</span>
                      <span className="lk-host">{host(l.url)}</span>
                      {l.description && <span className="lk-desc">{l.description}</span>}
                    </span>
                  </a>
                  {admin && edit && (
                    <div className="lk-tools">
                      <button type="button" className="lk-ico" title="Subir" aria-label="Subir" disabled={busy || qs !== "" || i === 0} onClick={() => send("PATCH", { id: l.id, move: "up" })}>↑</button>
                      <button type="button" className="lk-ico" title="Descer" aria-label="Descer" disabled={busy || qs !== "" || i === g.items.length - 1} onClick={() => send("PATCH", { id: l.id, move: "down" })}>↓</button>
                      <button type="button" className="lk-ico" title="Editar" aria-label="Editar" onClick={() => (setDraft({ id: l.id, category: l.category, title: l.title, url: l.url, description: l.description }), setErr(""))}>✎</button>
                      <button
                        type="button"
                        className="lk-ico lk-del"
                        title="Excluir"
                        aria-label="Excluir"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Excluir "${l.title}"?`)) void send("DELETE", undefined, `?id=${l.id}`);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
