// Stripe -> Northline. Deployed with --no-verify-jwt (Stripe does not send a Supabase JWT);
// every request is authenticated with the Stripe-Signature header instead.
// Events: checkout.session.completed, customer.subscription.created|updated|deleted, invoice.created
import { env, json, minQuantity, planForPrice, rest, stripe, updateOrg } from "../_shared/billing.ts";

const enc = new TextEncoder();
async function verify(payload: string, header: string, secret: string, toleranceSec = 300): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]).filter((p) => p.length === 2));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts["t"]);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

const STATUS: Record<string, string> = {
  active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due",
  canceled: "cancelled", incomplete_expired: "cancelled", paused: "past_due",
};

async function orgIdFor(sub: { metadata?: Record<string, string>; customer?: string }): Promise<string | null> {
  if (sub.metadata?.org_id) return sub.metadata.org_id;
  if (sub.customer) {
    const rows = await rest(`organisations?stripe_customer_id=eq.${encodeURIComponent(sub.customer)}&select=id`);
    return rows?.[0]?.id ?? null;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function syncSubscription(sub: any) {
  const orgId = await orgIdFor(sub);
  if (!orgId) { console.warn("No organisation for subscription", sub.id); return; }
  // deno-lint-ignore no-explicit-any
  const items: any[] = sub.items?.data ?? [];
  let plan: string | null = null, quantity: number | null = null;
  for (const it of items) {
    const p = planForPrice(it.price?.id);
    if (!p) continue;
    plan = p; quantity = it.quantity ?? null;
    // Monthly minimum: if the quantity was lowered (e.g. in the customer portal) below the minimum, put it back.
    const min = minQuantity(Number(it.price?.unit_amount) || 0);
    if (quantity != null && quantity < min && sub.status !== "canceled" && it.id) {
      await stripe("POST", "subscription_items/" + it.id, { quantity: min, proration_behavior: "none" });
      quantity = min;
    }
  }
  const status = STATUS[sub.status] ?? null;
  const patch: Record<string, unknown> = { stripe_subscription_id: sub.id, stripe_customer_id: sub.customer };
  if (status) patch.status = status;
  if (plan) patch.plan = plan;
  if (quantity != null) patch.vehicle_limit = quantity;
  if (status === "active") patch.trial_ends_at = null;
  await updateOrg(orgId, patch);
}

// Pilot customers pay no onboarding at checkout (subscription metadata onboarding_deferred=true). When the first renewal
// invoice is created (still a draft, so it can be edited), add the onboarding fee to it once and clear the flag.
// If they cancel during the pilot there is no renewal invoice, so they never pay it.
// deno-lint-ignore no-explicit-any
async function addDeferredOnboarding(inv: any) {
  const price = env("STRIPE_PRICE_ONBOARDING");
  if (!price || !inv?.subscription || inv.billing_reason !== "subscription_cycle" || inv.status !== "draft") return;
  const sub = await stripe("GET", "subscriptions/" + inv.subscription);
  if (sub.metadata?.onboarding_deferred !== "true" || sub.status === "canceled") return;
  // Read the invoice's current lines (the event payload can be stale when Stripe retries a delivery), and the customer's
  // invoice items, so onboarding is charged once per subscription even if clearing the flag below ever fails.
  const lines = await stripe("GET", `invoices/${inv.id}/lines`, { limit: 100 });
  // deno-lint-ignore no-explicit-any
  const onThisInvoice = (lines.data ?? []).some((l: any) => l.price?.id === price);
  const items = await stripe("GET", "invoiceitems", { customer: inv.customer, limit: 100 });
  // deno-lint-ignore no-explicit-any
  const chargedBefore = (items.data ?? []).some((it: any) => it.metadata?.reason === "pilot_onboarding" && it.metadata?.subscription === sub.id);
  if (!onThisInvoice && !chargedBefore) {
    // Idempotency key per invoice: a concurrent or retried delivery gets the same invoice item back, never a second one.
    await stripe("POST", "invoiceitems", { customer: inv.customer, invoice: inv.id, price, quantity: 1,
      description: "Northline onboarding (deferred from pilot)",
      metadata: { org_id: sub.metadata?.org_id ?? "", subscription: sub.id, reason: "pilot_onboarding" } },
      `northline-onboarding-${inv.id}`);
  }
  // Best effort: the checks above already prevent a second charge, so a failure here must not hold the invoice in draft.
  try {
    await stripe("POST", "subscriptions/" + sub.id, { metadata: { onboarding_deferred: "false", onboarding_invoice: inv.id } });
  } catch (e) { console.warn("Could not clear onboarding_deferred on", sub.id, e); }
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret || !env("STRIPE_SECRET_KEY")) return json({ error: "Billing not connected yet" }, 503);
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get("Stripe-Signature") ?? "", secret))) return json({ error: "Bad signature" }, 400);
  const event = JSON.parse(payload);
  try {
    const obj = event.data?.object ?? {};
    if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
      const sub = await stripe("GET", "subscriptions/" + obj.subscription);
      if (!sub.metadata?.org_id && obj.client_reference_id) sub.metadata = { ...(sub.metadata ?? {}), org_id: obj.client_reference_id };
      await syncSubscription(sub);
    } else if (event.type === "invoice.created") {
      await addDeferredOnboarding(obj);
    } else if (event.type.startsWith("customer.subscription.")) {
      await syncSubscription(event.type === "customer.subscription.deleted" ? { ...obj, status: "canceled" } : obj);
    }
    return json({ received: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Webhook handling failed" }, 500); // Stripe retries
  }
};


export { verify };
