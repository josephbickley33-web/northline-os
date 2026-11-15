# Local test harness (not used in production)

Used to test Northline without a Supabase project:

- `../../supabase/test/auth_stub.sql` – minimal stand-ins for Supabase's `auth` schema, roles and realtime publication.
- `../../supabase/test/rls_test.sql` – 40+ assertions on roles, RLS, triggers, the AI decision function and the append-only audit log.
- `pgrst.conf` + PostgREST 16 – the same REST layer Supabase uses.
- `gateway.js` – fake Supabase gateway/GoTrue (email+password sign-up/sign-in, JWTs) in front of PostgREST. No realtime.
- `e2e.js` – headless Chrome (puppeteer-core) run through sign-up, admin bootstrap, every view, AI approval → audit,
  pending approval, driver isolation, board post, CSV import, sign-out. Desktop and iPhone 13 viewports.
- `mgmt-mock.js` – fake Management API to exercise `deploy.sh` end to end.
- `shot.js` – screenshot + console-error check for a URL.

Requires a local Postgres 17 on socket /tmp port 54329, Node 18+, `npm i pg puppeteer-core`, and Chrome at /usr/bin/google-chrome.

## SaaS additions

- `../../supabase/test/storage_stub.sql` – minimal `storage` schema so migration 002 can be tested.
- `../../supabase/test/tenant_test.sql` – 100 tenant-isolation assertions (two orgs, every table, every role, RPCs, triggers, limits, trials, invites).
- `../../supabase/test/driver_test.sql` – 16 assertions for walkaround checks, defects, proof of delivery and storage paths.
- `sqltest.sh` – runs all SQL suites on a fresh database.
- `fn-server.ts` – serves the Edge Functions locally with Deno on :54339 (proxied by `gateway.js` at `/functions/v1/*`).
- `reset.sh` – rebuilds the local DB (stubs → schema → migrations → seed) and copies the site to /tmp/apptest (:8766).

Run: `./reset.sh && ./sqltest.sh && (cd /workspace/pgtest && node /workspace/site/tests/local/e2e.js)` and
`cd ../../supabase/functions && npx -y deno test --allow-env tests/`.
