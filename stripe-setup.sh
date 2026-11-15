#!/usr/bin/env bash
# Northline: set up (or re-sync) Stripe billing and connect it to Supabase. Safe to re-run.
#
#   NORTHLINE_STRIPE_SECRET_KEY=sk_test_... SUPABASE_ACCESS_TOKEN=sbp_... ./stripe-setup.sh
#   (falls back to STRIPE_SECRET_KEY if NORTHLINE_STRIPE_SECRET_KEY is not set)
#   Optional safety check: EXPECT_STRIPE_ACCOUNT=acct_... refuses to run against any other Stripe account.
#
# Going live: run it again with the LIVE secret key in NORTHLINE_STRIPE_SECRET_KEY (sk_live_...). Test and live objects are separate in Stripe,
# so this creates the live product, prices, portal settings and webhook and switches Supabase over to them.
#
# What it does (idempotently):
#   1. Products "Northline Starter|Professional|Enterprise" (ids northline_<plan>), each with one monthly
#      per-vehicle GBP price, tax exclusive (lookup keys northline_starter £9, northline_professional £15,
#      northline_enterprise £25). One product per plan because the customer portal needs that to switch plans.
#      Product "Northline onboarding" (id northline_onboarding) with one-off price northline_onboarding £495.
#      If an amount changes here, a new price is created and the lookup key moves to it (old price archived).
#      Pilot offer: coupon northline_pilot_50 (50% off the plan, 3 monthly invoices = 90 days, not the onboarding fee)
#      and promotion code PILOT50 for Checkout.
#   2. Customer portal configuration (cancel at period end, change plan/quantity, payment method, invoices).
#   3. Webhook endpoint -> stripe-webhook function. Re-created on every run because Stripe only reveals the
#      signing secret at creation; the secret goes straight into Supabase and is never printed or saved.
#   4. Supabase Edge Function secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_*,
#      STRIPE_PORTAL_CONFIGURATION, NORTHLINE_MIN_MONTHLY_PENCE, NORTHLINE_APP_URL.
#   5. Redeploys the three billing functions (skip with SKIP_DEPLOY=1).
#
# Optional env: SUPABASE_PROJECT_REF (default fgvleepcryfqyrsabfgh), APP_URL, MIN_MONTHLY_PENCE (default 14900),
#   PRICE_STARTER_PENCE / PRICE_PROFESSIONAL_PENCE / PRICE_ENTERPRISE_PENCE / PRICE_ONBOARDING_PENCE.
set -euo pipefail
# The key is read from NORTHLINE_STRIPE_SECRET_KEY first (so other bots/projects on a shared machine that use
# STRIPE_SECRET_KEY cannot clash), falling back to STRIPE_SECRET_KEY.
_KEY="${NORTHLINE_STRIPE_SECRET_KEY:-${STRIPE_SECRET_KEY:-}}"
[[ -n "$_KEY" ]] || { echo "Set NORTHLINE_STRIPE_SECRET_KEY (sk_test_... or sk_live_...)" >&2; exit 1; }
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (sbp_...)}"
export STRIPE_SECRET_KEY="$(printf %s "$_KEY" | tr -d '[:space:]')"; unset _KEY
export SUPABASE_ACCESS_TOKEN="$(printf %s "$SUPABASE_ACCESS_TOKEN" | tr -d '[:space:]')"
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-fgvleepcryfqyrsabfgh}"
export APP_URL="${APP_URL:-https://josephbickley33-web.github.io/northline-os/app/}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 - <<'PY'
import json, os, sys, urllib.parse, urllib.request, urllib.error
KEY = os.environ["STRIPE_SECRET_KEY"]; TOK = os.environ["SUPABASE_ACCESS_TOKEN"]
REF = os.environ["SUPABASE_PROJECT_REF"]; APP = os.environ["APP_URL"]
if not KEY.startswith(("sk_test_", "sk_live_", "rk_test_", "rk_live_")): sys.exit("STRIPE_SECRET_KEY does not look like a Stripe secret key")
MODE = "TEST" if "_test_" in KEY else "LIVE"
P = lambda k, d: int(os.environ.get(k, d))
PRICES = {"starter": P("PRICE_STARTER_PENCE", 900), "professional": P("PRICE_PROFESSIONAL_PENCE", 1500), "enterprise": P("PRICE_ENTERPRISE_PENCE", 2500)}
ONBOARD = P("PRICE_ONBOARDING_PENCE", 49500); MINP = P("MIN_MONTHLY_PENCE", 14900)
HOOK = f"https://{REF}.supabase.co/functions/v1/stripe-webhook"
EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]

def enc(d, prefix="", out=None):
    out = [] if out is None else out
    for k, v in d.items():
        key = f"{prefix}[{k}]" if prefix else k
        if v is None: continue
        if isinstance(v, dict): enc(v, key, out)
        elif isinstance(v, list):
            for i, x in enumerate(v):
                if isinstance(x, dict): enc(x, f"{key}[{i}]", out)
                else: out.append((f"{key}[{i}]", str(x)))
        elif isinstance(v, bool): out.append((key, "true" if v else "false"))
        else: out.append((key, str(v)))
    return out

def stripe(method, path, params=None):
    url = "https://api.stripe.com/v1/" + path; data = None
    if params and method == "GET": url += "?" + urllib.parse.urlencode(enc(params))
    elif params: data = urllib.parse.urlencode(enc(params)).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + KEY, "Stripe-Version": "2024-06-20"})
    try:
        with urllib.request.urlopen(req) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        body = json.load(e)
        if e.code == 404: return None
        sys.exit(f"Stripe {method} {path} failed: {body.get('error', {}).get('message', e.code)}")

acct = stripe("GET", "account")
if os.environ.get("EXPECT_STRIPE_ACCOUNT") and acct["id"] != os.environ["EXPECT_STRIPE_ACCOUNT"]:
    sys.exit(f"Refusing: this key is for Stripe account {acct['id']}, expected {os.environ['EXPECT_STRIPE_ACCOUNT']}. Nothing was changed.")
print(f"Stripe account {acct['id']} ({acct.get('country')}, {acct.get('default_currency','').upper()}) in {MODE} mode")

def product(pid, name, desc):
    p = stripe("GET", f"products/{pid}")
    if p is None: p = stripe("POST", "products", {"id": pid, "name": name, "description": desc, "metadata": {"northline": "1"}})
    elif not p["active"] or p["name"] != name: p = stripe("POST", f"products/{pid}", {"active": True, "name": name})
    return p["id"]

def price(lookup, prod, amount, recurring):
    found = stripe("GET", "prices", {"lookup_keys": [lookup], "active": "true", "limit": 1})["data"]
    if found:
        x = found[0]
        same = (x["unit_amount"] == amount and x["currency"] == "gbp" and x["product"] == prod and x.get("tax_behavior") == "exclusive"
                and ((x.get("recurring") or {}).get("interval") == "month") == recurring)
        if same: return x["id"], "kept"
    params = {"product": prod, "currency": "gbp", "unit_amount": amount, "lookup_key": lookup, "transfer_lookup_key": True,
              "tax_behavior": "exclusive", "nickname": lookup.replace("_", " ").title(), "metadata": {"northline": "1"}}
    if recurring: params["recurring"] = {"interval": "month", "usage_type": "licensed"}
    x = stripe("POST", "prices", params)
    if found: stripe("POST", f"prices/{found[0]['id']}", {"active": False})
    return x["id"], "created"

# One product per plan: Stripe's customer portal can only switch plans / change quantity between
# products that each have one monthly price.
prods = {plan: product(f"northline_{plan}", f"Northline {plan.title()}", f"Northline {plan.title()} plan for UK hauliers. Billed per vehicle per month.") for plan in PRICES}
onb_prod = product("northline_onboarding", "Northline onboarding", "One-off setup and data import.")
ids = {}
for plan, amount in PRICES.items():
    ids[plan], how = price(f"northline_{plan}", prods[plan], amount, True)
    print(f"  price northline_{plan:<13} £{amount/100:.2f}/vehicle/month  {ids[plan]} ({how})")
ids["onboarding"], how = price("northline_onboarding", onb_prod, ONBOARD, False)
print(f"  price northline_onboarding    £{ONBOARD/100:.2f} one-off        {ids['onboarding']} ({how})")
for plan, amount in PRICES.items():
    q = max(1, -(-MINP // amount)); print(f"  minimum {plan}: {q} vehicles = £{q*amount/100:.2f}/month")

# Pilot: half price on the plan for the first 3 monthly invoices (90 days). Onboarding is not discounted.
PILOT = {"percent_off": 50, "duration": "repeating", "duration_in_months": 3, "currency": None}
c = stripe("GET", "coupons/northline_pilot_50", {"expand": ["applies_to"]})
want_products = sorted(prods.values())
if c and (c.get("percent_off") != 50 or c.get("duration_in_months") != 3 or sorted((c.get("applies_to") or {}).get("products", [])) != want_products):
    stripe("DELETE", "coupons/northline_pilot_50"); c = None   # coupons are immutable; existing customers keep their discount
if c is None:
    c = stripe("POST", "coupons", {"id": "northline_pilot_50", "name": "Northline pilot: half price for 90 days", "percent_off": 50,
                                    "duration": "repeating", "duration_in_months": 3, "applies_to": {"products": want_products},
                                    "metadata": {"northline": "1"}})
codes = stripe("GET", "promotion_codes", {"code": "PILOT50", "limit": 10})["data"]
live = [x for x in codes if x["active"] and x["coupon"]["id"] == c["id"] and x["coupon"].get("valid", True)]
for x in codes:
    if x["active"] and x not in live: stripe("POST", f"promotion_codes/{x['id']}", {"active": False})
promo = live[0] if live else stripe("POST", "promotion_codes", {"coupon": c["id"], "code": "PILOT50", "metadata": {"northline": "1"}})
print(f"  pilot coupon {c['id']} (50% off plan for 3 months), promotion code PILOT50 {promo['id']} ({'kept' if live else 'created'})")

portal = {
    "business_profile": {"headline": "Northline: manage plan, vehicles, card and invoices"},
    "default_return_url": APP,
    "features": {
        "customer_update": {"enabled": True, "allowed_updates": ["email", "address", "tax_id", "name"]},
        "invoice_history": {"enabled": True},
        "payment_method_update": {"enabled": True},
        "subscription_cancel": {"enabled": True, "mode": "at_period_end", "proration_behavior": "none",
                                "cancellation_reason": {"enabled": True, "options": ["too_expensive", "missing_features", "switched_service", "unused", "other"]}},
        "subscription_update": {"enabled": True, "default_allowed_updates": ["price", "quantity"], "proration_behavior": "create_prorations",
                                "products": [{"product": prods[p], "prices": [ids[p]]} for p in PRICES]},
    },
    "metadata": {"northline": "1"},
}
existing = [c for c in stripe("GET", "billing_portal/configurations", {"active": "true", "limit": 100})["data"] if (c.get("metadata") or {}).get("northline") == "1"]
cfg = stripe("POST", f"billing_portal/configurations/{existing[0]['id']}" if existing else "billing_portal/configurations", portal)
# Archive the single "northline" product used by the first version of this script, if it is still there.
old = stripe("GET", "products/northline")
if old and old["active"]:
    for x in stripe("GET", "prices", {"product": "northline", "active": "true", "limit": 100})["data"]: stripe("POST", f"prices/{x['id']}", {"active": False})
    stripe("POST", "products/northline", {"active": False})
print(f"  customer portal configuration {cfg['id']} ({'updated' if existing else 'created'})")

for w in stripe("GET", "webhook_endpoints", {"limit": 100})["data"]:
    if w["url"] == HOOK: stripe("DELETE", f"webhook_endpoints/{w['id']}")
hook = stripe("POST", "webhook_endpoints", {"url": HOOK, "enabled_events": EVENTS, "api_version": "2024-06-20",
                                             "description": "Northline billing sync", "metadata": {"northline": "1"}})
print(f"  webhook {hook['id']} -> {HOOK}")

secrets = {"STRIPE_SECRET_KEY": KEY, "STRIPE_WEBHOOK_SECRET": hook["secret"],
           "STRIPE_PRICE_STARTER": ids["starter"], "STRIPE_PRICE_PROFESSIONAL": ids["professional"], "STRIPE_PRICE_ENTERPRISE": ids["enterprise"],
           "STRIPE_PRICE_ONBOARDING": ids["onboarding"], "STRIPE_PORTAL_CONFIGURATION": cfg["id"],
           "NORTHLINE_MIN_MONTHLY_PENCE": str(MINP), "NORTHLINE_APP_URL": APP}
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/secrets", method="POST",
    data=json.dumps([{"name": k, "value": v} for k, v in secrets.items()]).encode(),
    headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req) as r: r.read()
except urllib.error.HTTPError as e:
    sys.exit(f"Setting Supabase secrets failed: HTTP {e.code}. The webhook was created; re-run this script.")
print(f"  Supabase secrets set on {REF}: " + ", ".join(secrets))
PY

if [[ "${SKIP_DEPLOY:-}" != "1" ]]; then
  echo "Redeploying billing functions…"
  cd "$DIR"
  npx -y supabase@latest functions deploy billing-checkout billing-portal --project-ref "$SUPABASE_PROJECT_REF" --use-api --yes >/dev/null
  npx -y supabase@latest functions deploy stripe-webhook --project-ref "$SUPABASE_PROJECT_REF" --use-api --no-verify-jwt --yes >/dev/null
  echo "  deployed billing-checkout, billing-portal, stripe-webhook"
fi
echo "Done."
