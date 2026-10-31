// HLS playback of a recorded live (fMP4 segments in R2 via the worker). Safari/iOS play it natively, other browsers
// through hls.js (loaded from the CDN on demand). Shared by the /lives/<id> player and the Sala de TV in the room.

const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
type HlsCtor = { new (cfg?: object): any; isSupported(): boolean; Events: Record<string, string> }; // eslint-disable-line @typescript-eslint/no-explicit-any
let hlsLoad: Promise<HlsCtor> | null = null;

export function loadHls(): Promise<HlsCtor> {
  const w = window as unknown as { Hls?: HlsCtor };
  if (w.Hls) return Promise.resolve(w.Hls);
  hlsLoad ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = HLS_JS;
    s.async = true;
    s.onload = () => (w.Hls ? res(w.Hls) : rej(new Error("hls.js")));
    s.onerror = () => {
      hlsLoad = null;
      rej(new Error("hls.js"));
    };
    document.head.appendChild(s);
  });
  return hlsLoad;
}

/**
 * Attach an HLS playlist to a <video>, starting at `start` seconds. Returns a cleanup that detaches it.
 * onErr gets a user-facing message when playback can't work at all.
 */
export function attachHls(v: HTMLVideoElement, src: string, start: number, onErr: (msg: string) => void): () => void {
  let hls: { destroy(): void } | null = null;
  let dead = false;
  const seek = () => {
    if (start > 0 && v.currentTime < 1) v.currentTime = start;
  };
  if (v.canPlayType("application/vnd.apple.mpegurl")) {
    v.src = src;
    v.addEventListener("loadedmetadata", seek, { once: true });
  } else {
    loadHls()
      .then((Hls) => {
        if (dead) return;
        if (!Hls.isSupported()) return onErr("Este navegador não toca o vídeo.");
        const h = new Hls({ startPosition: start || -1, maxBufferLength: 30 });
        hls = h;
        h.loadSource(src);
        h.attachMedia(v);
        h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean; type?: string }) => {
          if (d?.fatal) {
            if (d.type === "networkError") h.startLoad();
            else if (d.type === "mediaError") h.recoverMediaError();
            else onErr("Falha ao tocar o vídeo.");
          }
        });
      })
      .catch(() => onErr("Não consegui carregar o player."));
  }
  return () => {
    dead = true;
    hls?.destroy();
    v.removeAttribute("src");
    v.load();
  };
}
