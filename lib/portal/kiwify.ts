import "server-only";
import crypto from "node:crypto";
import { eventResult, logEvent, setEventResult, upsertMember } from "./members";
import { normEmail } from "./session";

// Kiwify webhook (Apps → Webhooks). Sync with the public API lives in kiwify-sync.mjs, CSV import in csv.ts.

/** webhook_event_type -> member status. Anything else (boleto/pix gerado, compra recusada, carrinho abandonado) is ignored. */
const ACTIVATE = new Set(["order_approved", "subscription_renewed"]);
const DEACTIVATE = new Set(["subscription_late", "subscription_canceled", "order_refunded", "chargeback"]);
/** order_status fallback when webhook_event_type is missing. */
const STATUS_ACTIVE = new Set(["paid", "approved", "authorized"]);
const STATUS_INACTIVE = new Set(["refunded", "chargedback", "chargeback"]);

/** Comma list of Kiwify product ids that grant access (empty = every product of the account). */
export function productFilter() {
  return String(process.env.KIWIFY_PRODUCT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Webhook tokens accepted (comma list: lets a production and a test webhook coexist). */
export function webhookTokens() {
  return String(process.env.KIWIFY_WEBHOOK_TOKEN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Kiwify adds ?signature=<hex HMAC-SHA1(token, body)> to the webhook URL. We check the raw body and,
 * as a fallback, the re-serialized JSON.
 */
export function verifyKiwifySignature(rawBody: string, signature: string | null) {
  const sig = (signature || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sig)) return false;
  const bodies = [rawBody];
  try {
    bodies.push(JSON.stringify(JSON.parse(rawBody)));
  } catch {}
  for (const token of webhookTokens())
    for (const b of bodies) {
      const h = crypto.createHmac("sha1", token).update(b).digest("hex");
      if (crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig))) return true;
    }
  return false;
}

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
type Obj = Record<string, unknown>;

export function parseKiwifyEvent(body: unknown) {
  let b = (body && typeof body === "object" ? body : {}) as Obj;
  if (b.order && typeof b.order === "object" && !b.order_id) b = b.order as Obj; // some integrations wrap it
  const customer = ((b.Customer || b.customer || {}) as Obj) ?? {};
  const product = ((b.Product || b.product || {}) as Obj) ?? {};
  const sub = ((b.Subscription || b.subscription || {}) as Obj) ?? {};
  const event = str(b.webhook_event_type)?.toLowerCase() || null;
  const orderStatus = str(b.order_status)?.toLowerCase() || null;
  let action: "active" | "inactive" | "ignore" = "ignore";
  if (event) action = ACTIVATE.has(event) ? "active" : DEACTIVATE.has(event) ? "inactive" : "ignore";
  else if (orderStatus) action = STATUS_ACTIVE.has(orderStatus) ? "active" : STATUS_INACTIVE.has(orderStatus) ? "inactive" : "ignore";
  return {
    event: event || (orderStatus ? `status:${orderStatus}` : null),
    action,
    email: normEmail(customer.email),
    name: str(customer.full_name || customer.name),
    customerId: str(customer.id),
    orderId: str(b.order_id || b.id),
    subscriptionId: str(b.subscription_id || sub.id),
    productId: str(product.product_id || product.id),
    productName: str(product.product_name || product.name),
  };
}

/** The event log keeps the order, not the buyer's documents, phone or address. */
function redact(body: unknown) {
  if (!body || typeof body !== "object") return body;
  const b = { ...(body as Obj) };
  for (const k of ["Customer", "customer"]) {
    const c = b[k] as Obj | undefined;
    if (c && typeof c === "object") b[k] = { id: c.id, full_name: c.full_name ?? c.name, email: c.email };
  }
  return b;
}

/** One verified delivery. Idempotent: the same body delivered again is a no-op. */
export async function applyKiwifyWebhook(raw: string, body: unknown): Promise<string> {
  const ev = parseKiwifyEvent(body);
  const dedupe = `kiwify:${ev.orderId || "?"}:${ev.event || "?"}:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
  const products = productFilter();
  let result: string;
  if (!ev.email) result = "ignored:no-email";
  else if (ev.action === "ignore") result = "ignored:event";
  else if (products.length && !(ev.productId && products.includes(ev.productId))) result = "ignored:product";
  else result = `applied:${ev.action}`;

  let id = await logEvent({
    source: "kiwify",
    event_type: ev.event,
    order_id: ev.orderId,
    subscription_id: ev.subscriptionId,
    email: ev.email || null,
    product_id: ev.productId,
    result: "received",
    dedupe_key: dedupe,
    payload: redact(body),
  });
  if (!id) {
    // already seen: finished -> duplicate; died half-way ("received") -> run again
    const prev = await eventResult(dedupe);
    if (!prev || prev.result !== "received") return "duplicate";
    id = prev.id;
  }
  if (result.startsWith("applied:")) {
    await upsertMember({
      email: ev.email,
      status: ev.action as "active" | "inactive",
      source: "kiwify",
      name: ev.name,
      kiwify_customer_id: ev.customerId,
      kiwify_order_id: ev.orderId,
      kiwify_subscription_id: ev.subscriptionId,
      product_id: ev.productId,
      product_name: ev.productName,
      last_event: ev.event,
    });
  }
  await setEventResult(id, result);
  return result;
}
