# Northline – deployment

Northline is a multi-company (multi-tenant) SaaS for UK hauliers. Static site + app on GitHub Pages,
data on Supabase (London region), card payments through Stripe (see `BILLING.md`).

## What is where

| Path | What it is |
|---|---|
| `index.html`, `assets/` | Sales website (pricing, security, FAQ, Book a demo, Start free trial). Contact details in `assets/site-config.js`. |
| `demo/` | The original offline demo (example data only, no backend). |
| `app/` | The real app. `app/config.js` holds the Supabase URL + public anon key (written by `deploy.sh`). |
| `legal/` | Privacy, terms, DPA and cookie pages. **Templates – must be reviewed by a solicitor before selling.** |
| `supabase/schema.sql` | Base tables, roles, triggers, RLS. Idempotent. |
| `supabase/migrations/001_multitenancy.sql` | Organisations, `org_id` on every table, tenant-isolation RLS, trials, invites, branding, vehicle limits, platform admin, leads. Idempotent; moves existing rows into "Northline (demo)". |
| `supabase/migrations/002_driver_tools.sql` | Walkaround checks, defect reports, proof of delivery, private `driver-uploads` storage bucket, alerts. |
| `supabase/seed.sql` | Example data for the default org only (`example = true`). |
| `supabase/functions/` | Edge Functions `billing-checkout`, `billing-portal`, `stripe-webhook`. |
| `deploy.sh` | Applies schema → migrations → seed in one all-or-nothing request, deploys functions, sets auth URLs, writes `app/config.js`. |
| `supabase/test/`, `tests/local/` | Local test harness only. Never run `auth_stub.sql` or `storage_stub.sql` on a real project. |

## How tenancy works

* Every business row has `org_id`. A *restrictive* `tenant_isolation` policy on every table requires
  `org_id = current_org_id()` (the signed-in user's organisation), on top of the role policies.
  Writes also require the organisation to be writable (trial not expired, not cancelled).
* `profiles` is the membership table (one organisation per user). Roles are per organisation.
* Sign-up paths: **Start free trial** (creates an organisation, 14-day trial, 25-vehicle limit, user is admin),
  **invite link** (joins that organisation with the invited role), anything else gets an "ask for an invite / start a trial" screen.
* Platform admins (`platform_admins` table) see the Platform screen: organisations, plans, trial extensions, demo requests.
  They never see other organisations' operational data.

## Deploy / upgrade

```bash
SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<sbp_token> ./deploy.sh
git add -A && git commit -m "Deploy" && git push origin main
```

Safe to re-run. To upgrade an existing project without touching anything else you can apply only the migrations
(`supabase/migrations/*.sql`) in the SQL editor. **Back up first** (Dashboard › Database › Backups, or export tables).

Auth: Site URL must be the app URL `https://<user>.github.io/northline-os/app/` with redirect allow-list `…/app/**`.
For real customers, set up custom SMTP (Dashboard › Authentication › Emails › SMTP) – Supabase's built-in mailer
is rate-limited to a few emails an hour.

## Tests

`tests/local/README.md` – SQL suites (rls 44, tenant isolation 100, driver tools 16), Deno billing tests (9),
headless-Chrome end-to-end at desktop and iPhone sizes (70).
