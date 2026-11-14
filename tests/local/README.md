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
