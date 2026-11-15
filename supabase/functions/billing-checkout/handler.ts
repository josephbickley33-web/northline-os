// POST { action: "status" }                      -> { configured, missing, prices }
// POST { plan: "starter"|"professional"|"enterprise" } -> { url } Stripe Checkout for a per-vehicle subscription
// Without STRIPE_SECRET_KEY and price ids it answers { configured: false } and the trial carries on.
import { appUrl, billingConfigured, env, handle, minQuantity, testMode, HttpError, json, PLANS, Plan, priceIdFor, requireOrgAdmin, stripe, updateOrg, vehiclesInUse } from "../_shared/billing.ts";

export const handler = handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const cfg = billingConfigured();
  const { org, email } = await requireOrgAdmin(req);

  if (body.action === "status" || !cfg.ok) {
    let prices: Record<string, number | null> = {};
    if (cfg.ok) {
      for (const p of PLANS) prices[p] = (await stripe("GET", "prices/" + priceIdFor(p))).unit_amount ?? null;
    }
    return json({ configured: cfg.ok, missing: cfg.missing, prices, message: cfg.ok ? "Billing connected" : "Billing not connected yet",
      subscription: !!org.stripe_subscription_id, test_mode: cfg.ok && testMode() });
  }

  const plan = String(body.plan ?? "") as Plan;
  if (!PLANS.includes(plan)) throw new HttpError(400, "Choose starter, professional or enterprise");
  if (org.stripe_subscription_id && org.status !== "cancelled") {
    return json({ error: "This organisation already has a subscription. Use Manage billing to change plan or vehicles.", portal: true }, 409);
  }

  const price = await stripe("GET", "prices/" + priceIdFor(plan));
  const unit = Number(price.unit_amount) || 1;
  const vehicles = await vehiclesInUse(org.id);
  // Billed per vehicle, with a minimum monthly charge expressed as a minimum number of vehicles.
  const quantity = Math.max(vehicles, minQuantity(unit));

  let customer = org.stripe_customer_id;
  if (!customer) {
    const c = await stripe("POST", "customers", { name: org.name, email: org.billing_email || email, metadata: { org_id: org.id, slug: org.slug } });
    customer = c.id as string;
    await updateOrg(org.id, { stripe_customer_id: customer });
  }

  // Pilot code (e.g. PILOT50), entered in the app. A pilot coupon (metadata pilot=1) defers onboarding: nothing is charged
  // for it at checkout; the webhook adds it to the first full-price invoice if the subscription continues after the pilot.
  // Stripe's own promotion-code box is not offered, so the pilot can only be applied here, where onboarding is handled.
  const promoCode = String(body.promo_code ?? "").trim().toUpperCase();
  let discounts: Record<string, unknown>[] | undefined; let pilot = false;
  if (promoCode) {
    if (!/^[A-Z0-9_-]{2,40}$/.test(promoCode)) throw new HttpError(400, "That code is not valid");
    const pc = (await stripe("GET", "promotion_codes", { code: promoCode, active: "true", limit: 1 })).data?.[0];
    if (!pc) throw new HttpError(400, "That code is not valid or has expired");
    discounts = [{ promotion_code: pc.id }];
    pilot = pc.coupon?.metadata?.pilot === "1";
  }
  const line_items: Record<string, unknown>[] = [{ price: priceIdFor(plan), quantity }];
  const onboarding = env("STRIPE_PRICE_ONBOARDING");
  const chargeOnboarding = !!onboarding && !org.stripe_subscription_id;
  if (chargeOnboarding && !pilot) line_items.push({ price: onboarding, quantity: 1 });
  const subMeta: Record<string, string> = { org_id: org.id, plan };
  if (chargeOnboarding && pilot) subMeta.onboarding_deferred = "true";

  const session = await stripe("POST", "checkout/sessions", {
    mode: "subscription",
    customer,
    line_items,
    client_reference_id: org.id,
    metadata: { org_id: org.id, plan, ...(promoCode ? { promo_code: promoCode } : {}) },
    subscription_data: { metadata: subMeta },
    ...(discounts ? { discounts } : {}),
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: "true" },
    ...(env("STRIPE_AUTOMATIC_TAX") === "true" ? { automatic_tax: { enabled: "true" } } : {}),
    success_url: appUrl() + "?billing=success",
    cancel_url: appUrl() + "?billing=cancelled",
  });
  return json({ url: session.url, quantity, pilot, onboarding_deferred: subMeta.onboarding_deferred === "true" });
});


