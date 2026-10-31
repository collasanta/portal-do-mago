"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Header, { Sparkle } from "./Header";
import { Markdown, Sources, citedRefs, type Excerpt } from "./Cite";

type Conv = { id: number; title: string; updated_at?: string };
type Msg = {
  key: string;
  role: "user" | "assistant";
  content: string;
  citations: Excerpt[];
  status?: "searching" | "streaming" | "done" | "error" | "stopped";
  error?: string;
};

const API = "/api/oraculo";
const EXAMPLES = [
  "Resuma o processo de mineração de nichos",
  "Quais ferramentas de I.A ele usa?",
  "Qual concorrente da Suno ele recomenda?",
  "Como configurar live 24/7 de música?",
];

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

// garante o cookie de visitante (uma vez por carregamento)
let sessionReady: Promise<unknown> | null = null;
const ensureSession = (force = false) => {
  if (force || !sessionReady) sessionReady = fetch(`${API}/session`, { method: "POST", cache: "no-store" }).catch(() => null);
  return sessionReady;
};

export default function Chat({ initialId, embed }: { initialId: number | null; embed: boolean }) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<number | null>(initialId);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingConv, setLoadingConv] = useState(!!initialId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const honey = useRef<HTMLInputElement>(null);

  const toBottom = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; };

  const loadList = useCallback(async () => {
    await ensureSession();
    const r = await fetch(`${API}/conversations`, { cache: "no-store" });
    if (r.ok) setConvs(((await r.json()) as { conversations: Conv[] }).conversations);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const setUrl = (id: number | null) => {
    const u = new URL(location.href);
    if (id) u.searchParams.set("c", String(id)); else u.searchParams.delete("c");
    history.replaceState(null, "", u.pathname + u.search);
  };

  const open = useCallback(async (id: number) => {
    abort.current?.abort();
    setDrawer(false);
    setActiveId(id);
    setUrl(id);
    setLoadingConv(true);
    setMsgs([]);
    await ensureSession();
    const r = await fetch(`${API}/conversations/${id}`, { cache: "no-store" });
    setLoadingConv(false);
    if (!r.ok) { setActiveId(null); setUrl(null); return; }
    const j = (await r.json()) as { messages: { role: "user" | "assistant"; content: string; citations: Excerpt[] | null }[] };
    setMsgs(j.messages.map((m) => ({
      key: newKey(), role: m.role, content: m.content, citations: m.citations ?? [], status: "done",
    })));
    stick.current = true;
    requestAnimationFrame(toBottom);
  }, []);

  useEffect(() => { if (initialId) open(initialId); }, [initialId, open]);

  const newChat = () => {
    abort.current?.abort();
    setActiveId(null);
    setUrl(null);
    setMsgs([]);
    setDrawer(false);
    setTimeout(() => ta.current?.focus(), 50);
  };

  const remove = async (id: number) => {
    if (!confirm("Apagar esta conversa?")) return;
    await fetch(`${API}/conversations/${id}`, { method: "DELETE" });
    setConvs((c) => c.filter((x) => x.id !== id));
    if (id === activeId) newChat();
  };

  // auto-scroll enquanto a resposta chega, se o usuário estiver no fim
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => { stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 120; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => { if (stick.current) toBottom(); }, [msgs]);

  // textarea cresce com o texto
  const fit = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);
  useLayoutEffect(fit, [input, fit]);

  const patchLast = (f: (m: Msg) => Msg) =>
    setMsgs((ms) => { const c = [...ms]; c[c.length - 1] = f(c[c.length - 1]); return c; });

  async function send(text: string) {
    const question = text.trim();
    if (question.length < 2 || busy) return;
    if (question.length > 1000) return alert("Mensagem longa demais (máximo 1000 caracteres).");
    setInput("");
    setBusy(true);
    stick.current = true;
    setMsgs((ms) => [
      ...ms,
      { key: newKey(), role: "user", content: question, citations: [], status: "done" },
      { key: newKey(), role: "assistant", content: "", citations: [], status: "searching" },
    ]);
    const ctl = new AbortController();
    abort.current = ctl;
    let convId = activeId;
    try {
      await ensureSession();
      const post = () => fetch(`${API}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, conversationId: activeId, website: honey.current?.value ?? "" }),
        signal: ctl.signal,
      });
      let r = await post();
      if (r.status === 401) { await ensureSession(true); r = await post(); } // cookie perdido: renova uma vez
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        patchLast((m) => ({ ...m, status: "error", error: j.error || "Algo deu errado." }));
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "meta") {
            setRemaining(ev.remaining);
            if (!convId) {
              convId = ev.conversationId;
              setActiveId(convId);
              setUrl(convId);
              setConvs((c) => [{ id: ev.conversationId, title: ev.title }, ...c]);
            } else {
              setConvs((c) => { const x = c.find((y) => y.id === convId); return x ? [x, ...c.filter((y) => y.id !== convId)] : c; });
            }
          } else if (ev.type === "title") {
            setConvs((c) => c.map((x) => (x.id === convId ? { ...x, title: ev.title } : x)));
          } else if (ev.type === "excerpts") {
            patchLast((m) => ({ ...m, citations: ev.excerpts, status: "streaming" }));
          } else if (ev.type === "delta") {
            patchLast((m) => ({ ...m, content: m.content + ev.text }));
          } else if (ev.type === "done") {
            patchLast((m) => (m.status === "error" ? m : { ...m, status: "done" }));
          } else if (ev.type === "error") {
            patchLast((m) => ({ ...m, status: "error", error: ev.error }));
          }
        }
      }
      patchLast((m) => (m.status === "streaming" || m.status === "searching" ? { ...m, status: "done" } : m));
    } catch {
      if (ctl.signal.aborted) patchLast((m) => ({ ...m, status: "stopped" }));
      else patchLast((m) => ({ ...m, status: "error", error: "Falha de conexão. Tente de novo." }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const stop = () => abort.current?.abort();
  const empty = !msgs.length && !loadingConv;
  const q = embed ? "?embed=1" : "";

  return (
    <div className={"orc-shell" + (embed ? " orc-embed" : "")}>
      {!embed && <Header active="chat" onMenu={() => setDrawer(true)} />}

      <div className="orc-body">
        {drawer && <div className="orc-scrim" onClick={() => setDrawer(false)} />}
        <aside className={"orc-aside" + (drawer ? " orc-aside-open" : "")}>
          <div className="orc-aside-top">
            <button type="button" onClick={newChat} className="orc-new">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              Nova conversa
            </button>
            <button type="button" onClick={() => setDrawer(false)} className="orc-icon-btn orc-close" aria-label="Fechar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <p className="orc-label orc-pad">Suas conversas</p>
          <nav className="orc-convs">
            {convs.length === 0 && <p className="orc-muted orc-small orc-pad">Nenhuma conversa ainda.</p>}
            {convs.map((c) => (
              <div key={c.id} className={"orc-conv" + (c.id === activeId ? " orc-conv-on" : "")}>
                <button type="button" onClick={() => open(c.id)} className="orc-conv-title">{c.title}</button>
                <button type="button" onClick={() => remove(c.id)} aria-label="Apagar conversa" className="orc-conv-del">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </div>
            ))}
          </nav>
          <div className="orc-aside-foot">
            <Link href={`/oraculo/aulas${q}`} className="orc-foot-link">Ver todas as aulas →</Link>
            <p className="orc-muted orc-tiny">As conversas ficam salvas só neste navegador.</p>
          </div>
        </aside>

        <section className="orc-main">
          {embed && (
            <div className="orc-embed-bar">
              <button type="button" onClick={() => setDrawer(true)} className="orc-icon-btn" aria-label="Conversas">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <span className="orc-brand orc-small"><Sparkle size={14} /> Oráculo do Mago</span>
              {msgs.length > 0 && <button type="button" onClick={newChat} className="orc-btn">Nova</button>}
            </div>
          )}
          <div ref={scroller} className="orc-scroll">
            <div className="orc-col">
              {empty && (
                <div className="orc-hero">
                  <span className="orc-hero-icon"><Sparkle size={28} /></span>
                  <h1>Oráculo do Mago</h1>
                  <p className="orc-accent orc-small">Grimório do Mago</p>
                  <p className="orc-muted">Tudo que o Mago falou nas lives, com a live e o minuto exato.</p>
                  <div className="orc-examples">
                    {EXAMPLES.map((ex) => (
                      <button type="button" key={ex} onClick={() => send(ex)} className="orc-example">{ex}</button>
                    ))}
                  </div>
                </div>
              )}
              {loadingConv && <p className="orc-muted orc-center">Abrindo conversa…</p>}
              <div className="orc-msgs">
                {msgs.map((m) => (m.role === "user" ? <UserBubble key={m.key} m={m} /> : <AssistantMsg key={m.key} m={m} />))}
              </div>
            </div>
          </div>

          <div className="orc-composer">
            <div className="orc-col">
              <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="orc-form">
                {/* honeypot: invisível para pessoas; robôs que preenchem são recusados */}
                <input ref={honey} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="orc-honey" />
                <textarea
                  ref={ta} value={input} rows={1} maxLength={1000}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
                  }}
                  placeholder={msgs.length ? "Pergunte mais…" : "Pergunte qualquer coisa sobre as lives…"}
                />
                {busy ? (
                  <button type="button" onClick={stop} aria-label="Parar" className="orc-send orc-stop">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                  </button>
                ) : (
                  <button type="submit" disabled={input.trim().length < 2} aria-label="Enviar" className="orc-send">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                )}
              </form>
              <p className="orc-hint">
                {remaining != null ? `${remaining} perguntas restantes hoje · ` : ""}Respostas só com o que foi dito nas lives. Confira na aula, na Kiwify.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function UserBubble({ m }: { m: Msg }) {
  return (
    <div className="orc-user"><div className="orc-bubble">{m.content}</div></div>
  );
}

function AssistantMsg({ m }: { m: Msg }) {
  const byRef = new Map(m.citations.map((e) => [e.ref, e]));
  const cited = citedRefs(m.content, byRef);
  const finished = m.status === "done" || m.status === "stopped" || m.status === "error";
  return (
    <div data-msg className="orc-assistant">
      <span className="orc-avatar"><Sparkle size={14} /></span>
      <div className="orc-answer">
        {m.status === "searching" && <Dots label="Consultando as lives" />}
        {m.content && <Markdown text={m.content} byRef={byRef} />}
        {m.status === "streaming" && !m.content && <Dots label="Escrevendo" />}
        {m.status === "stopped" && <p className="orc-muted orc-tiny">Resposta interrompida.</p>}
        {m.error && <p className="orc-error">{m.error}</p>}
        {finished && <Sources excerpts={m.citations} cited={cited} />}
      </div>
    </div>
  );
}

function Dots({ label }: { label: string }) {
  return (
    <p className="orc-dots">
      <span>{[0, 1, 2].map((i) => <i key={i} style={{ animationDelay: `${i * 150}ms` }} />)}</span>
      {label}…
    </p>
  );
}
