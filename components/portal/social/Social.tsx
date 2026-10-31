"use client";
// Discord-style social panel: member list (grouped by role) + direct messages.
// Desktop (> 900px): a collapsible right sidebar beside the room. Phones/tablets: a drawer opened from the toolbar.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Look } from "@/lib/portal/avatar";
import { dmStore, type DmConv, type DmPeer } from "@/lib/portal/dm";
import type { Net } from "@/lib/portal/net";
import { rankOf } from "@/lib/portal/overlay";
import { DmList, DmWindow } from "./DmPanel";
import { Head } from "./Head";
import { MemberList, roleOf } from "./MemberList";
import "./social.css";

export type Member = { id: string; name: string; look: Look; mic: boolean; admin: boolean; role?: string; me: boolean };

const PREF = "pdm.social";
const MOBILE = 900;
const isMobile = () => typeof window !== "undefined" && window.innerWidth <= MOBILE;

/** Open a DM from anywhere in the room UI (e.g. the avatar info card). */
export function openDm(t: { id: string; name: string; look: Look }) {
  dmStore?.open(t);
}

export function Social({
  net, people, isAdmin, open, setOpen, speaking, onWave, onCall, onGoTo, onAdmin, onUnread, flash,
}: {
  net: Net | null;
  people: Member[];
  isAdmin: boolean;
  open: boolean;
  setOpen: (o: boolean) => void;
  /** voice levels by avatar id ("me" for self), e.g. engine.speaking */
  speaking: () => Map<string, number> | undefined;
  onWave: () => void;
  onCall: (p: Member) => void;
  onGoTo: (id: string) => void;
  onAdmin: (action: "kick" | "mute" | "unmute", p: Member) => void;
  onUnread: (n: number) => void;
  flash: (m: string) => void;
}) {
  const version = useSyncExternalStore(dmStore.subscribe, dmStore.getVersion, () => 0);
  const [tab, setTab] = useState<"members" | "dms">("members");
  const [pop, setPop] = useState<{ p: Member; top: number; right: number } | null>(null);
  const [toast, setToast] = useState<{ peer: DmPeer; text: string } | null>(null);
  const [talking, setTalking] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Set<string>>(new Set());
  const [mobile, setMobile] = useState(false);
  const seq = useRef(0);

  // ------------------------------------------------------------ wiring
  useEffect(() => {
    if (!net) return;
    const off = dmStore.attach(net);
    const fromLive = (l: { stage?: { id: string }[] } | undefined) => setStage(new Set((l?.stage || []).map((g) => g.id)));
    const last = net.last?.live as { live?: { stage?: { id: string }[] } } | undefined;
    fromLive(last?.live);
    const offLive = net.on((e) => {
      if (e.t === "live") fromLive(e.live);
      else if (e.t === "welcome") fromLive(e.live);
    });
    return () => (off(), offLive());
  }, [net]);

  useEffect(() => {
    dmStore.onNotify = (peer, text) => {
      setToast({ peer, text });
      setTimeout(() => setToast((t) => (t?.peer.pk === peer.pk && t.text === text ? null : t)), 4500);
    };
    dmStore.onError = flash;
  }, [flash]);

  // desktop: sidebar open by default (remembered); keep the canvas sized to the remaining space
  useEffect(() => {
    const m = isMobile();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobile(m);
    const pref = () => {
      try {
        return localStorage.getItem(PREF) ?? "1";
      } catch {
        return "1";
      }
    };
    if (!m && pref() !== "0") setOpen(true);
    let was = m;
    const onR = () => {
      const now = isMobile();
      if (now === was) return;
      was = now;
      setMobile(now);
      // crossing the breakpoint: the drawer starts closed, the desktop sidebar follows the saved preference
      setOpen(!now && pref() !== "0");
    };
    window.addEventListener("resize", onR);
    // phones: the drawer always starts closed, even if the first layout reported a desktop width
    // (in-app browsers / emulators settle the viewport a moment after load)
    const settle = setTimeout(() => {
      if (isMobile()) {
        was = true;
        setMobile(true);
        setOpen(false);
      }
    }, 400);
    return () => (clearTimeout(settle), window.removeEventListener("resize", onR));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const firstOpen = useRef(true);
  useEffect(() => {
    if (!mobile && !firstOpen.current) {
      try {
        localStorage.setItem(PREF, open ? "1" : "0");
      } catch {}
    }
    firstOpen.current = false;
    const r = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(r);
  }, [open, mobile]);

  // speaking ring: poll the engine's voice levels (cheap, ~3 Hz, re-render only on change)
  useEffect(() => {
    const t = setInterval(() => {
      const m = speaking();
      if (!m) return;
      const next = new Set<string>();
      for (const [id, lvl] of m) if (lvl > 0.04) next.add(id);
      setTalking((cur) => (cur.size === next.size && [...next].every((x) => cur.has(x)) ? cur : next));
    }, 350);
    return () => clearInterval(t);
  }, [speaking]);

  // DM opened from elsewhere (info card): bring the panel up
  useEffect(() => {
    if (dmStore.openSeq === seq.current) return;
    seq.current = dmStore.openSeq;
     
    setTab("dms");
    if (isMobile() && !open) setOpen(true);
  }, [version, open, setOpen]);

  const unread = dmStore.unreadTotal;
  useEffect(() => onUnread(unread), [unread, onUnread]);

  const dmShown = !!(dmStore.openPk || dmStore.opening) && (!mobile || (open && tab === "dms"));
  useEffect(() => {
    const upd = () => dmStore.setVisible(dmShown && document.visibilityState === "visible");
    upd();
    document.addEventListener("visibilitychange", upd);
    return () => document.removeEventListener("visibilitychange", upd);
  }, [dmShown]);

  // open conversation peer: keep "online" in sync with the live member list
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const me = people.find((p) => p.me);
  const convs = dmStore.sortedConvs();
  const openConv: DmConv | null = dmStore.openPk ? dmStore.convs.get(dmStore.openPk) || null : null;
  const openPeer = openConv ? { ...openConv, peer: { ...openConv.peer, id: openConv.peer.id && byId.has(openConv.peer.id) ? openConv.peer.id : null } } : null;

  const pick = useCallback((p: Member, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPop((cur) => (cur?.p.id === p.id ? null : { p, top: Math.min(r.top, window.innerHeight - 290), right: window.innerWidth - r.left + 8 }));
  }, []);

  const startDm = (p: Member) => {
    setPop(null);
    dmStore.open({ id: p.id, name: p.name, look: p.look });
    setTab("dms");
  };

  const popP = pop ? byId.get(pop.p.id) || null : null;
  const popPk = popP ? dmStore.pkForId(popP.id) : null;

  return (
    <>
      {mobile && open && <div className="pm-sh-scrim" onClick={() => setOpen(false)} />}
      <aside className={`pm-social ${open ? "open" : "shut"} ${mobile ? "drawer" : ""}`} aria-label="Membros e mensagens" onClick={(e) => e.stopPropagation()}>
        <div className="pm-sh-inner">
          <div className="pm-sh-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "members"} className={tab === "members" ? "sel" : ""} onClick={() => setTab("members")}>
              Membros <span>{people.length}</span>
            </button>
            <button role="tab" aria-selected={tab === "dms"} className={tab === "dms" ? "sel" : ""} onClick={() => setTab("dms")}>
              Mensagens {unread > 0 && <span className="pm-sh-count">{unread > 99 ? "99+" : unread}</span>}
            </button>
            <button className="pm-sh-x" onClick={() => setOpen(false)} aria-label={mobile ? "Fechar" : "Recolher painel"} title={mobile ? "Fechar" : "Recolher"}>
              {mobile ? "×" : "»"}
            </button>
          </div>

          {tab === "members" ? (
            <MemberList people={people} stage={stage} talking={talking} onPick={pick} selected={pop?.p.id || null} />
          ) : mobile && dmShown ? (
            <DmWindow conv={openPeer} msgs={dmStore.openPk ? dmStore.threads.get(dmStore.openPk) || [] : []} blocked={!!dmStore.openPk && dmStore.blocked.has(dmStore.openPk)} meLook={me?.look} onClose={() => dmStore.close()} onBack={() => dmStore.close()} />
          ) : (
            <div className="pm-sh-dms">
              <div className="pm-sh-sub">
                <span>MENSAGENS DIRETAS</span>
                <button className={`pm-sh-sound ${dmStore.sound ? "" : "off"}`} onClick={() => dmStore.setSound(!dmStore.sound)} title={dmStore.sound ? "Som ligado" : "Som desligado"} aria-label="Som das mensagens">
                  {dmStore.sound ? "🔔" : "🔕"}
                </button>
              </div>
              <DmList convs={convs.map((c) => ({ ...c, peer: { ...c.peer, id: c.peer.id && byId.has(c.peer.id) ? c.peer.id : null } }))} openPk={dmStore.openPk} onOpen={(c) => dmStore.open({ pk: c.peer.pk, id: c.peer.id, name: c.peer.name, look: c.peer.look })} />
            </div>
          )}
        </div>

        {/* desktop: the conversation floats beside the sidebar */}
        {!mobile && dmShown && (
          <div className="pm-dw-float">
            <DmWindow conv={openPeer} msgs={dmStore.openPk ? dmStore.threads.get(dmStore.openPk) || [] : []} blocked={!!dmStore.openPk && dmStore.blocked.has(dmStore.openPk)} meLook={me?.look} onClose={() => dmStore.close()} />
          </div>
        )}
      </aside>

      {popP && pop && (open || mobile) && (
        <>
          <div className="pm-sh-catch" onClick={() => setPop(null)} />
          <div className={`pm-pc ${mobile ? "sheet" : ""}`} style={mobile ? undefined : { top: pop.top, right: pop.right }} role="dialog" aria-label={`Perfil de ${popP.name}`}>
            <div className={`pm-pc-banner ${roleOf(popP)}`} />
            <div className="pm-pc-av">
              <Head look={popP.look} size={64} status="on" />
            </div>
            <div className="pm-pc-body">
              <b className="pm-pc-name">{popP.name}</b>
              <div className="pm-pc-tags">
                <span className={`pm-sh-badge ${roleOf(popP)}`}>{rankOf(popP)}</span>
                {popP.me && <span className="pm-sh-badge me">você</span>}
                {stage.has(popP.id) && <span className="pm-sh-badge stage">no palco</span>}
              </div>
              <small>{popP.mic ? "🎙️ microfone ligado" : "microfone desligado"}</small>
              <div className="pm-pc-actions">
                {!popP.me && (
                  <button className="pm-pc-main" onClick={() => startDm(popP)}>
                    Mensagem
                  </button>
                )}
                <button onClick={() => (onWave(), setPop(null))}>👋 Acenar</button>
                {!popP.me && (
                  <>
                    <button onClick={() => (onCall(popP), setPop(null))}>Chamar pra perto</button>
                    <button onClick={() => (onGoTo(popP.id), setPop(null), mobile && setOpen(false))}>Ir até</button>
                    {popPk && (
                      <button className="warn" onClick={() => (dmStore.block(popPk, !dmStore.blocked.has(popPk)), setPop(null))}>
                        {dmStore.blocked.has(popPk) ? "Desbloquear" : "Bloquear"}
                      </button>
                    )}
                  </>
                )}
              </div>
              {isAdmin && !popP.me && (
                <div className="pm-pc-adm">
                  <button onClick={() => onAdmin("mute", popP)}>mutar</button>
                  <button onClick={() => onAdmin("unmute", popP)}>desmutar</button>
                  <button onClick={() => (onAdmin("kick", popP), setPop(null))}>expulsar</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {toast && (
        <button
          className="pm-dm-toast"
          onClick={() => {
            dmStore.open({ pk: toast.peer.pk, id: toast.peer.id, name: toast.peer.name, look: toast.peer.look });
            setTab("dms");
            setOpen(true);
            setToast(null);
          }}
        >
          <Head look={toast.peer.look} size={32} />
          <span>
            <b>Nova mensagem de {toast.peer.name}</b>
            <small>{toast.text.length > 70 ? toast.text.slice(0, 70) + "…" : toast.text}</small>
          </span>
        </button>
      )}
    </>
  );
}
