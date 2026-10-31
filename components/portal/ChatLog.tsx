"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMsg } from "@/lib/portal/net";

type P = { id: string; role?: string; admin: boolean };

const IDLE_MS = 30000;

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** In-game style chat log: translucent lines stacked above the bottom bar, fading upward. */
export function ChatLog({ chat, meId, people, pinned }: { chat: ChatMsg[]; meId: string | null; people: P[]; pinned: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const roles = useRef<Map<string, string>>(new Map());
  const [focus, setFocus] = useState(false);
  const [hover, setHover] = useState(false);
  const [recent, setRecent] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  for (const p of people) roles.current.set(p.id, p.role === "host" ? "host" : p.admin || p.role === "admin" ? "admin" : "user");

  const poke = () => {
    setRecent(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRecent(false), IDLE_MS);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // a new message wakes the log up
  const last = chat[chat.length - 1];
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    poke();
  }, [last, chat.length]);

  // sit right above the (possibly wrapped) bottom bar
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>(".pm-bar");
    const el = wrap.current;
    if (!bar || !el) return;
    const apply = () => {
      el.style.setProperty("--cl-bottom", `${bar.offsetHeight + 14}px`);
      // the live window on narrow screens stops above the log (live.css)
      document.documentElement.style.setProperty("--pm-cl-bottom", `${bar.offsetHeight + 14}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // focus on the chat input reveals the log
  useEffect(() => {
    const isChat = (t: EventTarget | null) => t instanceof HTMLElement && t.hasAttribute("data-pm-chat");
    const on = (e: FocusEvent) => isChat(e.target) && (setFocus(true), poke());
    const off = (e: FocusEvent) => isChat(e.target) && setFocus(false);
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => (document.removeEventListener("focusin", on), document.removeEventListener("focusout", off));
  }, []);

  // hover is detected by geometry so the log never needs pointer events while it is idle
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = scroller.current?.getBoundingClientRect();
      const inside = !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      setHover((h) => (h === inside ? h : inside));
      if (inside) poke();
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useLayoutEffect(() => {
    const s = scroller.current;
    if (s && stick.current) s.scrollTop = s.scrollHeight;
  }, [chat, focus, hover, pinned]);

  const shown = pinned || focus || hover || recent;
  const live = pinned || focus || hover;

  const step = (dir: -1 | 1) => {
    const s = scroller.current;
    if (!s) return;
    s.scrollBy({ top: dir * s.clientHeight * 0.6, behavior: "smooth" });
    poke();
  };

  return (
    <div ref={wrap} className={`pm-chatlog ${shown ? "show" : ""} ${live ? "live" : ""}`} aria-live="polite" aria-label="Chat do salão">
      <div
        ref={scroller}
        className="pm-cl-scroll"
        onScroll={(e) => {
          const s = e.currentTarget;
          stick.current = s.scrollHeight - s.scrollTop - s.clientHeight < 8;
          poke();
        }}
      >
        <div className="pm-cl-fill" />
        {chat.map((m, i) => {
          const role = m.sys ? "sys" : m.id === meId ? "me" : roles.current.get(m.id) || "user";
          const rank = !m.sys && roles.current.get(m.id) === "host" ? "MAGO" : !m.sys && roles.current.get(m.id) === "admin" ? "ADMIN" : "";
          return (
            <div key={i} className={`pm-cl-line ${role} ${rank ? rank.toLowerCase() : ""}`} title={fmtTime(m.ts)}>
              {rank && <span className="rk">{rank}</span>}
              <b className="who">{m.name}</b>
              <span className="tx">{m.sys ? " " : ": "}{m.text}</span>
              <time>{fmtTime(m.ts)}</time>
            </div>
          );
        })}
      </div>
      <div className="pm-cl-nav">
        <button type="button" aria-label="Mensagens anteriores" onClick={() => step(-1)}>▲</button>
        <button type="button" aria-label="Mensagens mais novas" onClick={() => step(1)}>▼</button>
      </div>
    </div>
  );
}
