// Kiwify public API sync (shared by the admin "Sincronizar" button and `npm run kiwify:sync`).
// Plain JS on purpose so the CLI runs with bare node.
//
// Docs: https://docs.kiwify.com.br/api-reference/general
//   POST https://public-api.kiwify.com/v1/oauth/token  (form: client_id, client_secret) -> access_token (24 h)
//   GET  https://public-api.kiwify.com/v1/sales?start_date&end_date (max 90 days)&page_size&page_number&product_id
//   headers: Authorization: Bearer <token>, x-kiwify-account-id: <account id>
// Env: KIWIFY_CLIENT_ID, KIWIFY_CLIENT_SECRET, KIWIFY_ACCOUNT_ID, KIWIFY_PRODUCT_IDS (comma list; required unless
// KIWIFY_SYNC_ALL_PRODUCTS=1), KIWIFY_SYNC_SINCE (YYYY-MM-DD, default 2024-01-01).
// Limits: the API has no subscriptions endpoint, so cancellations only arrive by webhook. The sync only
// activates buyers with a paid sale and deactivates refunded / charged-back ones.

const API = "https://public-api.kiwify.com/v1";
const ACTIVE = new Set(["paid", "approved", "authorized"]);
const INACTIVE = new Set(["refunded", "chargedback"]);
const DAY = 86400000;

const ymd = (d) => d.toISOString().slice(0, 10);

/** @param {Record<string,string|undefined>} env */
export function syncConfig(env) {
  const missing = ["KIWIFY_CLIENT_ID", "KIWIFY_CLIENT_SECRET", "KIWIFY_ACCOUNT_ID"].filter((k) => !env[k]);
  const products = String(env.KIWIFY_PRODUCT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = env.KIWIFY_SYNC_ALL_PRODUCTS === "1";
  if (!missing.length && !products.length && !all) missing.push("KIWIFY_PRODUCT_IDS (ou KIWIFY_SYNC_ALL_PRODUCTS=1)");
  return { ok: missing.length === 0, missing, products, all, since: env.KIWIFY_SYNC_SINCE || "2024-01-01" };
}

async function token(env) {
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.KIWIFY_CLIENT_ID, client_secret: env.KIWIFY_CLIENT_SECRET }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Kiwify OAuth falhou (${r.status}): ${d.message || d.error || "sem token"}`);
  return d.access_token;
}

async function getJson(url, headers, tries = 4) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers });
    if (r.status === 429 && i < tries) {
      await new Promise((res) => setTimeout(res, 15000));
      continue;
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Kiwify ${r.status}: ${d.message || d.error || url}`);
    return d;
  }
}

/** Fetch every sale (optionally per product) since `since`, in 90-day windows. */
async function fetchSales(env, cfg, log) {
  const headers = { Authorization: `Bearer ${await token(env)}`, "x-kiwify-account-id": env.KIWIFY_ACCOUNT_ID };
  const out = [];
  const start = new Date(cfg.since + "T00:00:00Z");
  const end = new Date(Date.now() + DAY);
  for (const product of cfg.all ? [null] : cfg.products) {
    for (let a = start; a < end; a = new Date(a.getTime() + 89 * DAY)) {
      const b = new Date(Math.min(a.getTime() + 89 * DAY, end.getTime()));
      for (let page = 1; page < 500; page++) {
        const qs = new URLSearchParams({ start_date: ymd(a), end_date: ymd(b), page_size: "100", page_number: String(page) });
        if (product) qs.set("product_id", product);
        const d = await getJson(`${API}/sales?${qs}`, headers);
        const rows = Array.isArray(d.data) ? d.data : [];
        out.push(...rows);
        if (rows.length < 100) break;
      }
    }
    log(`produto ${product || "(todos)"}: ${out.length} vendas até agora`);
  }
  return out;
}

/**
 * @param {{ env: Record<string,string|undefined>, query: (text: string, params?: unknown[]) => Promise<unknown>, dryRun?: boolean, actor?: string, log?: (s: string) => void }} o
 */
export async function runKiwifySync({ env, query, dryRun = false, actor = "sync", log = () => {} }) {
  const cfg = syncConfig(env);
  if (!cfg.ok) {
    return { ok: false, skipped: true, message: `Sincronização desligada: faltam ${cfg.missing.join(", ")}. Veja docs/KIWIFY.md.` };
  }
  const sales = await fetchSales(env, cfg, log);
  // latest state per e-mail: any paid sale wins; otherwise refunded/charged back -> inactive
  const byEmail = new Map();
  sales.sort((x, y) => String(x.updated_at || x.created_at).localeCompare(String(y.updated_at || y.created_at)));
  for (const s of sales) {
    const email = String(s.customer?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const st = String(s.status || "");
    const cur = byEmail.get(email);
    const next = { email, name: s.customer?.name || null, customer: s.customer?.id || null, order: s.id || null, product: s.product?.id || null, productName: s.product?.name || null, status: st };
    if (ACTIVE.has(st)) byEmail.set(email, { ...next, verdict: "active" });
    else if (INACTIVE.has(st) && (!cur || cur.verdict !== "active" || cur.order === s.id)) byEmail.set(email, { ...next, verdict: "inactive" });
  }
  let active = 0;
  let inactive = 0;
  for (const m of byEmail.values()) {
    if (m.verdict === "active") active++;
    else inactive++;
    if (dryRun) continue;
    await query(
      `insert into curso.portal_members (email, name, status, source, access_until, kiwify_customer_id, kiwify_order_id, product_id, product_name, last_event)
       values ($1,$2,$3,'sync',null,$4,$5,$6,$7,$8)
       on conflict (email) do update set name = coalesce(excluded.name, portal_members.name), status = excluded.status,
         source = 'sync', access_until = null, kiwify_customer_id = coalesce(excluded.kiwify_customer_id, portal_members.kiwify_customer_id),
         kiwify_order_id = coalesce(excluded.kiwify_order_id, portal_members.kiwify_order_id), product_id = coalesce(excluded.product_id, portal_members.product_id),
         product_name = coalesce(excluded.product_name, portal_members.product_name), last_event = excluded.last_event, updated_at = now()`,
      [m.email, m.name, m.verdict, m.customer, m.order, m.product, m.productName, `sync:${m.status}`],
    );
  }
  if (!dryRun) {
    await query(
      `insert into curso.portal_member_events (source, event_type, result, actor, payload) values ('sync','sync',$1,$2,$3)`,
      [`applied:${active} active, ${inactive} inactive`, actor, JSON.stringify({ sales: sales.length, emails: byEmail.size })],
    );
  }
  return { ok: true, sales: sales.length, emails: byEmail.size, active, inactive, dryRun, message: `${sales.length} vendas lidas: ${active} ativos, ${inactive} inativos${dryRun ? " (simulação, nada gravado)" : ""}.` };
}
