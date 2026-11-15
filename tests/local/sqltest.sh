#!/usr/bin/env bash
# LOCAL ONLY: run the SQL test suites on throwaway databases.
set -e
cd "$(dirname "$0")/../.."
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
run() { # db, test file
  $P -c "drop database if exists $1" -c "create database $1" >/dev/null 2>&1
  $P -d $1 -f supabase/test/auth_stub.sql >/dev/null 2>&1
  [ -f supabase/test/storage_stub.sql ] && $P -d $1 -f supabase/test/storage_stub.sql >/dev/null 2>&1
  cat supabase/schema.sql supabase/migrations/*.sql supabase/seed.sql | $P -d $1 >/dev/null 2>/tmp/$1.err || { cat /tmp/$1.err; exit 1; }
  $P -d $1 -f "$2" 2>&1 | grep -E "PASS|FAIL|ERROR|PASSED" > /tmp/$1.out || true
  echo "$2: $(grep -c PASS /tmp/$1.out) passed, $(grep -c -E 'FAIL|ERROR' /tmp/$1.out) failed"; grep -E "FAIL|ERROR" /tmp/$1.out || true; grep PASSED /tmp/$1.out || true
}
run nl_rls supabase/test/rls_test.sql
run nl_tenant supabase/test/tenant_test.sql
for f in supabase/test/[a-z]*_test.sql; do case "$f" in *rls_test.sql|*tenant_test.sql) ;; *) run nl_extra "$f";; esac; done
