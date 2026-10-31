// Lives anteriores: browser-side calls to the realtime worker (recordings live in R2 behind it).
// Viewing uses the room code (same gate as the live itself) to get a short-lived playback token;
// admin actions use the personal host/admin key the room saved in localStorage.
import { REALTIME_URL } from "@/lib/portal/net";

export type LiveRec = {
  id: string; room: string; title: string; startedAt: number; endedAt: number; hidden: boolean; status: string; kind: string;
  duration: number; bytes: number; parts: number;
  transcript: { status: string; segments: number; done: number; errors: number };
  ingest: { status: string; error: string; lesson: number | null };
  partsInfo?: { part: number; offset: number; duration: number; kind: string }[];
};

function ls(k: string) {
  try {
    const v = localStorage.getItem(k);
    const s = v ? (JSON.parse(v) as string) : "";
    return s && s !== "off" ? s : "";
  } catch {
    return "";
  }
}
export const adminKey = () => ls("pdm.admin");
export const roomCode = () => ls("pdm.code");
export function saveRoomCode(c: string) {
  try {
    localStorage.setItem("pdm.code", JSON.stringify(c.trim()));
  } catch {}
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const k = adminKey();
  if (k) h["x-portal-key"] = k;
  const c = roomCode();
  if (c) h["x-room-code"] = c;
  return h;
}

export async function listLives(all: boolean): Promise<LiveRec[]> {
  const r = await fetch(`${REALTIME_URL}/lives/list${all ? "?all=1" : ""}`, { headers: headers(), cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { lives: LiveRec[] }).lives;
}

export async function getLive(id: string): Promise<LiveRec | null> {
  const r = await fetch(`${REALTIME_URL}/lives/${encodeURIComponent(id)}/meta`, { headers: headers(), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Active-member token from the site (Kiwify login), or null. */
async function memberToken(): Promise<string | null> {
  const r = await fetch("/api/portal/token", { method: "POST" }).catch(() => null);
  if (!r?.ok) return null;
  return ((await r.json().catch(() => ({}))) as { token?: string }).token || null;
}

/**
 * Playback token (8 h): room code, else the member token. Throws "code" when neither is accepted.
 * cred: what the room was entered with (room code or member token), tried when the saved ones are not accepted.
 */
export async function playToken(id: string, cred?: string): Promise<string> {
  const url = `${REALTIME_URL}/lives/${encodeURIComponent(id)}/token`;
  let r = await fetch(url, { method: "POST", headers: headers() });
  if (r.status === 403 && cred) r = await fetch(url, { method: "POST", headers: { ...headers(), "x-room-code": cred } });
  if (r.status === 403) {
    const mt = await memberToken();
    if (mt) r = await fetch(url, { method: "POST", headers: { ...headers(), "x-room-code": mt } });
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error("code");
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d.tok as string;
}

export function mediaUrl(id: string, path: string, tok: string) {
  return `${REALTIME_URL}/lives/${encodeURIComponent(id)}/${path}?tok=${encodeURIComponent(tok)}`;
}

export async function adminAction(id: string, action: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`${REALTIME_URL}/lives/${encodeURIComponent(id)}/admin`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ action, ...extra }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d as { ok: true; live?: LiveRec; deleted?: boolean };
}

export function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(r).padStart(2, "0")}`;
}
export function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
}
