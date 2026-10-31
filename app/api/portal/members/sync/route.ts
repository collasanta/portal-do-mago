import { q } from "@/lib/oraculo/db";
import { runKiwifySync } from "@/lib/portal/kiwify-sync.mjs";
import { json } from "@/lib/portal/ratelimit";
import { actorOf, staffGate } from "@/lib/portal/staff-gate";

export const maxDuration = 60;

/** POST {dry?}: "Sincronizar" — sales from the Kiwify public API. No-op with a message when the API keys are missing. */
export async function POST(req: Request) {
  const g = await staffGate(req, true);
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => ({}))) as { dry?: boolean };
  try {
    return json(200, await runKiwifySync({ env: process.env, query: q, dryRun: !!b.dry, actor: actorOf(g.v) }));
  } catch (e) {
    return json(502, { ok: false, message: e instanceof Error ? e.message : "Falha ao falar com a Kiwify." });
  }
}
