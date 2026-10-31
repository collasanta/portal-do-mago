"use client";
// "AO VIVO · Palco das Lives": the viewer window (SFU video or embedded player), reactions, raise hand.
import { useEffect, useRef, useState } from "react";
import type { LiveState, Net } from "@/lib/portal/net";
import { REACTION_EMOJI, fmtDur, type HostMedia } from "@/lib/portal/live";
import type { Pulled } from "./LiveLayer";

export type Float = { k: string; id: string; x: number; d: number };
const EMO = Object.fromEntries(REACTION_EMOJI);

function useTrackVideo(track: MediaStreamTrack | null | undefined) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const cur = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (track && cur === track) return;
    v.srcObject = track ? new MediaStream([track]) : null;
    if (track) v.play().catch(() => {});
  }, [track]);
  return ref;
}

/** Hidden <audio> per remote audio track; muted until the viewer clicks (autoplay rules). */
export function AudioOut({ track, on, volume = 1 }: { track: MediaStreamTrack; on: boolean; volume?: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current!;
    a.srcObject = new MediaStream([track]);
    a.play().catch(() => {});
  }, [track]);
  useEffect(() => {
    const a = ref.current!;
    a.muted = !on;
    if (on) a.play().catch(() => {});
  }, [on]);
  useEffect(() => {
    ref.current!.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);
  return <audio ref={ref} autoPlay playsInline muted data-live-audio="" />;
}

/** Video element that reports whether frames are actually arriving. */
function useHasFrames(ref: React.RefObject<HTMLVideoElement | null>, dep: unknown) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setOk(!!ref.current && ref.current.videoWidth > 0 && !!ref.current.srcObject), 700);
    return () => clearInterval(t);
  }, [ref, dep]);
  return ok;
}

export function LiveWindow(props: {
  live: LiveState;
  meId: string | null;
  amHost: boolean;
  hostMedia: HostMedia | null;
  host: Pulled;
  guests: Map<string, Pulled>;
  viewers: number;
  floats: Float[];
  isMod: boolean;
  net: Net | null;
  myGuest: boolean;
  guestLive: boolean;
  guestMic: boolean;
  onGuestMic: (on: boolean) => void;
  onLeaveStage: () => void;
  /** audio is played by LiveLayer (it keeps going with the window closed) */
  sound: boolean;
  onSound: (on: boolean) => void;
  onClose: () => void;
}) {
  const { live, meId, amHost, hostMedia, host, guests, viewers, floats, net, sound } = props;
  const setSound = props.onSound;
  const [now, setNow] = useState(() => Date.now());
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // which tracks go where
  const local = amHost && hostMedia;
  const view = local ? hostMedia!.effectiveView() : live.view;
  const camT = local ? hostMedia!.cam : host.tracks.get("cam");
  const scrT = local ? hostMedia!.screen : host.tracks.get("screen");
  const mainT = view === "camera" ? camT : scrT || camT;
  const pipT = view === "pip" && scrT ? camT : null;
  const mainRef = useTrackVideo(mainT);
  const pipRef = useTrackVideo(pipT);
  const hasFrames = useHasFrames(mainRef, mainT);
  const embed = live.source === "embed" && live.embed;

  void guests;

  const raised = !!meId && live.handIds.includes(meId);
  const dur = fmtDur(now - live.startedAt);

  function fullscreen() {
    const el = boxRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const v = mainRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else v?.webkitEnterFullscreen?.();
  }

  function drag(e: React.PointerEvent) {
    if (window.innerWidth < 760 || (e.target as HTMLElement).closest("button")) return;
    const w = winRef.current!;
    const r = w.getBoundingClientRect();
    const parent = w.offsetParent!.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev: PointerEvent) =>
      setPos({
        x: Math.max(0, Math.min(parent.width - 80, ev.clientX - parent.left - ox)),
        y: Math.max(0, Math.min(parent.height - 40, ev.clientY - parent.top - oy)),
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const status = embed
    ? ""
    : amHost
      ? hostMedia?.pub
        ? ""
        : "Você ainda não está transmitindo: abre o Painel da live."
      : !live.sfu
        ? "O Mago tá ligando a câmera… já começa!"
        : host.state === "failed"
          ? "Reconectando ao palco…"
          : !hasFrames
            ? view === "camera" || !scrT
              ? "Conectando ao vídeo…"
              : "Conectando ao vídeo…"
            : "";

  return (
    <div
      ref={winRef}
      className="pm-win pm-live-win"
      role="dialog"
      aria-label="AO VIVO · Palco das Lives"
      style={pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pm-win-title" onPointerDown={drag}>
        <i className="pm-live-dot" />
        <span className="pm-win-name">AO VIVO · Palco das Lives</span>
        <button className="pm-win-b" onClick={fullscreen} aria-label="Tela cheia" title="Tela cheia">
          ⛶
        </button>
        <button className="pm-win-b" onClick={props.onClose} aria-label="Minimizar" title="Minimizar">
          _
        </button>
        <button className="pm-win-x" onClick={props.onClose} aria-label="Fechar">
          ×
        </button>
      </div>
      <div className="pm-live-box" ref={boxRef}>
        {embed ? (
          <iframe
            src={live.embed}
            title="Live do Mago"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            data-live-embed=""
          />
        ) : (
          <>
            <video ref={mainRef} className="pm-live-main" autoPlay playsInline muted data-live-main="" />
            {pipT && <video ref={pipRef} className="pm-live-pip" autoPlay playsInline muted />}
          </>
        )}
        {status && <div className="pm-live-wait">{status}</div>}
        <div className="pm-live-hud">
          <span className="pm-live-tag">
            <i className="pm-live-dot" /> AO VIVO {dur}
          </span>
          <span className="pm-live-tag dark">👁 {viewers}</span>
        </div>
        {live.pin && <div className="pm-live-pin">📌 {live.pin}</div>}
        {!embed && !amHost && !sound && (
          <button className="pm-live-sound" onClick={() => setSound(true)}>
            🔊 Clique pra ouvir
          </button>
        )}
        <div className="pm-live-floats" aria-hidden>
          {floats.map((f) => (
            <span key={f.id} style={{ left: `${f.x}%`, animationDelay: `${f.d}ms` }}>
              {EMO[f.k]}
            </span>
          ))}
        </div>
      </div>
      <div className="pm-live-bar">
        <div className="pm-live-rx">
          {REACTION_EMOJI.map(([k, e]) => (
            <button key={k} onClick={() => net?.send({ t: "react", e: k })} aria-label={`Reagir ${e}`}>
              {e}
            </button>
          ))}
        </div>
        {props.myGuest ? (
          <span className="pm-live-guest">
            🎤 No palco
            {props.guestLive && (
              <button className={`pm-btn small ${props.guestMic ? "" : "ghost"}`} onClick={() => props.onGuestMic(!props.guestMic)}>
                {props.guestMic ? "Mic on" : "Mic off"}
              </button>
            )}
            <button className="pm-btn small ghost" onClick={props.onLeaveStage}>
              Sair do palco
            </button>
          </span>
        ) : (
          !amHost && (
            <button className={`pm-btn small ${raised ? "gold" : ""}`} onClick={() => net?.send({ t: "hand", on: !raised })}>
              {raised ? "✋ Mão levantada (baixar)" : "✋ Levantar a mão"}
            </button>
          )
        )}
        {sound && !embed && !amHost && (
          <button className="pm-btn small ghost" onClick={() => setSound(false)} title="Silenciar a live">
            🔇
          </button>
        )}
      </div>
      {live.stage.length > 0 && (
        <div className="pm-live-stage">
          Palco: <b>{live.hostName}</b>
          {live.stage.map((g) => (
            <span key={g.id}>
              {" "}
              · {g.name}
              {g.sfu ? " 🎤" : " (entrando…)"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
