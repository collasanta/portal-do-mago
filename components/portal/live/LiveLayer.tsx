"use client";
// Live mode: viewer window, stage-guest card and host panel. Plugs into Room through the Net listener API,
// so Room.tsx only renders <LiveLayer/> and passes a lock callback for proximity voice.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hand, LiveState, Net, Role, ServerEvent } from "@/lib/portal/net";
import { HostMedia, Publisher, Puller, REACTION_EMOJI } from "@/lib/portal/live";
import { liveFx } from "@/lib/portal/room-art";
import { inLiveZone } from "@/lib/portal/map";
import { setStageVideo, stageScreen } from "@/lib/portal/stage-screen";
import { HostPanel } from "./HostPanel";
import { AudioOut, LiveWindow, type Float } from "./LiveWindow";
import "./live.css";

export type LiveProps = {
  net: Net | null;
  code: string;
  online: number;
  flash: (m: string) => void;
  /** true = proximity voice closed (live running, or mute-all for non-moderators) */
  onLock: (locked: boolean, why: string) => void;
  /** my avatar's tile position (live zone check) */
  myPos?: () => { x: number; y: number } | null;
  /** walk to the audience (nearest free seat) */
  goLive?: () => void;
};

/** Volume of the live when you walk out of the audience with the window closed (it keeps playing, quieter). */
const AWAY_VOLUME = 0.3;

/** Hidden <video> elements that feed the stage LED screen in the room (lib/portal/stage-screen.ts). */
function StageFeed({ main, pip }: { main: MediaStreamTrack | null | undefined; pip: MediaStreamTrack | null | undefined }) {
  const mRef = useRef<HTMLVideoElement>(null);
  const pRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const bind = (v: HTMLVideoElement | null, t: MediaStreamTrack | null | undefined) => {
      if (!v) return;
      const cur = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
      if (t && cur === t) return;
      v.srcObject = t ? new MediaStream([t]) : null;
      if (t) v.play().catch(() => {});
    };
    bind(mRef.current, main);
    bind(pRef.current, pip);
    setStageVideo(main ? mRef.current : null, pip ? pRef.current : null);
  }, [main, pip]);
  useEffect(() => () => setStageVideo(null, null), []);
  return (
    <div className="pm-stage-feed" aria-hidden>
      <video ref={mRef} autoPlay playsInline muted data-stage-feed="" />
      <video ref={pRef} autoPlay playsInline muted />
    </div>
  );
}

export type Pulled = { tracks: Map<string, MediaStreamTrack>; state: string; puller: Puller | null };

export function LiveLayer({ net, code, online, flash, onLock, myPos, goLive }: LiveProps) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("user");
  const [isMod, setIsMod] = useState(false);
  const [allMuted, setAllMuted] = useState(false);
  const [hands, setHands] = useState<Hand[]>([]);
  const [floats, setFloats] = useState<Float[]>([]);
  const [stageAsk, setStageAsk] = useState(false);
  const [panel, setPanel] = useState(false);
  // one capture/publish controller per room session (only used by moderators)
  const [hm] = useState(() => new HostMedia(code));
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  // ---------------------------------------------------------------- server events
  useEffect(() => {
    if (!net) return;
    const handle = (e: ServerEvent) => {
      switch (e.t) {
        case "welcome":
          setMeId(e.me.id);
          setRole(e.role || (e.admin ? "admin" : "user"));
          setIsMod(e.admin);
          if (e.live) setLive(e.live);
          setAllMuted(!!e.allMuted);
          if (e.hands) setHands(e.hands);
          break;
        case "live":
          setLive(e.live);
          break;
        case "hands":
          setHands(e.list);
          break;
        case "allmuted":
          setAllMuted(e.on);
          break;
        case "stage":
          setStageAsk(e.on);
          if (e.on) flash("🎤 O Mago te chamou pro palco!");
          break;
        case "rx": {
          const now = performance.now();
          const add: Float[] = [];
          for (const [k, n] of Object.entries(e.c)) for (let i = 0; i < Math.min(n, 8); i++) add.push({ k, id: `${now}-${k}-${i}`, x: 8 + Math.random() * 84, d: Math.random() * 600 });
          setFloats((f) => [...f.slice(-40), ...add]);
          setTimeout(() => setFloats((f) => f.filter((x) => !add.includes(x))), 3200);
          break;
        }
      }
    };
    for (const k of ["welcome", "live", "hands", "allmuted"] as const) {
      const ev = net.last[k];
      if (ev) handle(ev);
    }
    return net.on(handle);
  }, [net, flash]);

  const on = !!live?.on;
  const amHost = on && !!meId && live!.hostId === meId;
  const myGuest = on && meId ? live!.stage.find((g) => g.id === meId) || null : null;

  // ---------------------------------------------------------------- live zone (plateia) + window + sound
  const [inZone, setInZone] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const [sticky, setSticky] = useState(false);
  const [sound, setSound] = useState(false);
  useEffect(() => {
    if (!on || !myPos) return;
    const tick = () => {
      const p = myPos();
      setInZone(!!p && inLiveZone(p.x, p.y));
    };
    tick();
    const t = setInterval(tick, 400);
    return () => clearInterval(t);
  }, [on, myPos]);
  // a new live: closed window, nothing subscribed yet (the host and stage guests get the window)
  const liveId = on ? live!.id : "";
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setWinOpen(false);
    setSticky(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [liveId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (amHost || myGuest) setWinOpen(true);
  }, [amHost, myGuest]);
  // once you entered the audience or opened the window you stay subscribed until the live ends
  // (walking around the zone edge would otherwise re-negotiate SFU sessions over and over)
  const want = on && !amHost && (inZone || winOpen || sticky);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (want && !sticky) setSticky(true);
  }, [want, sticky]);
  const entered = useRef("");
  useEffect(() => {
    if (!on || !inZone || amHost || entered.current === live!.id) return;
    entered.current = live!.id;
    flash(live!.source === "embed" ? "Você chegou na plateia: a live abre na janela." : "Você chegou na plateia: a live tá no telão do palco. 🔊 Clique pra ouvir.");
    // an embedded player (YouTube etc.) can't be drawn on the room screen: open the window instead
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (live!.source === "embed") setWinOpen(true);
  }, [on, inZone, amHost, live, flash]);
  useEffect(() => {
    const open = () => setWinOpen(true);
    window.addEventListener("pm-live-open", open);
    return () => window.removeEventListener("pm-live-open", open);
  }, []);

  // ---------------------------------------------------------------- room art + voice lock
  useEffect(() => {
    liveFx.on = on;
    return () => {
      liveFx.on = false;
    };
  }, [on]);
  useEffect(() => {
    if (on) onLock(true, "live");
    else if (allMuted && !isMod) onLock(true, "muteall");
    else onLock(false, "");
  }, [on, allMuted, isMod, onLock]);

  // ---------------------------------------------------------------- pulling (viewers + host hearing guests)
  const [host, setHost] = useState<Pulled>({ tracks: new Map(), state: "idle", puller: null });
  const [guests, setGuests] = useState<Map<string, Pulled>>(new Map());
  const [retry, setRetry] = useState(0);
  const hostKey = want && live!.source === "sfu" && live!.sfu ? `${live!.sfu.session}|${live!.sfu.tracks.map((t) => t.name).join(",")}` : "";

  useEffect(() => {
    if (!hostKey || !live?.sfu) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHost({ tracks: new Map(), state: "idle", puller: null });
      return;
    }
    const sfu = live.sfu;
    const p = new Puller(code);
    const tracks = new Map<string, MediaStreamTrack>();
    let dead = false;
    let failT: ReturnType<typeof setTimeout> | null = null;
    const push = (state = p.state) => !dead && setHost({ tracks: new Map(tracks), state, puller: p });
    p.onTrack = (name, track) => {
      const role = sfu.tracks.find((t) => t.name === name)?.role;
      if (role) tracks.set(role, track);
      push();
    };
    p.onState = (s) => {
      push(s);
      if (failT) clearTimeout(failT);
      if (s === "failed") setTimeout(() => !dead && setRetry((r) => r + 1), 1500);
      if (s === "disconnected") failT = setTimeout(() => !dead && setRetry((r) => r + 1), 6000);
    };
    push("connecting");
    const names = sfu.tracks.map((t) => t.name);
    // tracks the host isn't sending yet (e.g. screen before sharing) can't be pulled: keep retrying those
    let adding = false;
    const topUp = setInterval(() => {
      if (dead || adding || !p.session) return;
      const miss = p.missing(names);
      if (!miss.length) return;
      adding = true;
      p.add(miss)
        .catch(() => {})
        .finally(() => (adding = false));
    }, 3000);
    p.pull(sfu.session, names).catch((err) => {
      console.warn("live pull failed", err);
      push("failed");
      setTimeout(() => !dead && setRetry((r) => r + 1), 3000);
    });
    (window as unknown as Record<string, unknown>).__liveHost = p;
    return () => {
      dead = true;
      clearInterval(topUp);
      if (failT) clearTimeout(failT);
      p.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostKey, retry, code]);

  const guestKey = on && (want || amHost) ? live!.stage.filter((g) => g.sfu && g.id !== meId).map((g) => `${g.id}:${g.sfu!.session}:${g.sfu!.track}`).join("|") : "";
  useEffect(() => {
    if (!guestKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGuests(new Map());
      return;
    }
    const list = guestKey.split("|").map((s) => s.split(":"));
    const pullers: Puller[] = [];
    const map = new Map<string, Pulled>();
    let dead = false;
    for (const [id, session, track] of list) {
      const p = new Puller(code);
      pullers.push(p);
      const entry: Pulled = { tracks: new Map(), state: "connecting", puller: p };
      map.set(id, entry);
      p.onTrack = (_n, t) => {
        entry.tracks.set("mic", t);
        if (!dead) setGuests(new Map(map));
      };
      p.onState = (s) => {
        entry.state = s;
        if (!dead) setGuests(new Map(map));
      };
      // a guest's mic can take a moment to produce packets: retry until subscribed
      const tryPull = (n: number) =>
        (n ? p.add([track]) : p.pull(session, [track]))
          .then((failed) => {
            if (failed.length && !dead && n < 20) setTimeout(() => tryPull(n + 1), 2000);
          })
          .catch(() => (entry.state = "failed"));
      tryPull(0);
    }
    setGuests(new Map(map));
    return () => {
      dead = true;
      pullers.forEach((p) => p.close());
    };
  }, [guestKey, code]);

  // ---------------------------------------------------------------- stage guest publishing
  const guestPub = useRef<{ pub: Publisher; mic: MediaStreamTrack } | null>(null);
  const [guestMic, setGuestMic] = useState(true);
  const [guestLive, setGuestLive] = useState(false);
  const stopGuest = useCallback(() => {
    guestPub.current?.pub.close();
    guestPub.current?.mic.stop();
    guestPub.current = null;
    setGuestLive(false);
  }, []);
  async function joinStage() {
    setStageAsk(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mic = s.getAudioTracks()[0];
      stopGuest();
      const pub = new Publisher(code, [{ role: "mic", kind: "audio" }]);
      const info = await pub.start();
      await pub.setTrack("mic", mic);
      guestPub.current = { pub, mic };
      setGuestLive(true);
      setGuestMic(true);
      net?.send({ t: "live", a: "guest", session: info.session, track: info.tracks[0].name });
      flash("Você está no palco: todo mundo te ouve.");
    } catch (e) {
      flash("Não consegui ligar o microfone: " + (e as Error).message);
    }
  }
  function leaveStage() {
    stopGuest();
    setStageAsk(false);
    net?.send({ t: "live", a: "leave-stage" });
  }
  // removed from the stage (or live ended) -> stop publishing
  useEffect(() => {
    if (!myGuest && guestPub.current) stopGuest();
    // reconnected while on stage: offer to republish
    if (myGuest && !myGuest.sfu && !guestPub.current) setStageAsk(true);
  }, [myGuest, stopGuest]);
  useEffect(() => () => stopGuest(), [stopGuest]);

  // ---------------------------------------------------------------- host media lifecycle
  useEffect(() => {
    hm.listen(rerender);
  }, [rerender, hm]);
  // announce our SFU session whenever we're the host and the server doesn't have it
  const pubSession = hm?.pub?.session || "";
  // Host duties (announce the SFU session, auto-start the recording) run from a dep-less effect plus a 2s
  // watchdog: the publisher mutates hm in place, so dependency-based effects could miss the moment the
  // session/tracks appear and leave viewers without video and the live unrecorded.
  const duty = useRef<() => void>(() => {});
  const sfuSent = useRef({ sig: "", at: 0 });
  duty.current = () => {
    const pub = hm?.pub;
    const session = pub?.session || "";
    if (!amHost || !on || !session || !pub?.tracks?.length) return;
    if (live?.sfu?.session !== session) {
      const sig = session + "|" + pub.tracks.length;
      const now = Date.now();
      if (sfuSent.current.sig !== sig || now - sfuSent.current.at > 4000) {
        sfuSent.current = { sig, at: now };
        net?.send({ t: "live", a: "sfu", session, tracks: pub.tracks });
      }
    }
    if (liveId && hm.recWanted && !hm.rec.on && !hm.rec.starting && !hm.rec.error) {
      hm.rec.start(liveId, net?.room || "salao").catch(() => {});
    }
  };
  useEffect(() => {
    duty.current();
  });
  useEffect(() => {
    const t = setInterval(() => duty.current(), 2000);
    return () => clearInterval(t);
  }, []);
  // tell viewers which layout to render
  const effView = hm?.effectiveView();
  useEffect(() => {
    if (!amHost || !effView || live?.view === effView) return;
    net?.send({ t: "live", a: "view", view: effView });
  }, [amHost, effView, live?.view, net]);
  // live ended (by us or someone else) -> release devices
  const wasOn = useRef(false);
  useEffect(() => {
    if (wasOn.current && !on) hm?.stopAll();
    wasOn.current = on;
  }, [on, hm]);
  // SFU connection to the host failed -> republish on a fresh session
  const pubState = hm?.pub?.state;
  useEffect(() => {
    if (!amHost || pubState !== "failed" || !hm) return;
    const t = setTimeout(() => hm.publish().catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [amHost, pubState, hm]);
  useEffect(() => () => hm.stopAll(), [hm]);
  // recording: starts with the broadcast (and again after a reload, as a new part), unless the host switched it off
  // (recording auto-start lives in the host duty watchdog above)

  const viewers = Math.max(0, online - 1);

  // tracks for the stage screen (same layout rules as the window) + audio, both independent of the window
  const local = amHost ? hm : null;
  const view = local ? local.effectiveView() : live?.view;
  const camT = local ? local.cam : host.tracks.get("cam");
  const scrT = local ? local.screen : host.tracks.get("screen");
  const mainT = on ? (view === "camera" ? camT : scrT || camT) : null;
  const pipT = on && view === "pip" && scrT ? camT : null;
  const audios: MediaStreamTrack[] = [];
  if (on && !amHost) {
    for (const r of ["mic", "sys"]) {
      const t = host.tracks.get(r);
      if (t) audios.push(t);
    }
  }
  const guestAudio: MediaStreamTrack[] = [];
  if (on) for (const g of guests.values()) {
    const t = g.tracks.get("mic");
    if (t) audios.push(t), guestAudio.push(t);
  }
  // stage guests go into the recording's audio mix too
  const guestAudioKey = amHost ? guestAudio.map((t) => t.id).join(",") : "";
  useEffect(() => {
    hm.rec.guestAudio = guestAudioKey ? guestAudio : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestAudioKey, hm]);
  const volume = inZone || winOpen || amHost ? 1 : AWAY_VOLUME;
  const embed = on && live!.source === "embed" && !!live!.embed;
  const raised = on && !!meId && live!.handIds.includes(meId);
  useEffect(() => {
    // debug / automated checks
    Object.assign(globalThis, { __pmLive: { inZone, winOpen, want, sticky, sound, volume, screen: stageScreen } });
  }, [inZone, winOpen, want, sticky, sound, volume]);

  return (
    <>
      {isMod && (
        <button className={`pm-live-fab ${on ? "on" : ""}`} onClick={() => setPanel((p) => !p)} title="Painel da live">
          {on ? "🔴 Painel da live" : "🎬 Live"}
        </button>
      )}
      {on && <StageFeed main={mainT} pip={pipT} />}
      {audios.map((t) => (
        <AudioOut key={t.id} track={t} on={sound || amHost} volume={volume} />
      ))}
      {on && live && !winOpen && inZone && (
        <div className="pm-live-dock" role="region" aria-label="Plateia da live">
          <div className="pm-live-dock-floats" aria-hidden>
            {floats.map((f) => (
              <span key={f.id} style={{ left: `${f.x}%`, animationDelay: `${f.d}ms` }}>
                {REACTION_EMOJI.find(([k]) => k === f.k)?.[1]}
              </span>
            ))}
          </div>
          <span className="pm-live-dock-tag">
            <i className="pm-live-dot" /> AO VIVO · 👁 {viewers}
          </span>
          {!embed && !amHost &&
            (sound ? (
              <button className="pm-btn small ghost" onClick={() => setSound(false)} title="Silenciar a live">
                🔇
              </button>
            ) : (
              <button className="pm-btn small gold pm-live-dock-sound" onClick={() => setSound(true)}>
                🔊 Clique pra ouvir
              </button>
            ))}
          <span className="pm-live-rx">
            {REACTION_EMOJI.map(([k, e]) => (
              <button key={k} onClick={() => net?.send({ t: "react", e: k })} aria-label={`Reagir ${e}`}>
                {e}
              </button>
            ))}
          </span>
          {!myGuest && !amHost && (
            <button className={`pm-btn small ${raised ? "gold" : ""}`} onClick={() => net?.send({ t: "hand", on: !raised })} title={raised ? "Baixar a mão" : "Levantar a mão"}>
              ✋{raised ? " baixar" : ""}
            </button>
          )}
          <button className="pm-btn small ghost" onClick={() => setWinOpen(true)} title="Abrir a janela AO VIVO (maior)" aria-label="Abrir a janela AO VIVO">
            ⛶
          </button>
        </div>
      )}
      {on && live && !winOpen && !inZone && (
        <div className="pm-live-pill pm-live-away">
          <i className="pm-live-dot" />
          <b>AO VIVO no Palco</b> · 👁 {viewers}
          {sticky && sound && <em title="Saiu da plateia: o som continua mais baixo">🔉</em>}
          <button onClick={() => goLive?.()} title="Andar até a plateia e sentar">
            🚶 chegar perto
          </button>
          <button onClick={() => setWinOpen(true)} title="Abrir a janela AO VIVO">
            📺 assistir
          </button>
        </div>
      )}
      {on && live && winOpen && (
        <LiveWindow
          sound={sound}
          onSound={setSound}
          onClose={() => setWinOpen(false)}
          live={live}
          meId={meId}
          amHost={amHost}
          hostMedia={amHost ? hm : null}
          host={host}
          guests={guests}
          viewers={viewers}
          floats={floats}
          isMod={isMod}
          net={net}
          myGuest={!!myGuest}
          guestLive={guestLive}
          guestMic={guestMic}
          onGuestMic={(v) => {
            setGuestMic(v);
            if (guestPub.current) guestPub.current.mic.enabled = v;
          }}
          onLeaveStage={leaveStage}
        />
      )}
      {stageAsk && on && (
        <div className="pm-callcard pm-stage-ask">
          <b>🎤 O Mago te chamou pro palco!</b> Seu microfone vai pra todo mundo da live.
          <div>
            <button className="pm-btn small gold" onClick={joinStage}>
              Subir e ligar o mic
            </button>
            <button className="pm-btn small ghost" onClick={leaveStage}>
              Agora não
            </button>
          </div>
        </div>
      )}
      {isMod && panel && hm && (
        <HostPanel
          live={live}
          meId={meId}
          role={role}
          hm={hm}
          net={net}
          hands={hands}
          viewers={viewers}
          allMuted={allMuted}
          guests={guests}
          flash={flash}
          onClose={() => setPanel(false)}
        />
      )}
    </>
  );
}
