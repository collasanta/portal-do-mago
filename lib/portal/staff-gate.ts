import "server-only";
import { sameOrigin } from "@/lib/oraculo/visitor";
import { getViewer, type Viewer } from "./access";
import { ipOf, json, limited } from "./ratelimit";

/** Members admin API gate: admin or host (key header or pm_adm cookie); writes also need same origin. */
export async function staffGate(req: Request, write: boolean): Promise<{ v: Viewer } | { res: Response }> {
  if (write && !sameOrigin(req)) return { res: json(403, { error: "Origem inválida." }) };
  if (limited("staffapi:" + ipOf(req), 60, 60_000)) return { res: json(429, { error: "Muitas requisições. Espere um minuto." }) };
  const v = await getViewer(req);
  if (!v.staff) return { res: json(403, { error: "Só admin ou host." }) };
  return { v };
}
export const actorOf = (v: Viewer) => `staff:${v.role}`;
