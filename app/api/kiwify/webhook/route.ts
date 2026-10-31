import { applyKiwifyWebhook, verifyKiwifySignature, webhookTokens } from "@/lib/portal/kiwify";
import { json } from "@/lib/portal/ratelimit";

/**
 * Kiwify webhook (Apps → Webhooks). Kiwify POSTs the order JSON with ?signature=<HMAC-SHA1(token, body)>.
 * compra_aprovada / subscription_renewed -> active; subscription_late / subscription_canceled /
 * compra_reembolsada / chargeback -> inactive. Optional KIWIFY_PRODUCT_IDS filter. Idempotent per delivery.
 */
export async function POST(req: Request) {
  if (!webhookTokens().length) return json(503, { error: "webhook not configured" });
  const raw = await req.text();
  if (raw.length > 512_000) return json(413, { error: "too large" });
  const sig = new URL(req.url).searchParams.get("signature") || req.headers.get("x-kiwify-signature");
  if (!verifyKiwifySignature(raw, sig)) return json(401, { error: "bad signature" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }
  try {
    return json(200, { ok: true, result: await applyKiwifyWebhook(raw, body) });
  } catch (e) {
    console.error("kiwify webhook failed", e);
    return json(500, { error: "failed" }); // Kiwify retries
  }
}

export async function GET() {
  return json(200, { ok: true, service: "kiwify-webhook", configured: webhookTokens().length > 0 });
}
