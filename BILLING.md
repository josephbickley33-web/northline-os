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
| Prices (GBP, tax exclusive) | lookup keys `northline_starter` £19, `northline_professional` £29, `northline_enterprise` £39: monthly, per vehicle. `northline_onboarding` £495 one-off |
| Customer portal | its own configuration (metadata `northline=1`): cancel at period end, change plan, change number of vehicles, update card, invoice history, billing details |
| Webhook | `https://fgvleepcryfqyrsabfgh.supabase.co/functions/v1/stripe-webhook` for `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`. Re-created on each run, because Stripe only shows the signing secret once |

It then sets these Supabase Edge Function secrets through the Management API and redeploys the functions:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_ENTERPRISE`,
`STRIPE_PRICE_ONBOARDING`, `STRIPE_PORTAL_CONFIGURATION`, `NORTHLINE_MIN_MONTHLY_PENCE` and `NORTHLINE_APP_URL`. It never prints a secret or writes one to a file.

One product per plan is needed because Stripe's customer portal can only switch between, or change the quantity of,
products that each have a single monthly price.

## Monthly minimum (£149)

This is enforced as a **minimum number of billed vehicles**: `ceil(£149 / unit price)`.

| Plan | Minimum vehicles | Minimum monthly charge |
|---|---|---|
| Starter | 8 | £152 |
| Professional | 6 | £174 |
| Enterprise | 4 | £156 |

* Checkout bills `max(vehicles in use, minimum)`.
* If a customer lowers the quantity below the minimum in the portal, the webhook sets it back to the minimum, with no proration.
* The real minimum is therefore £3 to £25 above £149. To make it exactly £149, switch each plan to a Stripe *volume-tiered* price
  (tier 1: up to N vehicles with a flat £149 and £0 per unit; tier 2: per unit at the plan price). That is not done yet.

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
