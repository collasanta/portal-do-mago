"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EMOTE_LIST, Engine } from "@/lib/portal/engine";
import { inLiveZone, type Interact } from "@/lib/portal/map";
import { Net, type ChatMsg, type ServerEvent } from "@/lib/portal/net";
import { rankOf } from "@/lib/portal/overlay";
import { nearestWalkable } from "@/lib/portal/path";
import { Voice } from "@/lib/portal/voice";
import { attachInput } from "@/lib/portal/input";
import type { Look } from "@/lib/portal/art";
import { AvatarPreview, HWin, HatMark, PX, PixelIcon } from "./bits";
import type { Profile } from "./Entry";
import { ChatLog } from "./ChatLog";
import { LiveLayer } from "./live/LiveLayer";
import { TvLayer } from "./tv/TvLayer";
import { Social, openDm } from "./social/Social";

const MIC_LOCKED = "Mic liberado só pra quem o Mago chamar";

type Person = { id: string; name: string; look: Look; mic: boolean; admin: boolean; role?: string; me: boolean };

const MODALS: Record<Exclude<Interact, "oraculo" | "links" | "tv">, { title: string; body: React.ReactNode }> = {
  mago: {
    title: "Fala, mago! 🧙",
    body: (
      <>
        <p>Bem-vindo ao <b>Salão do Grimório</b>, o ponto de encontro de quem tá construindo canal com o Mago.</p>
        <ul>
          <li>Clique no chão pra andar, ou use as setas / <b>WASD</b>.</li>
          <li>Segure <b>Espaço</b> pra falar (push-to-talk); o botão de microfone deixa aberto.</li>
          <li><b>Enter</b> abre o chat, <b>Esc</b> fecha a janela de cima.</li>
          <li>Chegue perto de alguém e liga o microfone: a conversa por voz começa sozinha.</li>
          <li>Dúvida do curso? Pergunta pro <b>Oráculo</b> na mesa da esquerda.</li>
          <li>Mostre seu canal no <b>Canto dos Nichos</b> e cola na <b>Taverna</b> pra resenha.</li>
        </ul>
      </>
    ),
  },
  nichos: {
    title: "Canto dos Nichos",
    body: (
      <>
        <p>O mural do que tá bombando entre os alunos. Puxa uma cadeira, mostra seu canal e pede feedback.</p>
        <ul>
          <li>🎵 Música com IA (Suno, Mureka)</li>
          <li>🎬 Resumo de filmes e séries</li>
          <li>🎮 Games e nostalgia</li>
          <li>🌏 Conteúdo gringo (Bilibili, Douyin)</li>
          <li>🤖 Canais dark com IA</li>
        </ul>
        <p style={{ marginTop: 12 }}>Manda o link do seu canal no chat e chama a galera pra ver.</p>
      </>
    ),
  },
  palco: {
    title: "Palco das Lives",
    body: <p>É aqui que o Mago aparece nas lives. Quando tiver live, o aviso chega no grupo e no chat do salão. Por enquanto, sobe no palco e treina sua pose de YouTuber. 🎤</p>,
  },
  grimorio: {
    title: "O Grimório",
    body: <p>O livro de feitiços do canal: método, nichos e atalhos que o Mago ensina no curso. As páginas novas aparecem aqui conforme a comunidade cresce. ✨</p>,
  },
  gato: { title: "Miau.", body: <p>O gato da taverna olha pra você com desprezo e volta a dormir. 🐈‍⬛</p> },
};

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function Room({ profile, uid, adminKey, room, onLeave }: { profile: Profile; uid: string; adminKey?: string; room?: string; onLeave: (reason?: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const netRef = useRef<Net | null>(null);
  const voiceRef = useRef<Voice | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Net["status"]>("connecting");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [pop, setPop] = useState<"emotes" | "config" | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [call, setCall] = useState<{ from: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const [mic, setMic] = useState(false);
  const [muted, setMuted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [modal, setModal] = useState<Exclude<Interact, "oraculo" | "links" | "tv"> | null>(null);
  const [oracle, setOracle] = useState(false);
  const [links, setLinks] = useState(false);
  const [lives, setLives] = useState(false);
  const [toast, setToast] = useState("");
  const [walked, setWalked] = useState(false);
  const [peers, setPeers] = useState(0);
  const [ptt, setPtt] = useState(false);
  // Server-enforced "live mode" (only the host speaks) wires this: set canSpeakRef.current = false for listeners.
  const canSpeakRef = useRef(true);
  const canSpeak = () => canSpeakRef.current;
  const [micLock, setMicLock] = useState("");
  const [liveNet, setLiveNet] = useState<Net | null>(null);
  const pttHeld = useRef(false);
  const pttOwned = useRef(false);
  const kb = useRef<{ pttStart: () => void; pttEnd: () => void; closeTop: () => void }>({ pttStart() {}, pttEnd() {}, closeTop() {} });
  const myId = useRef<string | null>(null);
  const logOpenRef = useRef(false);
  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    logOpenRef.current = logOpen;
  }, [logOpen]);

  const flash = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? "" : t)), 3500);
  }, []);

  const refreshPeople = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const list: Person[] = [...e.avatars.values()].map((a) => ({ id: a.id, name: a.name, look: a.look, mic: a.mic, admin: a.admin, role: a.role, me: !!a.me }));
    list.sort((a, b) => Number(b.me) - Number(a.me) || Number(b.admin) - Number(a.admin) || a.name.localeCompare(b.name));
    setPeople(list);
  }, []);

  useEffect(() => {
    const engine = new Engine(canvasRef.current!);
    engineRef.current = engine;
    const css = getComputedStyle(document.documentElement);
    const pix = css.getPropertyValue("--font-pixel").trim();
    if (pix) engine.pixelFont = pix;

    let last = { x: -1, y: -1 };
    const net = new Net(() => {
      const me = engine.me();
      return {
        name: profile.name,
        look: profile.look,
        code: profile.code,
        mt: profile.mt,
        uid,
        adminKey,
        ...(me ? { x: Math.round(me.x), y: Math.round(me.y) } : last.x >= 0 ? last : {}),
      };
    }, room || "salao");
    netRef.current = net;
    setLiveNet(net);

    const voice = new Voice(
      () => myId.current,
      (to, d) => net.send({ t: "rtc", to, d }),
    );
    voiceRef.current = voice;
    voice.onChange = () => setPeers([...voice.peers.values()].filter((p) => p.state === "connected").length);

    engine.onMove = (from, to) => {
      net.send({ t: "mv", x: from.x, y: from.y, tx: to.x, ty: to.y });
      last = to;
      setWalked(true);
    };
    engine.onSit = (seat) => net.send({ t: "sit", s: seat });
    engine.onSeatBusy = () => flash("Esse lugar já está ocupado.");
    engine.onInteract = (k) => {
      // during a live the stage screen opens the AO VIVO window instead of the info card
      if (k === "palco" && (net.last.live as { live?: { on?: boolean } } | undefined)?.live?.on) {
        window.dispatchEvent(new Event("pm-live-open"));
        return;
      }
      if (k === "oraculo") setOracle(true);
      else if (k === "tv") window.dispatchEvent(new Event("pm-tv-open"));
      else if (k === "links") setLinks(true);
      else setModal(k);
    };
    engine.onTileClick = () => voice.unlock();
    engine.onAvatarClick = (id) => {
      setSel(id);
      setPop(null);
      if (id && window.innerWidth < 760) {
        setLogOpen(false);
        setOnlineOpen(false);
      }
    };

    let peopleTimer: ReturnType<typeof setTimeout> | null = null;
    const schedulePeople = () => {
      if (!peopleTimer) peopleTimer = setTimeout(() => ((peopleTimer = null), refreshPeople()), 400);
    };

    net.onStatus = setStatus;
    net.onEvent = (ev: ServerEvent) => {
      switch (ev.t) {
        case "welcome":
          for (const id of [...engine.avatars.keys()]) engine.remove(id);
          for (const id of [...voice.peers.keys()]) voice.close(id);
          myId.current = ev.me.id;
          setMeId(ev.me.id);
          engine.upsert(ev.me, true);
          for (const u of ev.users) engine.upsert(u);
          setChat(ev.chat);
          setIsAdmin(ev.admin);
          setMuted(ev.muted);
          if (voice.micOn && !ev.muted) net.send({ t: "mic", on: true });
          refreshPeople();
          break;
        case "join":
          if (ev.u.id !== myId.current) engine.upsert(ev.u);
          schedulePeople();
          break;
        case "leave":
          engine.remove(ev.id);
          voice.close(ev.id);
          schedulePeople();
          break;
        case "mv":
          if (ev.id !== myId.current) engine.remoteMove(ev.id, ev.x, ev.y, ev.tx, ev.ty);
          break;
        case "sit":
          if (ev.id !== myId.current) engine.setSeat(ev.id, ev.s);
          break;
        case "sitno":
          engine.seatRefused();
          break;
        case "chat":
          setChat((c) => [...c.slice(-199), ev.m]);
          if (ev.m.id !== "sys") engine.say(ev.m.id, ev.m.text);
          if (!logOpenRef.current && ev.m.id !== myId.current) setUnread((u) => u + 1);
          break;
        case "emote":
          engine.emote(ev.id, ev.e);
          break;
        case "typing":
          engine.typing(ev.id, ev.on);
          break;
        case "call":
          setCall({ from: ev.from, name: ev.name });
          setTimeout(() => setCall((c) => (c?.from === ev.from ? null : c)), 12000);
          break;
        case "mic": {
          const a = engine.avatars.get(ev.id);
          if (a) a.mic = ev.on;
          schedulePeople();
          break;
        }
        case "rtc":
          voice.onSignal(ev.from, ev.d);
          break;
        case "sys":
          setChat((c) => [...c, { id: "sys", name: "Salão", text: ev.text, ts: Date.now(), sys: true }]);
          break;
        case "err":
          flash(ev.msg);
          break;
        case "muted":
          setMuted(ev.on);
          if (ev.on) {
            voice.disableMic();
            setMic(false);
            engine.micOn = false;
            flash("A moderação desligou seu microfone e chat.");
          }
          break;
        case "clear":
          setChat([]);
          engine.overlay.clear();
          break;
        case "denied":
          onLeave(
            ev.reason === "code"
              ? "Código da sala incorreto."
              : ev.reason === "member"
                ? "Seu acesso de membro não foi confirmado. Entre de novo com o e-mail da compra."
                : "Você foi removido do salão pela moderação. Tente mais tarde.",
          );
          break;
        case "kicked":
          onLeave("Você foi removido do salão pela moderação.");
          break;
        case "adminr":
          flash(ev.r?.ok ? `Feito${ev.r.name ? `: ${ev.r.name}` : ""}.` : `Erro: ${ev.r?.error || "?"}`);
          break;
      }
    };
    net.connect();

    // voice proximity + speaking levels
    const vt = setInterval(() => {
      const me = engine.me();
      if (!me) return;
      const others = [...engine.avatars.values()].filter((a) => !a.me).map((a) => ({ id: a.id, x: a.x, y: a.y, mic: a.mic }));
      voice.update({ id: me.id, x: me.x, y: me.y, mic: voice.micOn }, others);
    }, 500);
    const lt = setInterval(() => {
      voice.levels();
      engine.speaking.set("me", voice.localLevel);
      for (const p of voice.peers.values()) engine.speaking.set(p.id, p.level);
    }, 100);
    const pt = setInterval(refreshPeople, 3000);

    const detachInput = attachInput({
      walk: (sx, sy, fresh) => engine.keyStep(sx, sy, fresh),
      stopWalk: () => {},
      pttStart: () => kb.current.pttStart(),
      pttEnd: () => kb.current.pttEnd(),
      focusChat: () => document.querySelector<HTMLInputElement>("input[data-pm-chat]")?.focus(),
      closeTop: () => kb.current.closeTop(),
    });

    // expose for debugging / automated checks
    (window as unknown as Record<string, unknown>).__portal = { engine, net, voice };

    return () => {
      clearInterval(vt);
      clearInterval(lt);
      clearInterval(pt);
      detachInput();
      net.close();
      voice.destroy();
      engine.destroy();
      setLiveNet(null);
    };
  }, [profile, uid, adminKey, room, onLeave, flash, refreshPeople]);

  // live mode / mute-all: proximity voice closed (the server enforces it too, this keeps the UI honest)
  const onLock = useCallback((locked: boolean, why: string) => {
    canSpeakRef.current = !locked;
    setMicLock(locked ? why : "");
    const v = voiceRef.current;
    if (!v) return;
    v.setLocked(locked);
    if (locked) {
      netRef.current?.send({ t: "mic", on: false });
      setMic(false);
      setPtt(false);
      if (engineRef.current) engineRef.current.micOn = false;
    }
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [chat, logOpen]);


  async function toggleMic() {
    const v = voiceRef.current!, net = netRef.current!, e = engineRef.current!;
    if (muted) return flash("Seu microfone foi desligado pela moderação.");
    if (!v.micOn && !canSpeak()) return flash(micLock === "muteall" ? "A moderação fechou os microfones do salão." : MIC_LOCKED);
    pttOwned.current = false;
    if (v.micOn) {
      v.disableMic();
      net.send({ t: "mic", on: false });
      setMic(false);
      e.micOn = false;
      return;
    }
    const ok = await v.enableMic();
    if (!ok) return flash("Não consegui acessar o microfone. Libera a permissão no navegador.");
    net.send({ t: "mic", on: true });
    setMic(true);
    e.micOn = true;
    flash("Microfone ligado: quem estiver dentro do círculo te ouve.");
  }

  // push-to-talk (Space): mic is live only while held, unless the toggle already left it open
  async function pttStart() {
    const v = voiceRef.current!, net = netRef.current!, e = engineRef.current!;
    if (muted) return flash("Seu microfone foi desligado pela moderação.");
    if (!canSpeak()) return flash(micLock === "muteall" ? "A moderação fechou os microfones do salão." : MIC_LOCKED);
    pttHeld.current = true;
    if (v.micOn) return setPtt(true);
    const ok = await v.enableMic(); // first press requests the permission
    if (!ok) {
      pttHeld.current = false;
      return flash("Não consegui acessar o microfone. Libera a permissão no navegador.");
    }
    pttOwned.current = true;
    net.send({ t: "mic", on: true });
    setMic(true);
    e.micOn = true;
    if (pttHeld.current) setPtt(true);
    else pttEnd();
  }
  function pttEnd() {
    pttHeld.current = false;
    setPtt(false);
    if (!pttOwned.current) return;
    pttOwned.current = false;
    voiceRef.current?.disableMic();
    netRef.current?.send({ t: "mic", on: false });
    setMic(false);
    if (engineRef.current) engineRef.current.micOn = false;
  }
  function closeTop() {
    if (lives) setLives(false);
    else if (links) setLinks(false);
    else if (oracle) setOracle(false);
    else if (modal) setModal(null);
    else if (sel) closeSel();
    else if (pop) setPop(null);
    else if (onlineOpen && window.innerWidth <= 900) setOnlineOpen(false);
    else if (logOpen) toggleLog();
  }
  kb.current = { pttStart, pttEnd, closeTop };

  function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const net = netRef.current!;
    if (isAdmin && t.startsWith("/aviso ")) net.send({ t: "admin", action: "announce", text: t.slice(7) });
    else if (isAdmin && t === "/limpar") net.send({ t: "admin", action: "clear" });
    else net.send({ t: "chat", text: t.slice(0, 240) });
    net.typing(false);
    setText("");
  }

  const admin = (action: "kick" | "mute" | "unmute", p: Person) => {
    if (action === "kick" && !confirm(`Expulsar ${p.name} do salão por 30 minutos?`)) return;
    netRef.current?.send({ t: "admin", action, target: p.id });
  };

  const online = people.length;
   
  const myPos = useCallback(() => {
    const m = engineRef.current?.me();
    return m ? { x: m.x, y: m.y } : null;
  }, []);
  // "chegar perto": the nearest free audience seat, else the centre aisle
  const goLive = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (!e.sitNearest((s) => inLiveZone(s.x, s.y))) e.walkTo({ x: 16, y: 17 });
  }, []);
  const speakingLevels = useCallback(() => engineRef.current?.speaking, []);
  const selP = sel ? people.find((p) => p.id === sel) || null : null;
  const net = () => netRef.current;
  const closeSel = () => {
    setSel(null);
    if (engineRef.current) engineRef.current.overlay.selectedId = null;
  };
  const goTo = (id: string) => {
    const e = engineRef.current;
    const a = e?.avatars.get(id);
    const me = e?.me();
    if (!e || !a || !me) return;
    const near = nearestWalkable({ x: Math.round(a.x) + 1, y: Math.round(a.y) + 1 }, { x: Math.round(me.x), y: Math.round(me.y) });
    if (near) e.walkTo(near);
  };
  // phones have room for one floating window at a time (they all dock above the bottom bar)
  const narrow = () => typeof window !== "undefined" && window.innerWidth < 760;
  const toggleLog = () => {
    setLogOpen((o) => !o);
    setUnread(0);
    setPop(null);
  };
  const toggleOnline = () => {
    if (!onlineOpen && narrow()) {
      setLogOpen(false);
      closeSel();
    }
    setOnlineOpen((o) => !o);
    setPop(null);
  };

  return (
    <div className="pm-root">
      <div className="pm-stage" onClick={() => setPop(null)}>
        <canvas ref={canvasRef} className="pm-canvas" />

        <div className="pm-plaque">
          <HatMark />
          <div>
            <b>Salão do Grimório</b>
            <span>
              <i className={`pm-dot ${status === "online" ? "" : status === "connecting" ? "warn" : "off"}`} />
              {status === "online" ? `${online} online` : status === "connecting" ? "conectando…" : "reconectando…"}
              {mic && peers > 0 ? ` · voz com ${peers}` : ""}
            </span>
          </div>
        </div>

        <div className="pm-hint" style={{ opacity: walked || sel ? 0 : 1 }}>
          Clique no chão para andar
        </div>

        {ptt && <div className="pm-ptt" role="status">🎙️ Falando…</div>}

        <LiveLayer net={liveNet} code={profile.mt || adminKey || profile.code || ""} online={online} flash={flash} onLock={onLock} myPos={myPos} goLive={goLive} />

        <TvLayer net={liveNet} cred={profile.mt || profile.code || ""} flash={flash} myPos={myPos} />

        <ChatLog chat={chat} meId={meId} people={people} pinned={logOpen} />

        {selP && (
          <div className="pm-info" onClick={(e) => e.stopPropagation()}>
            <button className="pm-win-x" onClick={closeSel} aria-label="Fechar">
              ×
            </button>
            <div className="pm-info-name">{selP.name}</div>
            <div className="pm-info-row">
              <div className="pm-info-av">
                <AvatarPreview look={selP.look} size={2} walk={false} />
              </div>
              <div className="pm-info-meta">
                <span className={`pm-rank ${selP.admin ? "arqui" : ""}`}>{rankOf(selP)}</span>
                {selP.me && <span className="pm-tag blue">você</span>}
                <span className="pm-info-sub">{selP.mic ? "🎙️ microfone ligado" : "microfone desligado"}</span>
              </div>
            </div>
            <div className="pm-info-actions">
              <button className="pm-btn small" onClick={() => net()?.send({ t: "emote", e: "wave" })}>
                👋 Acenar
              </button>
              {!selP.me && (
                <>
                  <button
                    className="pm-btn small gold"
                    onClick={() => {
                      net()?.send({ t: "call", to: selP.id });
                      flash(`Chamado enviado pra ${selP.name}.`);
                    }}
                  >
                    Chamar pra perto
                  </button>
                  <button className="pm-btn small ghost" onClick={() => goTo(selP.id)}>
                    Ir até
                  </button>
                  <button className="pm-btn small ghost" onClick={() => (openDm(selP), closeSel())}>
                    Mensagem
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {call && (
          <div className="pm-callcard">
            <b>{call.name}</b> tá te chamando pra perto!
            <div>
              <button className="pm-btn small" onClick={() => (goTo(call.from), setCall(null))}>
                Ir até lá
              </button>
              <button className="pm-btn small ghost" onClick={() => setCall(null)}>
                Agora não
              </button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- Habbo bottom bar */}
        <div className="pm-bar" onClick={(e) => e.stopPropagation()}>
          <div className="pm-bar-side">
            <button className="pm-tb" onClick={() => setOracle(true)} title="Oráculo do Mago" aria-label="Oráculo">
              <PixelIcon art={PX.orb} />
              <span>Oráculo</span>
            </button>
            <button className="pm-tb" onClick={() => setLinks(true)} title="Links úteis" aria-label="Links">
              <PixelIcon art={PX.link} />
              <span>Links</span>
            </button>
            <button className="pm-tb" onClick={() => setLives(true)} title="Lives anteriores" aria-label="Lives">
              <PixelIcon art={PX.tv} />
              <span>Lives</span>
            </button>
            <button className="pm-tb" onClick={() => setModal("nichos")} title="Canto dos Nichos" aria-label="Nichos">
              <PixelIcon art={PX.board} />
              <span>Nichos</span>
            </button>
            <div className="pm-pop-wrap">
              <button className={`pm-tb ${pop === "emotes" ? "sel" : ""}`} onClick={() => setPop((p) => (p === "emotes" ? null : "emotes"))} title="Emotes" aria-label="Emotes">
                <PixelIcon art={PX.smile} />
                <span>Emotes</span>
              </button>
              {pop === "emotes" && (
                <div className="pm-pop">
                  {EMOTE_LIST.map(([k, e]) => (
                    <button key={k} className="pm-emote" title={k} onClick={() => (net()?.send({ t: "emote", e: k }), setPop(null))}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <form className="pm-bar-chat" onSubmit={send}>
            <input
              value={text}
              maxLength={240}
              placeholder={muted ? "Chat bloqueado pela moderação" : "Clique aqui para falar…"}
              disabled={muted}
              onChange={(e) => {
                setText(e.target.value);
                net()?.typing(e.target.value.trim().length > 0);
              }}
              onBlur={() => !text.trim() && net()?.typing(false)}
              data-pm-chat=""
              enterKeyHint="send"
              aria-label="Mensagem"
            />
            <button aria-label="Enviar" disabled={muted || !text.trim()}>
              <PixelIcon art={PX.send} />
            </button>
          </form>

          <div className="pm-bar-side">
            <button className={`pm-tb ${mic ? "on" : ""}`} onClick={toggleMic} aria-pressed={mic} title={micLock ? (micLock === "muteall" ? "Microfones fechados pela moderação" : MIC_LOCKED) : mic ? "Desligar microfone" : "Ligar microfone"} aria-label="Microfone">
              <PixelIcon art={PX.mic} swap={mic ? { G: "K" } : undefined} slash={!mic} />
              <span>{mic ? "Mic on" : "Mic"}</span>
            </button>
            <button className={`pm-tb ${onlineOpen ? "sel" : ""}`} onClick={toggleOnline} title="Quem está online" aria-label="Online">
              <PixelIcon art={PX.people} />
              <span>{online}</span>
              {dmUnread > 0 && <span className="pm-badge">{dmUnread > 9 ? "9+" : dmUnread}</span>}
            </button>
            <button className={`pm-tb ${logOpen ? "sel" : ""}`} onClick={toggleLog} title={logOpen ? "Soltar o chat (some quando ninguém fala)" : "Fixar o chat aberto"} aria-label="Fixar o chat aberto" aria-pressed={logOpen}>
              <PixelIcon art={PX.log} />
              <span>Chat</span>
              {false && unread > 0 && <span className="pm-badge">{unread > 9 ? "9+" : unread}</span>}
            </button>
            <div className="pm-pop-wrap">
              <button className={`pm-tb ${pop === "config" ? "sel" : ""}`} onClick={() => setPop((p) => (p === "config" ? null : "config"))} title="Ajustes" aria-label="Ajustes">
                <PixelIcon art={PX.gear} />
                <span>Ajustes</span>
              </button>
              {pop === "config" && (
                <div className="pm-pop right col">
                  <button className="pm-pop-item" onClick={() => engineRef.current?.setZoom(1)}>
                    🔍 Aproximar
                  </button>
                  <button className="pm-pop-item" onClick={() => engineRef.current?.setZoom(-1)}>
                    🔭 Afastar
                  </button>
                  <button className="pm-pop-item" onClick={() => (setModal("mago"), setPop(null))}>
                    ❓ Como funciona
                  </button>
                  <button className="pm-pop-item danger" onClick={() => onLeave()}>
                    <PixelIcon art={PX.door} className="pm-mini" /> Sair do salão
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Social
        net={liveNet}
        people={people}
        isAdmin={isAdmin}
        open={onlineOpen}
        setOpen={setOnlineOpen}
        speaking={speakingLevels}
        onWave={() => net()?.send({ t: "emote", e: "wave" })}
        onCall={(p) => (net()?.send({ t: "call", to: p.id }), flash(`Chamado enviado pra ${p.name}.`))}
        onGoTo={goTo}
        onAdmin={admin}
        onUnread={setDmUnread}
        flash={flash}
      />

      {modal && (
        <div className="pm-scrim" onClick={() => setModal(null)}>
          <HWin className="pm-w-modal" title={MODALS[modal].title} icon={modal === "nichos" ? <PixelIcon art={PX.board} /> : <HatMark />} onClose={() => setModal(null)}>
            {MODALS[modal].body}
            <div className="actions">
              {modal === "palco" && (
                <button className="pm-btn ghost" onClick={() => (setModal(null), setLives(true))}>
                  Lives anteriores
                </button>
              )}
              {modal === "mago" && (
                <button className="pm-btn ghost" onClick={() => (setModal(null), setOracle(true))}>
                  Falar com o Oráculo
                </button>
              )}
              <button className="pm-btn" onClick={() => setModal(null)}>
                Bora!
              </button>
            </div>
          </HWin>
        </div>
      )}

      {oracle && (
        <div className="pm-scrim light" onClick={() => setOracle(false)}>
          <HWin
            className="pm-w-oracle"
            title="Oráculo do Mago"
            icon={<PixelIcon art={PX.orb} />}
            onClose={() => setOracle(false)}
            bodyClass="pm-oracle-body"
          >
            <a className="pm-oracle-ext" href="/oraculo" target="_blank" rel="noopener">
              abrir em nova aba ↗
            </a>
            <iframe src="/oraculo?embed=1" title="Oráculo do Mago" allow="clipboard-write" />
          </HWin>
        </div>
      )}

      {links && (
        <div className="pm-scrim light" onClick={() => setLinks(false)}>
          <HWin
            className="pm-w-oracle"
            title="Links úteis"
            icon={<PixelIcon art={PX.link} />}
            onClose={() => setLinks(false)}
            bodyClass="pm-oracle-body"
          >
            <iframe src="/links?embed=1" title="Links úteis" />
          </HWin>
        </div>
      )}

      {lives && (
        <div className="pm-scrim light" onClick={() => setLives(false)}>
          <HWin
            className="pm-w-oracle"
            title="Lives anteriores"
            icon={<PixelIcon art={PX.tv} />}
            onClose={() => setLives(false)}
            bodyClass="pm-oracle-body"
          >
            <a className="pm-oracle-ext" href="/lives" target="_blank" rel="noopener">
              abrir em nova aba ↗
            </a>
            <iframe src="/lives?embed=1" title="Lives anteriores" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
          </HWin>
        </div>
      )}

      {toast && <div className="pm-toast">{toast}</div>}
    </div>
  );
}
