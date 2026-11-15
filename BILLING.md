# Northline – Stripe billing

Until the Stripe secrets below are set, the Billing page says **"Billing not connected yet"** and free trials keep
working normally. Nothing else changes. No Stripe account has been created – the owner must create it.

## Set up / re-sync (one command)

```bash
NORTHLINE_STRIPE_SECRET_KEY=sk_test_... SUPABASE_ACCESS_TOKEN=sbp_... EXPECT_STRIPE_ACCOUNT=acct_... ./stripe-setup.sh
```

The script reads `NORTHLINE_STRIPE_SECRET_KEY` first and only falls back to `STRIPE_SECRET_KEY` if that is unset, so other projects on a shared machine that use `STRIPE_SECRET_KEY` can't clash. `EXPECT_STRIPE_ACCOUNT` (optional) makes it refuse any other Stripe account.

It creates or updates, idempotently, in the Stripe account the key belongs to:

| Object | Details |
|---|---|
| Products | `northline_starter`, `northline_professional`, `northline_enterprise` ("Northline Starter/Professional/Enterprise"), `northline_onboarding` |
| Prices (GBP, tax exclusive) | lookup keys `northline_starter` £9, `northline_professional` £15, `northline_enterprise` £25: monthly, per vehicle. `northline_onboarding` £495 one-off ("from £495"; quote larger jobs separately) |
| Customer portal | its own configuration (metadata `northline=1`): cancel at period end, change plan, change number of vehicles, update card, invoice history, billing details |
| Webhook | `https://fgvleepcryfqyrsabfgh.supabase.co/functions/v1/stripe-webhook` for `checkout.session.completed`, `customer.subscription.created`, `.updated` and `.deleted`, and `invoice.created` (deferred pilot onboarding). Re-created on each run, because Stripe only shows the signing secret once |

It then sets these Supabase Edge Function secrets through the Management API and redeploys the functions:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_ENTERPRISE`,
`STRIPE_PRICE_ONBOARDING`, `STRIPE_PORTAL_CONFIGURATION`, `NORTHLINE_MIN_MONTHLY_PENCE` and `NORTHLINE_APP_URL`. It never prints a secret or writes one to a file.

One product per plan is needed because Stripe's customer portal can only switch between, or change the quantity of,
products that each have a single monthly price.

## Pilot offer: half price for 30 days

| Object | Details |
|---|---|
| Coupon `northline_pilot_50_1m` | 50% off the plan, for 1 monthly invoice (30 days). Metadata `pilot=1`. The onboarding fee is not discounted |
| Promotion code `PILOT50` | The customer enters it in the app (Admin › Billing › Pilot code) before choosing a plan |

**Onboarding for pilot customers:** waived if they cancel during the pilot; £495 is added to their first full bill if they continue.

* With a pilot code, `billing-checkout` applies the discount itself, leaves the onboarding line out, and sets subscription metadata `onboarding_deferred=true`.
* When Stripe creates the first renewal invoice (`invoice.created`, `billing_reason=subscription_cycle`, still a draft), `stripe-webhook` adds the onboarding price to it once and sets `onboarding_deferred=false` plus `onboarding_invoice=<invoice id>`.
* If the customer cancels during the pilot, no renewal invoice is created, so onboarding is never charged.
* Stripe's own promotion-code box is switched off at Checkout, so the pilot can only be applied through the app, where onboarding is handled. Non-pilot checkouts are otherwise unchanged: plan plus onboarding on the first invoice.
* Changing the pilot length: `PILOT_MONTHS=2 ./stripe-setup.sh` creates `northline_pilot_50_2m`, moves `PILOT50` to it and deletes the old pilot coupons. Customers already on a pilot keep their discount.

## Monthly minimum (£149)

This is enforced as a **minimum number of billed vehicles**: `ceil(£149 / unit price)`.

| Plan | Price | Minimum vehicles | Minimum monthly charge |
|---|---|---|---|
| Starter | £9 | 17 | £153 |
| Professional | £15 | 10 | £150 |
| Enterprise | £25 | 6 | £150 |

* Checkout bills `max(vehicles in use, minimum)`, and the customer's vehicle limit equals the billed quantity, so the extra £1 to £4 buys real vehicle slots.
* If a customer lowers the quantity below the minimum in the portal, the webhook sets it back, with no proration.
* Why not exactly £149: that needs Stripe volume-tiered prices (a flat £149 up to N−1 vehicles, then per vehicle). Tiered prices have no single
  unit price, so checkout, the portal's quantity control, the billing page and the webhook's minimum logic would all need special handling,
  and Checkout would show a confusing "flat fee" line. With these prices the difference is at most £4 a month, so the simpler,
  already-tested approach was kept.

## Test mode

While the key starts with `sk_test_`, the app's billing page shows **"Test mode: no real money"**.
Test card: 4242 4242 4242 4242, any future date, any CVC.

## Going live

1. In Stripe, finish account activation (business details and bank account), then turn on live mode.
2. Developers › API keys (live) › copy the **Secret key** (`sk_live_…`). A restricted key also works if it has write access to
   Products, Prices, Customers, Checkout Sessions, Subscriptions, Customer portal and Webhook endpoints.
3. Run `NORTHLINE_STRIPE_SECRET_KEY=sk_live_... SUPABASE_ACCESS_TOKEN=sbp_... EXPECT_STRIPE_ACCOUNT=acct_... ./stripe-setup.sh`. This creates the live objects and switches
   Supabase to them. The test-mode banner goes away by itself.
4. Optional: turn on Stripe Tax for UK VAT, then add the Supabase secret `STRIPE_AUTOMATIC_TAX=true`.
5. Optional: Settings › Business › public details: set the business name customers see. The test account currently shows
   "Northline logistics syatem", which is a typo.

## How it works

* `billing-checkout` (signed-in org admin): creates or reuses the Stripe customer, sets quantity = max(vehicles in use, minimum),
  adds the onboarding line once, and returns the Checkout URL. `{action:"status"}` returns configured, prices and test_mode.
* `billing-portal` (org admin): opens the Stripe customer portal with the Northline configuration.
* `stripe-webhook` (no JWT, verified by the `whsec_` signature): sets the organisation's plan, status, vehicle limit and Stripe IDs,
  and puts the monthly minimum back if needed. It returns 503 until the secrets exist.
