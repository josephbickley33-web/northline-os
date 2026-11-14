P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='nl2' and pid<>pg_backend_pid()" >/dev/null
pkill -f gateway.js; pkill postgrest; sleep 0.5
$P -c "drop database if exists nl2" -c "create database nl2" && $P -d nl2 -f ../../supabase/test/auth_stub.sql 2>/dev/null && $P -d nl2 -f ../../supabase/schema.sql 2>/dev/null && $P -d nl2 -f ../../supabase/seed.sql
nohup ./postgrest pgrst.conf > /tmp/pgrst.log 2>&1 &
nohup node gateway.js > /tmp/gw.log 2>&1 &
sleep 1.5; echo reset-done
