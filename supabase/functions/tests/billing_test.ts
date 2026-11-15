// LOCAL TESTS: deno test --allow-env supabase/functions/tests/billing_test.ts
// fetch is mocked: no network, no Stripe account.
import { handler as checkout } from "../billing-checkout/handler.ts";
import { handler as portal } from "../billing-portal/handler.ts";
import { handler as webhook, verify } from "../stripe-webhook/handler.ts";

const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const ORG = { id: "org-1", name: "Bravo", slug: "bravo", plan: "trial", status: "trial", trial_ends_at: null, vehicle_limit: 25, stripe_customer_id: null as string | null, stripe_subscription_id: null as string | null, billing_email: null };
let patches: Record<string, unknown>[] = [];
let stripeCalls: { method: string; url: string; body: string }[] = [];
let role = "admin";
function setEnv(withStripe: boolean) {
  for (const k of ["STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET","STRIPE_PRICE_STARTER","STRIPE_PRICE_PROFESSIONAL","STRIPE_PRICE_ENTERPRISE","STRIPE_PRICE_ONBOARDING"]) Deno.env.delete(k);
  Deno.env.set("SUPABASE_URL", "https://sb.test"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service"); Deno.env.set("SUPABASE_ANON_KEY", "anon");
  if (withStripe) {
    Deno.env.set("STRIPE_SECRET_KEY", "sk_test_x"); Deno.env.set("STRIPE_WEBHOOK_SECRET", "whsec_test");
    Deno.env.set("STRIPE_PRICE_STARTER", "price_s"); Deno.env.set("STRIPE_PRICE_PROFESSIONAL", "price_p"); Deno.env.set("STRIPE_PRICE_ENTERPRISE", "price_e");
    Deno.env.set("STRIPE_PRICE_ONBOARDING", "price_onb");
  }
}
const UNIT: Record<string, number> = { price_s: 1900, price_p: 2900, price_e: 3900 };
let vehicles = 3;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input), method = init?.method ?? "GET";
  const ok = (b: unknown, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json", ...h } });
  if (url.startsWith("https://sb.test/auth/v1/user")) return (init?.headers as Record<string,string>).Authorization === "Bearer good" ? ok({ id: "u1", email: "boss@b.test" }) : new Response("{}", { status: 401 });
  if (url.includes("/rest/v1/profiles")) return ok([{ role, active: true, org_id: "org-1" }]);
  if (url.includes("/rest/v1/vehicles")) return new Response(null, { status: 200, headers: { "content-range": `0-0/${vehicles}` } });
  if (url.includes("/rest/v1/organisations") && method === "PATCH") { const p = JSON.parse(String(init?.body)); patches.push(p); Object.assign(ORG, p); return ok([ORG]); }
  if (url.includes("/rest/v1/organisations")) return ok([ORG]);
  if (url.startsWith("https://api.stripe.com/v1/")) {
    stripeCalls.push({ method, url, body: String(init?.body ?? "") });
    const path = new URL(url).pathname.replace("/v1/", "");
    if (path.startsWith("prices/")) return ok({ id: path.slice(7), unit_amount: UNIT[path.slice(7)] });
    if (path === "customers") return ok({ id: "cus_1" });
    if (path === "checkout/sessions") return ok({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
    if (path === "billing_portal/sessions") return ok({ url: "https://billing.stripe.test/p" });
    if (path.startsWith("subscriptions/")) return ok({ id: "sub_1", customer: "cus_1", status: "active", metadata: { org_id: "org-1" }, items: { data: [{ price: { id: "price_p" }, quantity: 6 }] } });
  }
  return new Response("not mocked " + url, { status: 500 });
}) as typeof fetch;

const post = (body: unknown, auth = "Bearer good") => new Request("https://fn.test", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });

Deno.test("checkout without Stripe keys: billing not connected, nothing called", async () => {
  setEnv(false); stripeCalls = [];
  const r = await checkout(post({ plan: "starter" })); const b = await r.json();
  eq(r.status, 200, "status"); eq(b.configured, false, "configured"); eq(b.message, "Billing not connected yet", "message"); eq(stripeCalls.length, 0, "no stripe calls");
});
Deno.test("checkout rejects non-admins and bad sessions", async () => {
  setEnv(true); role = "planner";
  eq((await checkout(post({ plan: "starter" }))).status, 403, "planner");
  role = "admin";
  eq((await checkout(post({ plan: "starter" }, "Bearer bad"))).status, 401, "bad jwt");
  eq((await checkout(post({ plan: "gold" }))).status, 400, "bad plan");
});
Deno.test("checkout: per-vehicle quantity with £149 minimum, onboarding fee, customer created", async () => {
  setEnv(true); stripeCalls = []; patches = []; vehicles = 3; ORG.stripe_customer_id = null; ORG.stripe_subscription_id = null;
  const r = await checkout(post({ plan: "starter" })); const b = await r.json();
  eq(b.url, "https://checkout.stripe.test/cs_1", "url"); eq(b.quantity, 8, "starter min qty 8 (8 x £19 = £152 >= £149)");
  const cs = stripeCalls.find((c) => c.url.endsWith("checkout/sessions"))!; const f = new URLSearchParams(cs.body);
  eq(f.get("mode"), "subscription", "mode"); eq(f.get("line_items[0][price]"), "price_s", "price"); eq(f.get("line_items[0][quantity]"), "8", "qty");
  eq(f.get("line_items[1][price]"), "price_onb", "onboarding"); eq(f.get("metadata[org_id]"), "org-1", "meta"); eq(f.get("customer"), "cus_1", "customer");
  eq(patches[0], { stripe_customer_id: "cus_1" }, "customer saved");
  vehicles = 40; ORG.stripe_customer_id = "cus_1";
  const b2 = await (await checkout(post({ plan: "professional" }))).json(); eq(b2.quantity, 40, "40 vehicles billed");
});
Deno.test("checkout status lists prices", async () => {
  setEnv(true);
  const b = await (await checkout(post({ action: "status" }))).json();
  eq(b.configured, true, "configured"); eq(b.prices, { starter: 1900, professional: 2900, enterprise: 3900 }, "prices");
});
Deno.test("portal", async () => {
  setEnv(false); eq((await (await portal(post({}))).json()).configured, false, "not configured");
  setEnv(true); ORG.stripe_customer_id = "cus_1"; eq((await (await portal(post({}))).json()).url, "https://billing.stripe.test/p", "portal url");
});

async function sign(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return `t=${t},v1=` + Array.from(mac).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const hook = async (event: unknown, sig?: string) => {
  const payload = JSON.stringify(event);
  return await webhook(new Request("https://fn.test", { method: "POST", headers: { "Stripe-Signature": sig ?? await sign(payload, "whsec_test") }, body: payload }));
};
Deno.test("webhook signature", async () => {
  setEnv(true);
  const p = '{"a":1}';
  eq(await verify(p, await sign(p, "whsec_test"), "whsec_test"), true, "valid");
  eq(await verify(p, await sign(p, "other"), "whsec_test"), false, "wrong secret");
  eq(await verify(p, await sign(p, "whsec_test", 1000), "whsec_test"), false, "too old");
  eq((await hook({ type: "x" }, "t=1,v1=00")).status, 400, "bad sig rejected");
});
Deno.test("webhook without keys returns 503", async () => { setEnv(false); eq((await hook({ type: "x" }, "t=1,v1=0")).status, 503, "503"); });
Deno.test("webhook: checkout completed -> professional, active, limit = quantity", async () => {
  setEnv(true); patches = [];
  const r = await hook({ type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1", client_reference_id: "org-1" } } });
  eq(r.status, 200, "200");
  eq(patches.at(-1), { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active", plan: "professional", vehicle_limit: 6, trial_ends_at: null }, "org patched");
});
Deno.test("webhook: past_due and deleted", async () => {
  setEnv(true); patches = [];
  await hook({ type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "past_due", metadata: { org_id: "org-1" }, items: { data: [{ price: { id: "price_e" }, quantity: 12 }] } } } });
  eq(patches.at(-1), { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "past_due", plan: "enterprise", vehicle_limit: 12 }, "past due");
  await hook({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: {}, items: { data: [] } } } });
  eq((patches.at(-1) as Record<string, unknown>).status, "cancelled", "cancelled (org found by customer id)");
});
