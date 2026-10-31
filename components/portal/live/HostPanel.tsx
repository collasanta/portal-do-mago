"use client";
// Host / admin control panel for lives: start/end, sources, devices, quality, stats, hands, stage, mute all, pin.
import { useEffect, useState } from "react";
import type { Hand, LiveState, Net, Role } from "@/lib/portal/net";
import { QUALITY, fmtDur, toEmbed, type HostMedia, type Quality, type View } from "@/lib/portal/live";
import type { Pulled } from "./LiveLayer";

type Stats = Awaited<ReturnType<NonNullable<HostMedia["pub"]>["stats"]>>;

export function HostPanel(props: {
  live: LiveState | null;
  meId: string | null;
  role: Role;
  hm: HostMedia;
  net: Net | null;
  hands: Hand[];
  viewers: number;
  allMuted: boolean;
  guests: Map<string, Pulled>;
  flash: (m: string) => void;
  onClose: () => void;
}) {
  const { live, meId, hm, net, hands, viewers, allMuted, flash } = props;
  const on = !!live?.on;
  const amHost = on && live!.hostId === meId;
  const [busy, setBusy] = useState(false);
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [link, setLink] = useState(live?.embed || "");
  const [pin, setPin] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [min, setMin] = useState(false);
  const send = (m: Record<string, unknown>) => net?.send({ t: "live", ...m });

  useEffect(() => {
    const t = setInterval(async () => {
      setNow(Date.now());
      if (hm.pub) setStats(await hm.pub.stats());
    }, 2000);
    return () => clearInterval(t);
  }, [hm]);

  async function loadDevices() {
    try {
      setDevs(await navigator.mediaDevices.enumerateDevices());
    } catch {}
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices);
  }, []);

  /** Capture camera + mic and push them to the SFU (also used to resume after a reload / takeover). */
  async function goLive() {
    setBusy(true);
    try {
      if (!hm.mic) await hm.startMic();
      if (!hm.cam) await hm.startCamera();
      if (!hm.mic && !hm.cam && !hm.screen) {
        flash("Sem câmera e sem microfone. Dá pra transmitir de um link (abaixo).");
      }
      await hm.publish();
      await loadDevices();
    } catch (e) {
      flash("Falha ao conectar no servidor de vídeo: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    send({ a: "start" });
    await goLive();
  }
  function end() {
    if (!confirm("Encerrar a live pra todo mundo?")) return;
    // close the recording first (last fragments keep uploading in the background), then end for everyone
    if (hm.rec.on) hm.rec.stop(true).catch(() => {});
    send({ a: "end" });
    hm.stopAll();
  }
  async function setView(v: View) {
    if (v !== "camera" && !hm.screen) {
      hm.setView(v);
      await hm.startScreen();
    } else {
      hm.setView(v);
      if (v !== "camera" && !hm.cam && v === "pip") await hm.startCamera();
      await hm.apply();
    }
  }

  const cams = devs.filter((d) => d.kind === "videoinput");
  const mics = devs.filter((d) => d.kind === "audioinput");
  const v = stats.cam?.sending ? stats.cam : undefined;
  const sv = stats.screen?.sending ? stats.screen : undefined;
  const au = stats.mic;
  const publishing = !!hm.pub && hm.pub.state === "connected" && !!(v || sv || au?.sending);
  const statusTxt = !hm.pub
    ? "Não está transmitindo"
    : hm.pub.state !== "connected"
      ? `Conectando ao Cloudflare (${hm.pub.state})…`
      : publishing
        ? "Transmitindo"
        : "Conectado, mas sem enviar mídia";
  const loss = Math.max(stats.cam?.lost || 0, stats.screen?.lost || 0, stats.mic?.lost || 0);

  return (
    <div className={`pm-win pm-host-win ${min ? "min" : ""}`} role="dialog" aria-label="Painel da live" onClick={(e) => e.stopPropagation()}>
      <div className="pm-win-title">
        <span className="pm-win-name">
          🎬 Painel da live {on ? `· ${fmtDur(now - live!.startedAt)}` : ""}
          {hm.rec.on && <span className="pm-rec-tag"> ● Gravando</span>}
        </span>
        <button className="pm-win-b" onClick={() => setMin((m) => !m)} aria-label="Minimizar">
          _
        </button>
        <button className="pm-win-x" onClick={props.onClose} aria-label="Fechar">
          ×
        </button>
      </div>
      {!min && (
        <div className="pm-win-body pm-host-body">
          {/* ------------------------------------------------ start / end */}
          {!on ? (
            <div className="pm-host-row">
              <button className="pm-btn gold" disabled={busy} onClick={start}>
                🔴 Iniciar live
              </button>
              <span className="pm-fine">Todo mundo vê a janela AO VIVO e a voz por proximidade fecha.</span>
            </div>
          ) : (
            <div className="pm-host-row">
              <span className="pm-live-tag">
                <i className="pm-live-dot" /> AO VIVO {fmtDur(now - live!.startedAt)}
              </span>
              <span className="pm-live-tag dark">👁 {viewers}</span>
              <button className="pm-btn small" style={{ background: "#c62828" }} onClick={end}>
                Encerrar live
              </button>
            </div>
          )}

          {on && !amHost && (
            <div className="pm-host-box">
              Quem transmite agora: <b>{live!.hostName}</b>.{" "}
              <button className="pm-btn small ghost" onClick={() => send({ a: "takeover" })}>
                Assumir transmissão
              </button>
            </div>
          )}

          {/* ------------------------------------------------ media (host) */}
          {amHost && (
            <>
              <div className={`pm-host-status ${publishing ? "ok" : hm.pub ? "warn" : "bad"}`}>
                <b>{publishing ? "●" : "○"} {statusTxt}</b>
                {hm.pub && (
                  <span>
                    {v && `câmera ${v.kbps} kbps ${v.w}×${v.h} ${Math.round(v.fps || 0)}fps · `}
                    {sv && `tela ${sv.kbps} kbps ${sv.w}×${sv.h} ${Math.round(sv.fps || 0)}fps · `}
                    {au && `mic ${au.kbps} kbps`}
                    {stats.sys?.sending ? ` · áudio da tela ${stats.sys.kbps} kbps` : ""}
                    {` · perda ${loss}%`}
                  </span>
                )}
                {!hm.pub && (
                  <button className="pm-btn small gold" disabled={busy} onClick={goLive}>
                    {busy ? "Conectando…" : "Ligar câmera e transmitir"}
                  </button>
                )}
                {hm.error && <span className="pm-err">{hm.error}</span>}
              </div>

              <div className={`pm-host-rec ${hm.rec.on ? "on" : ""}`}>
                <b>{hm.rec.on ? `● Gravando ${fmtDur(hm.rec.elapsed())}` : "○ Gravação desligada"}</b>
                {hm.rec.on && (
                  <span className="pm-fine">
                    {(hm.rec.bytes / 1e6).toFixed(1)} MB enviados{hm.rec.queue > 2 ? ` · ${hm.rec.queue} na fila` : ""}
                    {hm.rec.hidden ? " · sala de ensaio: fica oculta em Lives anteriores" : ""}
                  </span>
                )}
                {hm.rec.error && <span className="pm-err">{hm.rec.error}</span>}
                {hm.pub && (
                  <button
                    className="pm-btn small ghost"
                    onClick={() => hm.setRecording(!hm.rec.on, live!.id, net?.room || "salao")}
                  >
                    {hm.rec.on ? "Parar gravação" : "Gravar"}
                  </button>
                )}
              </div>

              <div className="pm-host-seg" role="group" aria-label="O que transmitir">
                {(
                  [
                    ["camera", "📷 Câmera"],
                    ["screen", "🖥️ Tela"],
                    ["pip", "🖥️+📷 Tela + câmera"],
                  ] as [View, string][]
                ).map(([k, l]) => (
                  <button key={k} className={hm.effectiveView() === k ? "sel" : ""} onClick={() => setView(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="pm-host-row">
                <button className={`pm-btn small ${hm.micOn ? "" : "ghost"}`} onClick={() => hm.setMicOn(!hm.micOn)}>
                  {hm.micOn ? "🎙️ Mic ligado" : "🔇 Mic mudo"}
                </button>
                {hm.screen ? (
                  <button className="pm-btn small ghost" onClick={() => hm.stopScreen()}>
                    Parar de compartilhar a tela
                  </button>
                ) : (
                  <button className="pm-btn small ghost" onClick={() => setView("pip")}>
                    Compartilhar tela
                  </button>
                )}
              </div>
              <label className="pm-host-field">
                Câmera
                <select value={hm.camId} onChange={(e) => hm.startCamera(e.target.value)}>
                  {!cams.length && <option value="">(nenhuma)</option>}
                  {cams.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Câmera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pm-host-field">
                Microfone
                <select value={hm.micId} onChange={(e) => hm.startMic(e.target.value)}>
                  {!mics.length && <option value="">(nenhum)</option>}
                  {mics.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microfone ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pm-host-field">
                Qualidade
                <select
                  value={hm.quality}
                  onChange={(e) => hm.setQuality(e.target.value as Quality)}
                >
                  {(Object.keys(QUALITY) as Quality[]).map((k) => (
                    <option key={k} value={k}>
                      {QUALITY[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="pm-fine">A prévia é a própria janela AO VIVO. Se compartilhar outra janela, pode deixar esta aba em segundo plano: a transmissão continua.</p>
            </>
          )}

          {/* ------------------------------------------------ link fallback */}
          {on && (
            <div className="pm-host-box">
              <b>Transmitir de um link</b>
              <span className="pm-fine">YouTube (não listado / ao vivo) ou qualquer player que aceite embed. Use se a câmera der problema.</span>
              <div className="pm-host-row">
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/…" aria-label="Link da transmissão" />
                <button
                  className="pm-btn small"
                  onClick={() => {
                    const u = toEmbed(link);
                    if (!u) return flash("Link inválido: precisa começar com https://");
                    send({ a: "embed", url: u });
                  }}
                >
                  Transmitir link
                </button>
              </div>
              {live!.source === "embed" && (
                <div className="pm-host-row">
                  <span className="pm-fine">Agora: link ({live!.embed.slice(0, 48)}…)</span>
                  <button className="pm-btn small ghost" onClick={() => send({ a: "source", source: "sfu" })}>
                    Voltar pra câmera/tela
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------ hands + stage */}
          {on && (
            <div className="pm-host-box">
              <b>
                ✋ Mãos levantadas ({hands.length}) · Palco {live!.stage.length}/3
              </b>
              {live!.stage.map((g) => {
                const p = props.guests.get(g.id);
                return (
                  <div key={g.id} className="pm-host-person">
                    <span>
                      🎤 {g.name} <small>{g.sfu ? (p?.state === "connected" ? "no ar" : p?.state || "…") : "aceitando…"}</small>
                    </span>
                    <button className="pm-btn small ghost" onClick={() => send({ a: "stage", target: g.id, on: false })}>
                      Tirar do palco
                    </button>
                  </div>
                );
              })}
              {hands.slice(0, 50).map((h) => (
                <div key={h.uid} className="pm-host-person">
                  <span>✋ {h.name}</span>
                  <span>
                    <button className="pm-btn small gold" onClick={() => send({ a: "stage", target: h.id, on: true })}>
                      Chamar pro palco
                    </button>
                    <button className="pm-btn small ghost" onClick={() => send({ a: "hand-drop", target: h.id })} aria-label="Baixar mão">
                      ×
                    </button>
                  </span>
                </div>
              ))}
              {hands.length > 50 && <span className="pm-fine">+{hands.length - 50} na fila</span>}
              {hands.length > 0 && (
                <button className="pm-btn small ghost" onClick={() => send({ a: "hands-clear" })}>
                  Baixar todas as mãos
                </button>
              )}
            </div>
          )}

          {/* ------------------------------------------------ moderation */}
          <div className="pm-host-box">
            <b>Aviso fixado {live?.pin ? "(ativo)" : ""}</b>
            <div className="pm-host-row">
              <input value={pin} onChange={(e) => setPin(e.target.value)} maxLength={240} placeholder={live?.pin || "Ex.: link do material no grupo"} aria-label="Aviso fixado" />
              <button className="pm-btn small" onClick={() => (send({ a: "pin", text: pin }), setPin(""))}>
                Fixar
              </button>
              {live?.pin && (
                <button className="pm-btn small ghost" onClick={() => send({ a: "pin", text: "" })}>
                  Remover
                </button>
              )}
            </div>
            <span className="pm-fine">No chat, /aviso texto posta como Corvo Mensageiro.</span>
          </div>
          <div className="pm-host-row">
            <button className="pm-btn small ghost" onClick={() => send({ a: allMuted ? "unmuteall" : "muteall" })}>
              {allMuted ? "🔊 Desmutar todos" : "🔇 Mutar todos"}
            </button>
            <span className="pm-fine">{on ? "Na live todo mundo já fica mudo (só o palco fala)." : allMuted ? "Microfones do salão fechados." : "Fecha a voz por proximidade de todos (menos moderação)."}</span>
          </div>
        </div>
      )}
    </div>
  );
}
