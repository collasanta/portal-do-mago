// Load test: N simulated clients connect to the room DO, walk around and chat for S seconds.
// Usage: PORTAL_ROOM_CODE=... node realtime/loadtest.mjs --n 300 --secs 60 [--room salao] [--url https://...]
// Members-only rooms (teste, or salao in kiwify mode): add --mt 1 with PORTAL_MEMBER_TOKEN_SECRET in the env; every bot
// joins with its own member token (m1.…, 2 h, e-mail bot<i>@loadtest.invalid) signed locally, as /api/portal/token does.
// Live scenario: add --live 1 (needs PORTAL_ADMIN_KEY): client 0 joins as admin and starts a live after the ramp,
// the others react / raise hands / try to open their mic (must be forced off), and the live is ended at the end.
// DM scenario: add --dms 1: every bot sends a direct message to a random other bot every 8-15 s; checks the echo,
// delivery and that nobody receives a DM addressed to someone else.
// Seats scenario: add --sit 1: the first 80 bots race for the 50 Plateia seats (several per seat); checks that every
// seat is confirmed to at most one bot and that the losers get "sitno".
import WebSocket from "ws";
import crypto from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), []),
);
const N = Number(args.n || 300);
const SECS = Number(args.secs || 60);
const ROOM = args.room || "salao";
const BASE = (args.url || process.env.PORTAL_WS_URL || "http://localhost:8787").replace(/^http/, "ws");
const CODE = process.env.PORTAL_ROOM_CODE || "";
const RAMP_MS = Number(args.ramp || 15000);
const LIVE = args.live === "1" || args.live === "true";
const ADMIN_KEY = process.env.PORTAL_ADMIN_KEY || "";
const DMS = args.dms === "1" || args.dms === "true";
const SIT = args.sit === "1" || args.sit === "true";
const MT = args.mt === "1" || args.mt === "true";
const MT_SECRET = process.env.PORTAL_MEMBER_TOKEN_SECRET || process.env.MEMBER_TOKEN_SECRET || "";
/** Same format as lib/portal/authmode.ts signMemberToken: m1.<b64url(json)>.<b64url(HMAC-SHA256(secret, "m1."+body))> */
function memberToken(i) {
  const body = Buffer.from(JSON.stringify({ e: `bot${i}@loadtest.invalid`, n: `Bot ${i}`, x: Math.floor(Date.now() / 1000) + 2 * 3600 })).toString("base64url");
  return `m1.${body}.${crypto.createHmac("sha256", MT_SECRET).update("m1." + body).digest("base64url")}`;
}
// Plateia seats as built in lib/portal/map.ts (index = row * 10 + col): rows y 8..16, cols x 11-15 / 18-22
const PLATEIA = [8, 10, 12, 14, 16].flatMap((y) => [11, 12, 13, 14, 15, 18, 19, 20, 21, 22].map((x) => ({ x, y })));

const stats = {
  opened: 0, welcomed: 0, closedEarly: 0, errors: 0, denied: 0,
  connectMs: [], welcomeMs: [], moveRtt: [], chatRtt: [],
  framesIn: 0, bytesIn: 0, eventsIn: 0, movesSent: 0, chatsSent: 0, chatErrs: 0, maxUsersSeen: 0,
  // live scenario
  liveStartAt: 0, sawLiveOn: 0, liveOnMs: [], sawLiveOff: 0, rxSent: 0, rxTallies: 0, rxCounted: 0, handsSent: 0, maxHandsSeen: 0,
  micTries: 0, micForcedOff: 0, micLeaks: 0, adminRole: null, lateJoinSawLive: 0, lateJoins: 0,
  // dm scenario
  dmSent: 0, dmEcho: [], dmRecv: 0, dmLeaks: 0, dmErrs: {},
  // seats scenario
  sitTries: 0, sitOk: 0, sitNo: 0, seatOwners: new Map(), sitBroadcasts: 0,
};
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const PHRASES = ["salve galera", "alguém fazendo canal dark?", "bora live sexta", "o oráculo é brabo", "qual nicho tá bombando?", "acabei de postar vídeo novo", "suno ou mureka?", "primeira vez aqui 👋"];

let stopping = false;
const clients = [];
let hostClient = null;

function spawn(i, late = false) {
  const t0 = Date.now();
  const uid = `load-${process.pid}-${i}`;
  const ws = new WebSocket(`${BASE}/ws?room=${ROOM}&uid=${uid}`);
  const c = { ws, id: null, x: rnd(8, 20), y: rnd(10, 24), pendingMove: null, pendingChat: new Map(), timers: [], liveOn: false, admin: LIVE && i === 0, peers: new Set(), pendingDm: new Map() };
  clients.push(c);
  ws.on("open", () => {
    stats.opened++;
    stats.connectMs.push(Date.now() - t0);
    ws.send(JSON.stringify({ t: "join", name: c.admin ? "Bot Host" : `Bot ${i}`, look: { skin: i % 10, hair: i % 16, hairStyle: i % 5, shirt: i % 16, hat: i % 6 }, code: CODE, ...(MT && !c.admin ? { mt: memberToken(i) } : {}), uid, x: c.x, y: c.y, ...(c.admin ? { adminKey: ADMIN_KEY } : {}) }));
  });
  ws.on("message", (raw) => {
    stats.framesIn++;
    stats.bytesIn += raw.length;
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const evs = m.t === "b" ? m.e : [m];
    for (const e of evs) {
      stats.eventsIn++;
      if (e.t === "welcome") {
        stats.welcomed++;
        stats.welcomeMs.push(Date.now() - t0);
        c.id = e.me.id;
        stats.maxUsersSeen = Math.max(stats.maxUsersSeen, e.users.length + 1);
        if (c.admin) {
          stats.adminRole = e.role;
          hostClient = c;
        }
        if (e.live?.on) c.liveOn = true;
        if (late) {
          stats.lateJoins++;
          if (e.live?.on) stats.lateJoinSawLive++;
        }
        if (LIVE && !c.admin) {
          // during the live: react every 3-8 s, 1 in 5 raise a hand, everyone tries to open the mic once
          const react = () => {
            if (stopping) return;
            if (c.liveOn) {
              ws.send(JSON.stringify({ t: "react", e: ["heart", "fire", "clap", "laugh", "wow", "mago"][rnd(0, 5)] }));
              stats.rxSent++;
            }
            c.timers.push(setTimeout(react, rnd(3000, 8000)));
          };
          c.timers.push(setTimeout(react, rnd(1000, 8000)));
        }
        // walk every 2-4 s, chat every ~15-30 s
        const walk = () => {
          if (stopping || c.seated) return;
          if (SIT && i < 80 && c.walks >= 1) {
            // walk onto the seat, then claim it (the server only accepts a sit on the tile you are on)
            const s = c.wantSeat ?? (c.wantSeat = i % PLATEIA.length);
            const p = PLATEIA[s];
            if (c.x !== p.x || c.y !== p.y) {
              c.pendingMove = { at: Date.now(), tx: p.x, ty: p.y };
              ws.send(JSON.stringify({ t: "mv", x: c.x, y: c.y, tx: p.x, ty: p.y }));
              stats.movesSent++;
              c.x = p.x; c.y = p.y;
            }
            c.timers.push(setTimeout(() => { if (!stopping) { ws.send(JSON.stringify({ t: "sit", s })); stats.sitTries++; } }, 400));
            c.seated = true;
            return;
          }
          c.walks = (c.walks || 0) + 1;
          const tx = rnd(1, 34), ty = rnd(1, 36);
          c.pendingMove = { at: Date.now(), tx, ty };
          ws.send(JSON.stringify({ t: "mv", x: c.x, y: c.y, tx, ty }));
          stats.movesSent++;
          c.x = tx; c.y = ty;
          c.timers.push(setTimeout(walk, rnd(2000, 4000)));
        };
        const chat = () => {
          if (stopping) return;
          const cid = Math.random().toString(36).slice(2, 10);
          c.pendingChat.set(cid, Date.now());
          ws.send(JSON.stringify({ t: "chat", text: PHRASES[rnd(0, PHRASES.length - 1)], cid }));
          stats.chatsSent++;
          c.timers.push(setTimeout(chat, rnd(15000, 30000)));
        };
        c.timers.push(setTimeout(walk, rnd(200, 2000)));
        c.timers.push(setTimeout(chat, rnd(1000, 20000)));
        for (const u of e.users) c.peers.add(u.id);
        if (DMS) {
          const dm = () => {
            if (stopping) return;
            const ids = [...c.peers];
            if (ids.length) {
              const to = ids[rnd(0, ids.length - 1)];
              const cid = Math.random().toString(36).slice(2, 10);
              c.pendingDm.set(cid, Date.now());
              ws.send(JSON.stringify({ t: "dm", to, text: `dm para ${to} de ${c.id}`, cid }));
              stats.dmSent++;
            }
            c.timers.push(setTimeout(dm, rnd(8000, 15000)));
          };
          c.timers.push(setTimeout(dm, rnd(2000, 12000)));
        }
      } else if (e.t === "join") {
        if (e.u.id !== c.id) c.peers.add(e.u.id);
      } else if (e.t === "leave") {
        c.peers.delete(e.id);
      } else if (e.t === "dm") {
        if (e.m.mine && e.cid && c.pendingDm.has(e.cid)) {
          stats.dmEcho.push(Date.now() - c.pendingDm.get(e.cid));
          c.pendingDm.delete(e.cid);
        } else if (!e.m.mine) {
          stats.dmRecv++;
          if (!e.m.text.startsWith(`dm para ${c.id} `)) stats.dmLeaks++;
        }
      } else if (e.t === "sit" && e.id === c.id && e.s >= 0) {
        stats.sitOk++;
        if (!stats.seatOwners.has(e.s)) stats.seatOwners.set(e.s, new Set());
        stats.seatOwners.get(e.s).add(c.id);
      } else if (e.t === "sit") {
        stats.sitBroadcasts++;
      } else if (e.t === "sitno" && SIT) {
        stats.sitNo++;
      } else if (e.t === "dm_err") {
        stats.dmErrs[e.msg] = (stats.dmErrs[e.msg] || 0) + 1;
      } else if (e.t === "mv" && e.id === c.id && c.pendingMove && e.tx === c.pendingMove.tx && e.ty === c.pendingMove.ty) {
        stats.moveRtt.push(Date.now() - c.pendingMove.at);
        c.pendingMove = null;
      } else if (e.t === "chat" && e.cid && c.pendingChat.has(e.cid)) {
        stats.chatRtt.push(Date.now() - c.pendingChat.get(e.cid));
        c.pendingChat.delete(e.cid);
      } else if (e.t === "live") {
        if (e.live.on && !c.liveOn) {
          c.liveOn = true;
          stats.sawLiveOn++;
          if (stats.liveStartAt) stats.liveOnMs.push(Date.now() - stats.liveStartAt);
          if (!c.admin && i % 5 === 1) {
            ws.send(JSON.stringify({ t: "hand", on: true }));
            stats.handsSent++;
          }
          if (!c.admin) {
            ws.send(JSON.stringify({ t: "mic", on: true }));
            stats.micTries++;
          }
        } else if (!e.live.on && c.liveOn) {
          c.liveOn = false;
          stats.sawLiveOff++;
        }
        if (c.admin) stats.maxHandsSeen = Math.max(stats.maxHandsSeen, e.live.hands);
      } else if (e.t === "mic" && e.id === c.id && c.liveOn && !c.admin) {
        if (e.on) stats.micLeaks++;
        else stats.micForcedOff++;
      } else if (e.t === "rx" && c.admin) {
        stats.rxTallies++;
        stats.rxCounted += Object.values(e.c).reduce((a, b) => a + b, 0);
      } else if (e.t === "err") stats.chatErrs++;
      else if (e.t === "denied") stats.denied++;
    }
  });
  ws.on("error", () => stats.errors++);
  ws.on("close", () => {
    if (!stopping) stats.closedEarly++;
    c.timers.forEach(clearTimeout);
  });
}

console.log(`load test: ${N} clients -> ${BASE} room=${ROOM}, ramp ${RAMP_MS} ms, run ${SECS} s${MT ? ", member tokens" : ""}`);
if (MT && MT_SECRET.length < 32) {
  console.error("--mt needs PORTAL_MEMBER_TOKEN_SECRET (>= 32 chars) in the env");
  process.exit(1);
}
for (let i = 0; i < N; i++) setTimeout(() => spawn(i), (i / N) * RAMP_MS);
if (LIVE) {
  if (!ADMIN_KEY) console.warn("--live needs PORTAL_ADMIN_KEY");
  // start the live 3 s after the ramp; 10 late joiners arrive mid-live and must get the live state in "welcome"
  setTimeout(() => {
    stats.liveStartAt = Date.now();
    hostClient?.ws.send(JSON.stringify({ t: "live", a: "start" }));
    console.log(`  live started by ${hostClient ? "Bot Host" : "(no host!)"}`);
  }, RAMP_MS + 3000);
  setTimeout(() => {
    for (let k = 0; k < 10; k++) spawn(N + k, true);
  }, RAMP_MS + 3000 + (SECS * 1000) / 2);
  setTimeout(() => hostClient?.ws.send(JSON.stringify({ t: "live", a: "end" })), RAMP_MS + SECS * 1000 - 3000);
}

const tick = setInterval(() => {
  const open = clients.filter((c) => c.ws.readyState === WebSocket.OPEN).length;
  console.log(`  t+${Math.round((Date.now() - start) / 1000)}s open=${open} welcomed=${stats.welcomed} events=${stats.eventsIn} moveRtt.p50=${pct(stats.moveRtt, 50)}ms p95=${pct(stats.moveRtt, 95)}ms errors=${stats.errors} closedEarly=${stats.closedEarly}`);
}, 10000);
const start = Date.now();

setTimeout(() => {
  stopping = true;
  clearInterval(tick);
  const open = clients.filter((c) => c.ws.readyState === WebSocket.OPEN).length;
  for (const c of clients) { c.timers.forEach(clearTimeout); try { c.ws.close(1000); } catch {} }
  const secs = (Date.now() - start) / 1000;
  const out = {
    clients: N, room: ROOM, durationS: Math.round(secs), stillOpenAtEnd: open,
    opened: stats.opened, welcomed: stats.welcomed, denied: stats.denied, wsErrors: stats.errors, closedEarly: stats.closedEarly,
    maxUsersInWelcome: stats.maxUsersSeen,
    connectMs: { p50: pct(stats.connectMs, 50), p95: pct(stats.connectMs, 95), max: pct(stats.connectMs, 100) },
    welcomeMs: { p50: pct(stats.welcomeMs, 50), p95: pct(stats.welcomeMs, 95), max: pct(stats.welcomeMs, 100) },
    moveEchoMs: { n: stats.moveRtt.length, sent: stats.movesSent, p50: pct(stats.moveRtt, 50), p95: pct(stats.moveRtt, 95), p99: pct(stats.moveRtt, 99), max: pct(stats.moveRtt, 100) },
    chatEchoMs: { n: stats.chatRtt.length, sent: stats.chatsSent, p50: pct(stats.chatRtt, 50), p95: pct(stats.chatRtt, 95), max: pct(stats.chatRtt, 100) },
    serverErrMsgs: stats.chatErrs,
    framesInTotal: stats.framesIn, eventsInTotal: stats.eventsIn,
    ...(LIVE
      ? {
          live: {
            adminRole: stats.adminRole,
            clientsThatSawLiveOn: stats.sawLiveOn,
            liveOnBroadcastMs: { p50: pct(stats.liveOnMs, 50), p95: pct(stats.liveOnMs, 95), max: pct(stats.liveOnMs, 100) },
            clientsThatSawLiveOff: stats.sawLiveOff,
            lateJoins: stats.lateJoins, lateJoinSawLiveInWelcome: stats.lateJoinSawLive,
            reactionsSent: stats.rxSent, reactionTalliesToHost: stats.rxTallies, reactionsCountedByServer: stats.rxCounted,
            handsSent: stats.handsSent, maxHandsSeenByHost: stats.maxHandsSeen,
            micOpenAttempts: stats.micTries, micForcedOffEchoes: stats.micForcedOff, micLeaks: stats.micLeaks,
          },
        }
      : {}),
    ...(SIT
      ? {
          seats: {
            tries: stats.sitTries, confirmed: stats.sitOk, refused: stats.sitNo, seatsTaken: stats.seatOwners.size,
            seatsWithTwoOwners: [...stats.seatOwners.values()].filter((v) => v.size > 1).length,
            sitBroadcastsSeenByOthers: stats.sitBroadcasts,
          },
        }
      : {}),
    ...(DMS
      ? {
          dms: {
            sent: stats.dmSent, echoed: stats.dmEcho.length, delivered: stats.dmRecv, misdelivered: stats.dmLeaks,
            echoMs: { p50: pct(stats.dmEcho, 50), p95: pct(stats.dmEcho, 95), max: pct(stats.dmEcho, 100) },
            errors: stats.dmErrs,
          },
        }
      : {}),
    framesPerClientPerSec: +(stats.framesIn / N / secs).toFixed(1),
    kbPerClientPerSec: +(stats.bytesIn / 1024 / N / secs).toFixed(2),
  };
  console.log(JSON.stringify(out, null, 2));
  setTimeout(() => process.exit(0), 1500);
}, RAMP_MS + SECS * 1000);
