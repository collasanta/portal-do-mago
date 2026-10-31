import { canView, isAdmin } from "@/lib/portal/access";
import { cleanLink, createLink, deleteLink, listLinks, moveLink, updateLink } from "@/lib/portal/links";
import { sameOrigin } from "@/lib/oraculo/visitor";

const H = { "cache-control": "no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: H });

// ---- tiny in-memory rate limits (per server instance; the admin key is the real gate)
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return arr.length > max;
}
const ipOf = (req: Request) => req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "0.0.0.0";

/** Gate for writes: same origin, key attempts limited, admin key verified, writes limited. */
async function writeGate(req: Request): Promise<Response | null> {
  if (!sameOrigin(req)) return json(403, { error: "Origem inválida." });
  const ip = ipOf(req);
  if (limited("try:" + ip, 20, 60_000)) return json(429, { error: "Muitas tentativas. Espere um minuto." });
  if (!(await isAdmin(req))) return json(403, { error: "Só admin edita os links." });
  if (limited("write:" + ip, 40, 60_000)) return json(429, { error: "Muitas alterações seguidas. Espere um minuto." });
  return null;
}

/** GET: the list, plus `admin: true` when the x-portal-key header is a valid admin key. */
export async function GET(req: Request) {
  if (!(await canView(req))) return json(401, { error: "Só pra membros." });
  const key = req.headers.get("x-portal-key");
  let admin = false;
  if (key && !limited("try:" + ipOf(req), 20, 60_000)) admin = await isAdmin(req);
  return json(200, { links: await listLinks(), admin });
}

export async function POST(req: Request) {
  const g = await writeGate(req);
  if (g) return g;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const c = cleanLink(body);
  if ("error" in c) return json(400, { error: c.error });
  const id = await createLink(c.value, "admin");
  return json(200, { ok: true, id });
}

/** PATCH {id, ...fields} edits; PATCH {id, move: "up"|"down"} reorders inside the category. */
export async function PATCH(req: Request) {
  const g = await writeGate(req);
  if (g) return g;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: "id inválido." });
  if (body.move === "up" || body.move === "down") return json((await moveLink(id, body.move)) ? 200 : 404, { ok: true });
  const c = cleanLink(body);
  if ("error" in c) return json(400, { error: c.error });
  return json((await updateLink(id, c.value)) ? 200 : 404, { ok: true });
}

export async function DELETE(req: Request) {
  const g = await writeGate(req);
  if (g) return g;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: "id inválido." });
  return json((await deleteLink(id)) ? 200 : 404, { ok: true });
}
