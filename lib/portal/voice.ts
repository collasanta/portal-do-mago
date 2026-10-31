/* eslint-disable @typescript-eslint/no-explicit-any */
// Proximity voice: WebRTC mesh between nearby avatars, signalled through the room Durable Object.
import { REALTIME_URL } from "./net";
import { MAX_PEERS, VOICE_RADIUS } from "./map";

type Peer = {
  id: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser?: AnalyserNode;
  level: number;
  makingOffer: boolean;
  polite: boolean;
  state: string;
};

export type VoiceUser = { id: string; x: number; y: number; mic: boolean };

export class Voice {
  peers = new Map<string, Peer>();
  local: MediaStream | null = null;
  micOn = false;
  /** Live mode / mute-all: proximity voice closed (the server also drops the signalling). */
  locked = false;
  localLevel = 0;
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private ice: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  turn = false;
  onChange: () => void = () => {};
  log: string[] = [];

  constructor(private myId: () => string | null, private signal: (to: string, d: unknown) => void) {
    fetch(`${REALTIME_URL}/ice`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.iceServers) && d.iceServers.length) this.ice = d.iceServers;
        this.turn = !!d.turn;
      })
      .catch(() => {});
  }

  private audioCtx() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Must be called from a user gesture. */
  async enableMic(): Promise<boolean> {
    if (this.locked) return false;
    try {
      this.audioCtx();
      if (!this.local) {
        this.local = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const src = this.audioCtx().createMediaStreamSource(this.local);
        this.localAnalyser = this.audioCtx().createAnalyser();
        this.localAnalyser.fftSize = 512;
        src.connect(this.localAnalyser);
      }
      this.local.getAudioTracks().forEach((t) => (t.enabled = true));
      this.micOn = true;
      for (const p of this.peers.values()) this.attachLocal(p);
      this.onChange();
      return true;
    } catch (e) {
      this.log.push("mic error: " + (e as Error).message);
      this.micOn = false;
      this.onChange();
      return false;
    }
  }

  disableMic() {
    this.micOn = false;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = false));
    this.onChange();
  }

  /** Unlock audio playback after any user gesture (autoplay policies). */
  unlock() {
    this.audioCtx();
    for (const p of this.peers.values()) p.audio.play().catch(() => {});
  }

  private attachLocal(p: Peer) {
    const track = this.local?.getAudioTracks()[0] || null;
    const tr = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === "audio" || t.mid !== null) || p.pc.getTransceivers()[0];
    if (!tr) return;
    if (tr.direction !== "sendrecv") tr.direction = "sendrecv";
    tr.sender.replaceTrack(track).catch(() => {});
  }

  private createPeer(id: string): Peer {
    const me = this.myId() || "";
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const audio = new Audio();
    audio.autoplay = true;
    (audio as any).playsInline = true;
    const p: Peer = { id, pc, audio, level: 0, makingOffer: false, polite: me > id, state: "new" };
    pc.onicecandidate = (e) => e.candidate && this.signal(id, { c: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {});
      try {
        const src = this.audioCtx().createMediaStreamSource(stream);
        p.analyser = this.audioCtx().createAnalyser();
        p.analyser.fftSize = 512;
        src.connect(p.analyser);
      } catch {}
    };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(id, { sdp: pc.localDescription });
      } catch {
      } finally {
        p.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (pc.connectionState === "failed") pc.restartIce();
      this.onChange();
    };
    this.peers.set(id, p);
    return p;
  }

  /** Initiator side: lower id adds the transceiver, which triggers negotiation. */
  private connect(id: string) {
    const p = this.createPeer(id);
    p.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.attachLocal(p);
    this.onChange();
  }

  close(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(id);
    this.onChange();
  }

  async onSignal(from: string, d: any) {
    if (this.locked && !d?.bye) return;
    let p = this.peers.get(from);
    if (!p) {
      if (!d.sdp || d.sdp.type !== "offer") return;
      if (this.peers.size >= MAX_PEERS + 2) {
        this.signal(from, { bye: 1 });
        return;
      }
      p = this.createPeer(from);
    }
    if (d.bye) return this.close(from);
    const pc = p.pc;
    try {
      if (d.sdp) {
        const collision = d.sdp.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
        if (collision && !p.polite) return;
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === "offer") {
          this.attachLocal(p);
          await pc.setLocalDescription();
          this.signal(from, { sdp: pc.localDescription });
        }
      } else if (d.c) {
        await pc.addIceCandidate(d.c).catch(() => {});
      }
    } catch (e) {
      this.log.push("signal error: " + (e as Error).message);
    }
  }

  /** Called ~every 500ms with everyone's position. Decides who to connect to and sets volumes. */
  update(me: VoiceUser, others: VoiceUser[]) {
    if (this.locked) {
      for (const id of [...this.peers.keys()]) this.close(id);
      return;
    }
    const ranked = others
      .map((u) => ({ u, d: Math.hypot(u.x - me.x, u.y - me.y) }))
      .filter((r) => r.d <= VOICE_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_PEERS);
    const want = new Set(ranked.filter((r) => r.u.mic || me.mic).map((r) => r.u.id));
    const dist = new Map(others.map((u) => [u.id, Math.hypot(u.x - me.x, u.y - me.y)]));

    for (const id of want) {
      if (!this.peers.has(id) && (this.myId() || "") < id) this.connect(id);
    }
    for (const [id, p] of this.peers) {
      const d = dist.get(id);
      // hysteresis: drop at radius + 1.5, or when neither side has a mic on
      const other = others.find((o) => o.id === id);
      if (d == null || d > VOICE_RADIUS + 1.5 || (other && !other.mic && !me.mic)) {
        this.signal(id, { bye: 1 });
        this.close(id);
        continue;
      }
      p.audio.volume = Math.max(0, Math.min(1, 1 - (d - 1) / (VOICE_RADIUS + 0.5)));
    }
  }

  /** Returns 0..1 speaking level for a peer id (or "me"). */
  levels() {
    const buf = new Uint8Array(256);
    const lvl = (a?: AnalyserNode | null) => {
      if (!a) return 0;
      a.getByteTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        s += v * v;
      }
      return Math.sqrt(s / buf.length);
    };
    this.localLevel = this.micOn ? lvl(this.localAnalyser) : 0;
    for (const p of this.peers.values()) p.level = lvl(p.analyser);
  }

  setLocked(on: boolean) {
    this.locked = on;
    if (on) {
      if (this.micOn) this.disableMic();
      for (const id of [...this.peers.keys()]) {
        this.signal(id, { bye: 1 });
        this.close(id);
      }
    }
  }

  destroy() {
    for (const id of [...this.peers.keys()]) this.close(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
  }
}
