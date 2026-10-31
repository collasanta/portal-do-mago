import "server-only";
import { q } from "@/lib/oraculo/db";
import type { Excerpt } from "@/lib/oraculo/search";
import { liveLabel } from "./chunk";

/** Portal recordings ingested into the Oráculo (curso.portal_lives) cite /lives/<id>?t=s instead of Kiwify. */
export async function attachPortalLives(ex: Excerpt[]) {
  const ns = [...new Set(ex.map((e) => e.lesson).filter((n) => n >= 1001))];
  if (!ns.length) return ex;
  const rows = await q<{ lesson_n: number; live_id: string; started_at: Date }>(
    "select lesson_n, live_id, started_at from curso.portal_lives where lesson_n = any($1::int[])", [ns]).catch(() => []);
  const by = new Map(rows.map((r) => [r.lesson_n, r]));
  for (const e of ex) {
    const r = by.get(e.lesson);
    if (r) {
      e.liveId = r.live_id;
      e.label = liveLabel(new Date(r.started_at));
    }
  }
  return ex;
}

export const portalLiveUrl = (id: string, start: number) => `/lives/${encodeURIComponent(id)}?t=${Math.max(0, Math.floor(start))}`;
