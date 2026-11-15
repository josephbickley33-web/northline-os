// POST {} -> { url } Stripe customer portal for the caller's organisation (org admins only).
import { appUrl, billingConfigured, env, handle, HttpError, json, requireOrgAdmin, stripe } from "../_shared/billing.ts";

export const handler = handle(async (req) => {
  const { org } = await requireOrgAdmin(req);
  if (!billingConfigured().ok) return json({ configured: false, message: "Billing not connected yet" });
  if (!org.stripe_customer_id) throw new HttpError(400, "Choose a plan first");
  const s = await stripe("POST", "billing_portal/sessions", { customer: org.stripe_customer_id, return_url: appUrl(), configuration: env("STRIPE_PORTAL_CONFIGURATION") || undefined });
  return json({ url: s.url });
});


