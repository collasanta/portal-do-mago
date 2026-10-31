"use client";
// Player of a recorded live: HLS (fMP4 segments in R2 via the worker). Safari/iOS play it natively, other browsers
// through hls.js (lib/lives/hls.ts). ?t=seconds jumps to that moment (Oráculo citations link here).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtClock, fmtDate, getLive, mediaUrl, playToken, saveRoomCode, type LiveRec } from "@/lib/lives/api";
import { attachHls } from "@/lib/lives/hls";

export default function LivePlayer({ id, t, embed }: { id: string; t: number; embed: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState<LiveRec | null | undefined>(undefined);
  const [tok, setTok] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const m = await getLive(id);
        if (dead) return;
        setLive(m);
        if (!m) return;
        // no early "need code" check: playToken falls back to the member token (e-mail login), and
        // throws "code" only when neither a room code nor an active membership is accepted
        const k = await playToken(id);
        if (!dead) (setTok(k), setNeedCode(false));
      } catch (e) {
        if (dead) return;
        if ((e as Error).message === "code") setNeedCode(true);
        else setErr((e as Error).message);
      }
    })();
    return () => {
      dead = true;
    };
  }, [id, attempt]);

  // attach the stream
  useEffect(() => {
    const v = ref.current;
    if (!v || !tok || !live || live.kind !== "mp4") return;
    return attachHls(v, mediaUrl(id, "index.m3u8", tok), t > 0 ? t : 0, setErr);
  }, [tok, live, id, t]);

  const q = embed ? "?embed=1" : "";
  return (
    <main className="orc-col orc-page lv-page">
      <Link href={`/lives${q}`} className="orc-btn orc-mb">
        ← Lives anteriores
      </Link>
      {live === undefined && !err && <p className="orc-muted orc-center">Carregando…</p>}
      {live === null && <p className="orc-muted orc-center">Essa live não existe (ou foi removida).</p>}
      {live && (
        <>
          <h1 className="orc-h1">{live.title}</h1>
          <p className="orc-muted orc-small orc-mb">
            {[fmtDate(live.startedAt), live.duration ? fmtClock(live.duration) : "", live.status === "recording" ? "gravando agora" : "", live.hidden ? "oculta" : ""]
              .filter(Boolean)
              .join(" · ")}
            {t > 0 ? ` · começando em ${fmtClock(t)}` : ""}
          </p>
          {needCode ? (
            <form
              className="orc-card lv-code"
              onSubmit={(e) => {
                e.preventDefault();
                if (!code.trim()) return;
                saveRoomCode(code);
                setAttempt((a) => a + 1);
              }}
            >
              <p>Pra assistir, entre na sala com o e-mail da compra, ou digite o código da sala (o mesmo do link do grupo).</p>
              <div className="lv-row">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código da sala" aria-label="Código da sala" autoFocus />
                <button className="orc-btn orc-btn-accent">Assistir</button>
              </div>
            </form>
          ) : live.kind === "mp4" ? (
            <div className="lv-video">
              <video ref={ref} controls playsInline preload="metadata" />
            </div>
          ) : (
            tok &&
            (live.partsInfo || []).map((p) => (
              <div key={p.part} className="lv-video">
                <video controls playsInline preload="metadata" src={mediaUrl(id, `v/${p.part}/full.webm`, tok)} />
              </div>
            ))
          )}
          {err && <p className="lv-err">{err}</p>}
        </>
      )}
    </main>
  );
}
