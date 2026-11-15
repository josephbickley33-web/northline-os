# Northline – Stripe billing

Until the Stripe secrets below are set, the Billing page says **"Billing not connected yet"** and free trials keep
working normally. Nothing else changes. No Stripe account has been created – the owner must create it.

## Placeholder prices (ex VAT – confirm before launch)

| Plan | Per vehicle / month | Includes |
|---|---|---|
| Starter | £19 | Fleet, MOT/service, stock, staff board, info pages, driver checks/defects/POD |
| Professional | £29 | + AI forecasting, approval queue, alerts |
| Enterprise | £39 | + integrations, custom domain/branding, priority support |

Monthly minimum £149 (enforced by billing at least `ceil(14900 / unit price)` vehicles). Optional one-off onboarding fee.

## What to create in Stripe (Dashboard › Product catalogue)

1. Product **Northline Starter** → price **£19.00 GBP, recurring, monthly, per unit**. Copy the price ID (`price_…`).
2. Product **Northline Professional** → **£29.00**, recurring monthly, per unit. Copy price ID.
3. Product **Northline Enterprise** → **£39.00**, recurring monthly, per unit. Copy price ID.
4. (Optional) Product **Northline onboarding** → one-off price, e.g. £499. Copy price ID.
5. Settings › Billing › **Customer portal** → *Activate* (lets customers update cards, cancel, download invoices).
6. Developers › **Webhooks** › Add endpoint:
   * URL: `https://fgvleepcryfqyrsabfgh.supabase.co/functions/v1/stripe-webhook`
   * Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   * Copy the **Signing secret** (`whsec_…`).
7. Developers › **API keys** → copy the **Secret key** (`sk_live_…`, or `sk_test_…` to try it first).
8. (Optional) Turn on Stripe Tax for UK VAT, then set `STRIPE_AUTOMATIC_TAX=true`.

## Secrets to set in Supabase

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` / `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `STRIPE_PRICE_STARTER` | `price_…` (£19) |
| `STRIPE_PRICE_PROFESSIONAL` | `price_…` (£29) |
| `STRIPE_PRICE_ENTERPRISE` | `price_…` (£39) |
| `STRIPE_PRICE_ONBOARDING` | optional `price_…` |
| `NORTHLINE_MIN_MONTHLY_PENCE` | optional, default `14900` |
| `STRIPE_AUTOMATIC_TAX` | optional `true` |
| `NORTHLINE_APP_URL` | already set to the app URL |

Command line: `npx supabase secrets set --project-ref fgvleepcryfqyrsabfgh STRIPE_SECRET_KEY=sk_… STRIPE_WEBHOOK_SECRET=whsec_… …`

### On an iPhone (no computer needed)

1. Safari → **dashboard.stripe.com** → sign up / sign in → complete business details (needed before live payments).
2. Do steps 1–7 above (tap ☰ menu for Product catalogue, Settings, Developers). Long-press each ID to copy it into Notes.
3. Safari → **supabase.com/dashboard** → project **northline** → **Edge Functions** → **Secrets** (Manage secrets) →
   add each name/value from the table → Save.
4. Open the app → Admin › Billing → it should now show "Choose plan" buttons that open Stripe checkout.
   Use test keys first with card `4242 4242 4242 4242`, any future date, any CVC.

## How it works

* `billing-checkout` (signed-in org admin): creates/reuses the Stripe customer, quantity = max(1, vehicles in use,
  minimum-spend quantity), adds the onboarding line once, returns the Checkout URL.
* `billing-portal` (org admin): opens the Stripe customer portal.
* `stripe-webhook` (no JWT, verified by `whsec_` signature): sets the organisation's plan, status, vehicle limit and
  Stripe IDs. Returns 503 until the secrets exist.
