import { detectColumns, parseCsv, statusOf } from "@/lib/portal/csv";
import { logEvent, upsertMember } from "@/lib/portal/members";
import { json } from "@/lib/portal/ratelimit";
import { normEmail } from "@/lib/portal/session";
import { actorOf, staffGate } from "@/lib/portal/staff-gate";

/**
 * POST {csv, product?, dry?}: Kiwify sales export (Vendas → Exportar) or a plain list of e-mails.
 * product = text the product column must contain. Several rows per e-mail: an approved row wins over refunded ones.
 */
export async function POST(req: Request) {
  const g = await staffGate(req, true);
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => ({}))) as { csv?: string; product?: string; dry?: boolean };
  const csv = String(b.csv || "");
  if (csv.length > 8_000_000) return json(413, { error: "Arquivo grande demais (máx. 8 MB)." });
  let rows = parseCsv(csv);
  if (!rows.length) return json(400, { error: "CSV vazio." });
  // plain list of e-mails, no header
  const headerless = rows[0].some((c) => normEmail(c));
  if (headerless) rows = [["email"], ...rows.map((r) => [r.find((c) => normEmail(c)) || ""])];
  const cols = detectColumns(rows[0]);
  if (cols.email < 0) return json(400, { error: "Não achei a coluna de e-mail no cabeçalho.", header: rows[0] });
  const want = String(b.product || "").trim().toLowerCase();

  const best = new Map<string, { status: "active" | "inactive"; name: string | null; product: string | null }>();
  let skipped = 0;
  let otherProduct = 0;
  for (const r of rows.slice(1)) {
    const email = normEmail(r[cols.email]);
    if (!email) {
      skipped++;
      continue;
    }
    const product = cols.product >= 0 ? (r[cols.product] || "").trim() || null : null;
    if (want && !(product || "").toLowerCase().includes(want)) {
      otherProduct++;
      continue;
    }
    const st = statusOf(cols.status >= 0 ? r[cols.status] : undefined);
    if (!st) {
      skipped++;
      continue;
    }
    const cur = best.get(email);
    if (!cur || (cur.status === "inactive" && st === "active"))
      best.set(email, { status: st, name: cols.name >= 0 ? (r[cols.name] || "").trim().slice(0, 120) || null : null, product });
  }
  if (best.size > 50_000) return json(400, { error: "CSV grande demais (máx. 50 mil e-mails)." });
  let active = 0;
  for (const [email, m] of best) {
    if (m.status === "active") active++;
    if (!b.dry) await upsertMember({ email, name: m.name, status: m.status, source: "csv", product_name: m.product, last_event: "csv" });
  }
  const inactive = best.size - active;
  if (!b.dry)
    await logEvent({ source: "csv", event_type: "csv_import", result: `applied:${active} active, ${inactive} inactive`, actor: actorOf(g.v), payload: { rows: rows.length - 1, product: want || null } });
  const h = rows[0];
  return json(200, {
    ok: true,
    dry: !!b.dry,
    rows: rows.length - 1,
    emails: best.size,
    active,
    inactive,
    skipped,
    otherProduct,
    columns: { email: h[cols.email] ?? null, status: cols.status >= 0 ? h[cols.status] : null, product: cols.product >= 0 ? h[cols.product] : null, name: cols.name >= 0 ? h[cols.name] : null },
    message: `${b.dry ? "Simulação: " : ""}${best.size} e-mails (${active} ativos, ${inactive} inativos). ${skipped} linhas ignoradas${otherProduct ? `, ${otherProduct} de outros produtos` : ""}.`,
  });
}
