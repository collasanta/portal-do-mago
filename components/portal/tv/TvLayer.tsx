"use client";
// Sala de TV: past lives (the recordings at /lives) on the wall TV of the room. Each person watches their own pick:
// one <video> (HLS) lives in the window and also feeds the TV on the wall (lib/portal/stage-screen.ts, one buffer at
// ~15 fps). Closing the window keeps it playing on the TV; walking out of the room keeps it quieter, like the stage live.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Net, ServerEvent } from "@/lib/portal/net";
import { inLiveZone, inTvZone } from "@/lib/portal/map";
import { adminKey, fmtClock, fmtDate, listLives, mediaUrl, playToken, type LiveRec } from "@/lib/lives/api";
import { attachHls } from "@/lib/lives/hls";
import { setTvVideo, tvScreen } from "@/lib/portal/stage-screen";
import { HWin, PX, PixelIcon } from "../bits";
import "./tv.css";

/** Volume when you walk out of the Sala de TV with the window closed (keeps playing, quieter), same as the stage live. */
const AWAY_VOLUME = 0.3;

type Props = {
  net: Net | null;
  /** what the room was entered with (room code / member token / admin key): playback token fallback */
  cred: string;
  flash: (m: string) => void;
  myPos: () => { x: number; y: number } | null;
};

const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function TvLayer({ net, cred, flash, myPos }: Props) {
  const vRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "player">("list");
  const [lives, setLives] = useState<LiveRec[] | null>(null);
  const [listErr, setListErr] = useState("");
  const [sel, setSel] = useState<LiveRec | null>(null);
  const [tok, setTok] = useState("");
  const [err, setErr] = useState("");
  const [paused, setPaused] = useState(true);
  const [inZone, setInZone] = useState(false);
  const [inLive, setInLive] = useState(false);
  const [liveOn, setLiveOn] = useState(false);

  // ---------------------------------------------------------------- is a live on air on the stage?
  useEffect(() => {
    if (!net) return;
    const handle = (e: ServerEvent) => {
      if (e.t === "welcome") setLiveOn(!!e.live?.on);
      else if (e.t === "live") setLiveOn(!!e.live?.on);
    };
    for (const k of ["welcome", "live"] as const) {
      const ev = net.last[k];
      if (ev) handle(ev);
    }
    return net.on(handle);
  }, [net]);

  // ---------------------------------------------------------------- where am I
  useEffect(() => {
    const tick = () => {
      const p = myPos();
      setInZone(!!p && inTvZone(p.x, p.y));
      setInLive(!!p && inLiveZone(p.x, p.y));
    };
    tick();
    const t = setInterval(tick, 400);
    return () => clearInterval(t);
  }, [myPos]);

  // ---------------------------------------------------------------- the list (newest first)
  const load = useCallback(async () => {
    const isAdm = !!adminKey();
    try {
      let l: LiveRec[];
      try {
        l = await listLives(isAdm);
      } catch {
        l = await listLives(false);
      }
      setLives([...l].sort((a, b) => b.startedAt - a.startedAt));
      setListErr("");
    } catch (e) {
      setListErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [open, load]);

  // clicking the TV / poster / VHS shelf (Room dispatches it) or walking into the room opens the list
  useEffect(() => {
    const o = () => {
      setOpen(true);
      setView((v) => (sel ? v : "list"));
    };
    window.addEventListener("pm-tv-open", o);
    return () => window.removeEventListener("pm-tv-open", o);
  }, [sel]);
  const wasIn = useRef(false);
  useEffect(() => {
    if (inZone && !wasIn.current && !sel) setOpen(true);
    wasIn.current = inZone;
  }, [inZone, sel]);

  // ---------------------------------------------------------------- playback
  async function pick(l: LiveRec) {
    setErr("");
    setView("player");
    if (sel?.id === l.id && tok) {
      vRef.current?.play().catch(() => {});
      return;
    }
    setSel(l);
    setTok("");
    if (l.kind !== "mp4") return setErr("Essa gravação é do formato antigo: abre no player de Lives.");
    try {
      setTok(await playToken(l.id, cred));
    } catch (e) {
      setErr((e as Error).message === "code" ? "Seu acesso não foi confirmado pra assistir essa live." : "Não deu pra abrir: " + (e as Error).message);
    }
  }
  useEffect(() => {
    const v = vRef.current;
    if (!v || !sel || !tok) return;
    v.crossOrigin = "anonymous"; // CORS-clean frames for the room canvas (the worker sends ACAO: *)
    const off = attachHls(v, mediaUrl(sel.id, "index.m3u8", tok), 0, setErr);
    v.play().catch(() => {});
    setTvVideo(v);
    return () => {
      setTvVideo(null);
      off();
    };
  }, [sel, tok]);
  useEffect(() => () => setTvVideo(null), []);
  function stop() {
    setSel(null);
    setTok("");
    setErr("");
    setView("list");
  }

  // a live started and you walked into the audience: the TV pauses so the two never talk over each other
  useEffect(() => {
    if (liveOn && inLive && vRef.current && !vRef.current.paused) {
      vRef.current.pause();
      flash("Tem live no Palco: pausei a Sala de TV.");
    }
  }, [liveOn, inLive, flash]);

  const volume = inZone || open ? 1 : AWAY_VOLUME;
  useEffect(() => {
    if (vRef.current) vRef.current.volume = volume;
  }, [volume, sel]);

  useEffect(() => {
    // debug / automated checks
    Object.assign(globalThis, { __pmTv: { open, view, inZone, volume, sel: sel?.id || null, paused, screen: tvScreen, video: vRef.current } });
  }, [open, view, inZone, volume, sel, paused]);

  const toggle = () => {
    const v = vRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const liveHint = liveOn && (
    <button className="pm-tv-onair" onClick={() => window.dispatchEvent(new Event("pm-live-open"))} title="Tem live agora no Palco">
      <i className="pm-live-dot" /> AO VIVO no Palco
    </button>
  );

  return (
    <>
      {!open && (inZone || sel) && (
        <div className="pm-tv-pill" role="region" aria-label="Sala de TV">
          <PixelIcon art={PX.tv} className="pm-mini" />
          <b>{sel ? sel.title : "Sala de TV"}</b>
          {sel && (
            <button className="pm-btn small ghost" onClick={toggle} aria-label={paused ? "Tocar" : "Pausar"}>
              {paused ? "▶" : "❚❚"}
            </button>
          )}
          <button className="pm-btn small gold" onClick={() => setOpen(true)}>
            {sel ? "abrir" : "📺 escolher live"}
          </button>
          {liveHint}
        </div>
      )}
      {(open || sel) && (
        <HWin
          className={`pm-tv-win ${open ? "" : "pm-tv-off"}`}
          title={view === "player" && sel ? "Sala de TV · " + sel.title : "Sala de TV · Lives anteriores"}
          icon={<PixelIcon art={PX.tv} />}
          onClose={() => setOpen(false)}
          bodyClass="pm-tv-body"
        >
          {liveHint && <div className="pm-tv-hint">{liveHint} pausa a TV quando for pra plateia.</div>}
          {sel && (
            <div className={`pm-tv-player ${view === "player" ? "" : "pm-tv-stash"}`}>
              <div className="pm-tv-box">
                <video
                  ref={vRef}
                  controls
                  playsInline
                  preload="metadata"
                  data-tv-video=""
                  onPlay={() => setPaused(false)}
                  onPause={() => setPaused(true)}
                  onEnded={() => setPaused(true)}
                />
              </div>
              <div className="pm-tv-meta">
                <span>
                  {[fmtDate(sel.startedAt), sel.duration ? fmtClock(sel.duration) : ""].filter(Boolean).join(" · ")} · passando na TV da sala
                </span>
                <span className="pm-tv-acts">
                  <button className="pm-btn small ghost" onClick={() => setView("list")}>
                    ☰ Lista
                  </button>
                  <button
                    className="pm-btn small ghost"
                    onClick={() => window.open(`/lives/${sel.id}?t=${Math.floor(vRef.current?.currentTime || 0)}`, "_blank", "noopener")}
                    title="Abrir no player de Lives, no mesmo minuto"
                  >
                    ↗ aba
                  </button>
                  <button className="pm-btn small ghost" onClick={stop} title="Desligar a TV">
                    ⏻ Desligar
                  </button>
                </span>
              </div>
              {err && <p className="pm-tv-err">{err}</p>}
            </div>
          )}
          {view === "list" && (
            <div className="pm-tv-list">
              {listErr && <p className="pm-tv-err">Não consegui carregar as lives ({listErr}).</p>}
              {lives === null && !listErr && <p className="pm-tv-muted">Carregando…</p>}
              {lives && !lives.length && <p className="pm-tv-muted">Nenhuma live gravada ainda. A próxima live do Palco aparece aqui.</p>}
              {lives?.map((l) => (
                <button key={l.id} className={`pm-tv-item ${sel?.id === l.id ? "on" : ""}`} data-id={l.id} onClick={() => pick(l)}>
                  <span className="pm-tv-thumb" style={{ "--h": hue(l.id) } as React.CSSProperties} aria-hidden>
                    <i>{sel?.id === l.id && !paused ? "❚❚" : "▶"}</i>
                    {l.duration > 0 && <em>{fmtClock(l.duration)}</em>}
                  </span>
                  <span className="pm-tv-info">
                    <b>{l.title}</b>
                    <small>
                      {[fmtDate(l.startedAt), l.status === "recording" ? "gravando agora" : "", l.hidden ? "oculta" : "", sel?.id === l.id ? "na TV" : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </HWin>
      )}
    </>
  );
}
