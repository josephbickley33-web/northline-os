# Northline – connected version (Supabase)

Branch `real-backend`. The live demo on `main` is untouched until this branch is merged.

## What is here

| Path | What it is |
|---|---|
| `index.html` | The original demo (unchanged). |
| `app/` | The connected app: `index.html`, `app.js`, `styles.css` + `app.css`, `config.js`, icons. Static files, works on GitHub Pages and iOS Safari. |
| `app/config.js` | `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Placeholders until `deploy.sh` runs; the app shows "not connected yet" until then. |
| `supabase/schema.sql` | Tables, role helpers, triggers, Row Level Security policies, grants, realtime. Idempotent. |
| `supabase/seed.sql` | Illustrative example data, every row flagged `example = true`. Idempotent. |
| `deploy.sh` | Applies schema + seed via the Management API, fetches URL + anon key, sets auth redirect URLs, writes `app/config.js`. |
| `supabase/test/`, `tests/local/` | Local-only test harness. Never run `auth_stub.sql` on a real project. |

## What is needed from the owner

1. A Supabase project (free tier is fine; choose region **West EU (London)** for UK data residency).
2. Its **project ref** – the 20-character id in the project URL `https://<ref>.supabase.co`.
3. A **personal access token** – Supabase Dashboard › Account › Access Tokens › Generate (starts `sbp_`).
   It is only used by `deploy.sh`; it is never written into the site.

The anon key and URL are fetched automatically.

## Deploy

```bash
SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<sbp_token> ./deploy.sh
git add app/config.js && git commit -m "Connect Northline to Supabase" && git push origin real-backend
```

Then merge `real-backend` into `main` (GitHub › Pull requests › New pull request › base `main`, compare `real-backend` › Merge).
GitHub Pages republishes within a couple of minutes. The connected app is at
`https://josephbickley33-web.github.io/northline-os/app/`; the demo stays at the root.

Open the app and **Create account first** – the first account becomes the active admin. Everyone after that signs up
and waits on the "pending approval" screen until an admin approves them in Admin › Members and sets their role.

## Notes

- Supabase confirms email addresses by default. Its built-in mailer is rate-limited (a few emails per hour); for a
  real rollout add SMTP under Authentication › Emails, or switch off "Confirm email" while onboarding staff.
- Roles and access match the demo: admin, duty, planner, workshop, warehouse, driver. Drivers only ever see their own
  jobs and hours. All AI approvals go through `decide_ai()`, which writes to the append-only `audit_log`.
- Admin › Data: CSV import for vehicles, jobs and stock (with templates) and "Remove all example data".
- Realtime: `board_posts`, `board_replies`, `jobs`, `ai_decisions`.
