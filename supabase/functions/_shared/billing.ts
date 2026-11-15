// Shared helpers for the Northline billing functions (Supabase Edge Functions, Deno).
// No third-party imports: Stripe and Supabase are called over HTTPS with fetch.
//
// Function secrets (Supabase Dashboard > Edge Functions > Secrets, or `supabase secrets set`):
//   STRIPE_SECRET_KEY            sk_live_... or sk_test_...            (billing stays off until set)
//   STRIPE_WEBHOOK_SECRET        whsec_...                              (stripe-webhook only)
//   STRIPE_PRICE_STARTER         price_... recurring monthly, per vehicle (placeholder £19)
//   STRIPE_PRICE_PROFESSIONAL    price_... recurring monthly, per vehicle (placeholder £29)
//   STRIPE_PRICE_ENTERPRISE      price_... recurring monthly, per vehicle (placeholder £39)
//   STRIPE_PRICE_ONBOARDING      price_... one-off onboarding fee (optional)
//   NORTHLINE_MIN_MONTHLY_PENCE  minimum monthly charge in pence, default 14900 (£149)
//   NORTHLINE_APP_URL            where Checkout returns to, default the GitHub Pages app URL
//   STRIPE_PORTAL_CONFIGURATION  bpc_... customer portal configuration made by stripe-setup.sh (optional)
//   STRIPE_AUTOMATIC_TAX         "true" to let Stripe Tax add UK VAT (needs Stripe Tax set up)
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

export const env = (k: string, d = ""): string => (Deno.env.get(k) ?? d).trim();

export const PLANS = ["starter", "professional", "enterprise"] as const;
export type Plan = typeof PLANS[number];
export const priceIdFor = (plan: Plan): string => env("STRIPE_PRICE_" + plan.toUpperCase());
export const planForPrice = (priceId: string): Plan | null =>
  PLANS.find((p) => priceIdFor(p) && priceIdFor(p) === priceId) ?? null;

export const appUrl = () => env("NORTHLINE_APP_URL", "https://josephbickley33-web.github.io/northline-os/app/");

export const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// True while the Stripe key is a test-mode key: the app then shows "Test mode: no real money".
export const testMode = (): boolean => env("STRIPE_SECRET_KEY").startsWith("sk_test_") || env("STRIPE_SECRET_KEY").startsWith("rk_test_");

// The £149 (default) monthly minimum is enforced as a minimum number of billed vehicles for the plan's unit price.
export const minQuantity = (unitPence: number): number => {
  const minPence = Number(env("NORTHLINE_MIN_MONTHLY_PENCE", "14900")) || 0;
  return Math.max(1, unitPence > 0 ? Math.ceil(minPence / unitPence) : 1);
};

export function billingConfigured(): { ok: boolean; missing: string[] } {
  const missing = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PROFESSIONAL", "STRIPE_PRICE_ENTERPRISE"]
    .filter((k) => !env(k));
  return { ok: missing.length === 0, missing };
}

// ---- Stripe REST (form-encoded)
function form(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => typeof item === "object" ? form(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item)));
    else if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}
// idempotencyKey: Stripe returns the first result for repeated POSTs with the same key (24 h), so retried webhooks cannot double-charge.
export async function stripe(method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string) {
  const url = new URL("https://api.stripe.com/v1/" + path);
  const init: RequestInit = { method, headers: { Authorization: "Bearer " + env("STRIPE_SECRET_KEY"), "Stripe-Version": "2024-06-20" } };
  if (params && method === "GET") form(params).forEach((v, k) => url.searchParams.append(k, v));
  if (idempotencyKey) (init.headers as Record<string, string>)["Idempotency-Key"] = idempotencyKey;
  if (params && method === "POST") {
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = form(params).toString();
  }
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error("Stripe: " + (body?.error?.message ?? res.status));
  return body;
}

// ---- Supabase (service role for writes, the caller's JWT to identify them)
const sbUrl = () => env("SUPABASE_URL");
const service = () => env("SUPABASE_SERVICE_ROLE_KEY");
export async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(sbUrl() + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: service(), Authorization: "Bearer " + service(), "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Database: " + text);
  return text ? JSON.parse(text) : null;
}

export type Org = {
  id: string; name: string; slug: string; plan: string; status: string; trial_ends_at: string | null;
  vehicle_limit: number | null; stripe_customer_id: string | null; stripe_subscription_id: string | null; billing_email: string | null;
};

// Resolve the signed-in caller and require them to be an active admin of an organisation.
export async function requireOrgAdmin(req: Request): Promise<{ userId: string; email: string; org: Org }> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Sign in first");
  const ures = await fetch(sbUrl() + "/auth/v1/user", { headers: { apikey: env("SUPABASE_ANON_KEY") || service(), Authorization: auth } });
  if (!ures.ok) throw new HttpError(401, "Your session has expired. Sign in again.");
  const user = await ures.json();
  const profs = await rest(`profiles?id=eq.${user.id}&select=role,active,org_id`);
  const p = profs?.[0];
  if (!p || !p.active || p.role !== "admin" || !p.org_id) throw new HttpError(403, "Only an organisation admin can manage billing");
  const orgs = await rest(`organisations?id=eq.${p.org_id}&select=*`);
  if (!orgs?.[0]) throw new HttpError(404, "Organisation not found");
  return { userId: user.id, email: user.email, org: orgs[0] as Org };
}

export async function updateOrg(id: string, patch: Partial<Org>) {
  return await rest(`organisations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function vehiclesInUse(orgId: string): Promise<number> {
  const res = await fetch(sbUrl() + `/rest/v1/vehicles?org_id=eq.${orgId}&status=neq.Sold&select=id`, {
    method: "HEAD", headers: { apikey: service(), Authorization: "Bearer " + service(), Prefer: "count=exact" },
  });
  const range = res.headers.get("content-range") ?? "*/0";
  return Number(range.split("/")[1] ?? 0) || 0;
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try { return await fn(req); }
    catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
  };
}
