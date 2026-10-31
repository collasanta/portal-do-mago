"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { dmStore, type DmConv, type DmMsg } from "@/lib/portal/dm";
import type { Look } from "@/lib/portal/avatar";
import { PX, PixelIcon } from "../bits";
import { Head } from "./Head";

function hhmm(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function when(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(ts);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function dayLabel(ts: number) {
  const w = when(ts);
  return w === "ontem" ? "Ontem" : w.includes(":") ? "Hoje" : new Date(ts).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

/** Conversation list ("Mensagens" tab). */
export function DmList({ convs, openPk, onOpen }: { convs: DmConv[]; openPk: string | null; onOpen: (c: DmConv) => void }) {
  if (!convs.length)
    return (
      <div className="pm-sh-empty">
        Nenhuma conversa ainda.
        <br />
        Clique em alguém na lista de membros e escolha <b>Mensagem</b>.
      </div>
    );
  return (
    <div className="pm-dl">
      {convs.map((c) => (
        <button key={c.peer.pk} className={`pm-dl-row ${openPk === c.peer.pk ? "sel" : ""} ${c.unread ? "unread" : ""}`} onClick={() => onOpen(c)}>
          <Head look={c.peer.look} status={c.peer.id ? "on" : "off"} />
          <span className="pm-dl-mid">
            <b>{c.peer.name}</b>
            <small>
              {c.last ? (
                <>
                  {c.last.mine && "Você: "}
                  {c.last.x}
                </>
              ) : (
                "Nova conversa"
              )}
            </small>
          </span>
          <span className="pm-dl-side">
            {c.last && <small>{when(c.last.ts)}</small>}
            {c.unread > 0 && <span className="pm-sh-count">{c.unread > 99 ? "99+" : c.unread}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Discord-like DM window: header, grouped messages, day dividers, input. */
export function DmWindow({ conv, msgs, blocked, meLook, onClose, onBack }: { conv: DmConv | null; msgs: DmMsg[]; blocked: boolean; meLook?: Look; onClose: () => void; onBack?: () => void }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const peer = conv?.peer;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs.length, peer?.pk]);

  useEffect(() => {
    if (window.innerWidth > 900) input.current?.focus();
  }, [peer?.pk]);

  if (!peer)
    return (
      <div className="pm-dw">
        <div className="pm-dw-head">
          <b>Abrindo conversa…</b>
          <button className="pm-sh-x" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="pm-sh-empty">Carregando…</div>
      </div>
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    atBottom.current = true;
    dmStore.send(text);
    setText("");
  };

  return (
    <div
      className="pm-dw"
      role="dialog"
      aria-label={`Mensagens com ${peer.name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="pm-dw-head">
        {onBack && (
          <button className="pm-sh-x back" onClick={onBack} aria-label="Voltar">
            ‹
          </button>
        )}
        <Head look={peer.look} size={28} status={peer.id ? "on" : "off"} />
        <span className="pm-dw-who">
          <b>{peer.name}</b>
          <small>{peer.id ? "no salão agora" : "saiu do salão · recebe quando voltar"}</small>
        </span>
        <button className="pm-sh-x" onClick={onClose} aria-label="Fechar conversa">
          ×
        </button>
      </div>
      <div
        className="pm-dw-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <div className="pm-dw-intro">
          <Head look={peer.look} size={56} />
          <b>{peer.name}</b>
          <span>Começo da sua conversa direta com {peer.name}. Só vocês dois veem estas mensagens (ficam guardadas por 7 dias).</span>
        </div>
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          const grouped = !newDay && prev && prev.mine === m.mine && m.ts - prev.ts < 5 * 60 * 1000;
          return (
            <div key={m.mid}>
              {newDay && <div className="pm-dw-day"><span>{dayLabel(m.ts)}</span></div>}
              {grouped ? (
                <div className={`pm-dw-msg cont ${m.pending ? "pending" : ""} ${m.failed ? "failed" : ""}`}>
                  <span className="pm-dw-t">{hhmm(m.ts)}</span>
                  <p>{m.text}</p>
                </div>
              ) : (
                <div className={`pm-dw-msg ${m.pending ? "pending" : ""} ${m.failed ? "failed" : ""}`}>
                  <span className="pm-dw-av">{m.mine ? meLook ? <Head look={meLook} size={36} /> : null : <Head look={peer.look} size={36} />}</span>
                  <div>
                    <div className="pm-dw-meta">
                      <b className={m.mine ? "me" : ""}>{m.mine ? "Você" : peer.name}</b>
                      <small>{when(m.ts) === hhmm(m.ts) ? `hoje às ${hhmm(m.ts)}` : `${when(m.ts)} às ${hhmm(m.ts)}`}</small>
                    </div>
                    <p>{m.text}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {blocked ? (
        <div className="pm-dw-blocked">
          Você bloqueou {peer.name}.{" "}
          <button onClick={() => dmStore.block(peer.pk, false)}>Desbloquear</button>
        </div>
      ) : (
        <form className="pm-dw-form" onSubmit={submit}>
          <input
            ref={input}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Conversar com @${peer.name}`}
            aria-label={`Mensagem para ${peer.name}`}
            enterKeyHint="send"
          />
          <button aria-label="Enviar" disabled={!text.trim()}>
            <PixelIcon art={PX.send} />
          </button>
        </form>
      )}
    </div>
  );
}
