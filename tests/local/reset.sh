#!/usr/bin/env bash
# LOCAL ONLY: fresh database nl2 (schema + migrations + seed), PostgREST, fake gateway, function server, static site.
cd "$(dirname "$0")"; SITE="$(cd ../.. && pwd)"; PGT=/workspace/pgtest
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='nl2' and pid<>pg_backend_pid()" >/dev/null
pkill -f gateway.js; pkill -f postgrest; pkill -f fn-server.ts; pkill -f "http.server 8766"; sleep 0.5
$P -c "drop database if exists nl2" -c "create database nl2" >/dev/null
$P -d nl2 -f "$SITE/supabase/test/auth_stub.sql" >/dev/null 2>&1
$P -d nl2 -f "$SITE/supabase/test/storage_stub.sql" >/dev/null 2>&1
cat "$SITE/supabase/schema.sql" "$SITE"/supabase/migrations/*.sql "$SITE/supabase/seed.sql" | $P -d nl2 >/dev/null 2>/tmp/nl2.err || { cat /tmp/nl2.err; exit 1; }
$P -d nl2 -c "grant all on all tables in schema public to service_role; grant usage on all sequences in schema public to service_role" >/dev/null
rm -rf /tmp/apptest && mkdir -p /tmp/apptest && (cd "$SITE" && tar --exclude=.git -cf - .) | (cd /tmp/apptest && tar -xf -)
printf 'window.NORTHLINE_CONFIG = { SUPABASE_URL: "http://localhost:54321", SUPABASE_ANON_KEY: "local-anon-key-not-a-jwt" };\n' > /tmp/apptest/app/config.js
(cd $PGT && nohup ./postgrest "$SITE/tests/local/pgrst.conf" > /tmp/pgrst.log 2>&1 &)
(cd $PGT && NODE_PATH=$PGT/node_modules nohup node "$SITE/tests/local/gateway.js" > /tmp/gw.log 2>&1 &)
(SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=local-anon-key-not-a-jwt SUPABASE_SERVICE_ROLE_KEY=local-service-key NORTHLINE_APP_URL=http://localhost:8766/app/ \
  nohup npx -y deno run --allow-net --allow-env "$SITE/tests/local/fn-server.ts" > /tmp/fn.log 2>&1 &)
(cd /tmp/apptest && nohup python3 -m http.server 8766 > /tmp/http.log 2>&1 &)
sleep 3; echo reset-done
