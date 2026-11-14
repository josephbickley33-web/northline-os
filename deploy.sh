#!/usr/bin/env bash
# Northline: load the database into a Supabase project and write app/config.js.
#
# Usage:
#   SUPABASE_PROJECT_REF=abcdefghijklmnopqrst SUPABASE_ACCESS_TOKEN=sbp_xxx ./deploy.sh
#
# Required environment:
#   SUPABASE_PROJECT_REF   The project ref (the part before .supabase.co in the project URL).
#   SUPABASE_ACCESS_TOKEN  A Supabase personal access token (Dashboard > Account > Access Tokens).
# Optional:
#   SITE_URL          Where the app is published. Default: https://josephbickley33-web.github.io/northline-os/app/
#   SKIP_SEED=1       Do not load the example data in supabase/seed.sql.
#   SKIP_AUTH_CONFIG=1  Do not set the auth Site URL / redirect allow-list.
#   SUPABASE_API_BASE Override the Management API base URL (used only for local testing).
#
# Uses the Supabase Management API (checked November 2026):
#   POST  /v1/projects/{ref}/database/query      run SQL            body {"query": "..."}
#   GET   /v1/projects/{ref}                      project details
#   GET   /v1/projects/{ref}/api-keys?reveal=true anon / publishable keys
#   PATCH /v1/projects/{ref}/config/auth          site_url, uri_allow_list
#
# Publishing (after this script succeeds):
#   git add app/config.js && git commit -m "Connect Northline to Supabase"
#   git push origin real-backend
#   Then merge real-backend into main (GitHub > Pull requests > New > base: main, compare: real-backend > Merge),
#   or from a terminal:  git checkout main && git merge --no-ff real-backend && git push origin main
#   GitHub Pages republishes main within a minute or two. The connected app is at SITE_URL;
#   the original demo stays at the site root.
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF (the project ref)}"
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (a Supabase personal access token)}"
API="${SUPABASE_API_BASE:-https://api.supabase.com}"
SITE_URL="${SITE_URL:-https://josephbickley33-web.github.io/northline-os/app/}"
REF="$SUPABASE_PROJECT_REF"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
[[ "$REF" =~ ^[a-z0-9]{10,40}$ ]] || { echo "SUPABASE_PROJECT_REF looks wrong: '$REF'" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

api() { # method path [body-file]  -> prints body, fails on HTTP >= 300
  local method="$1" path="$2" body="${3:-}" code
  local args=(-sS -X "$method" "$API$path" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -o "$TMP/out" -w "%{http_code}")
  [[ -n "$body" ]] && args+=(--data-binary "@$body")
  code="$(curl "${args[@]}")" || { echo "Network error calling $path" >&2; return 1; }
  if [[ "$code" -ge 300 ]]; then
    echo "Management API $method $path failed with HTTP $code:" >&2; cat "$TMP/out" >&2; echo >&2; return 1
  fi
  cat "$TMP/out"
}

run_sql_file() {
  local file="$1"
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1], encoding="utf-8").read()}))' "$file" > "$TMP/q.json"
  api POST "/v1/projects/$REF/database/query" "$TMP/q.json" > /dev/null
}

echo "1/5 Checking project $REF…"
api GET "/v1/projects/$REF" > "$TMP/project.json"
STATUS="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$TMP/project.json")"
echo "    status: ${STATUS:-unknown}"
SUPABASE_URL="https://$REF.supabase.co"

echo "2/5 Applying supabase/schema.sql…"
run_sql_file "$DIR/supabase/schema.sql"

if [[ "${SKIP_SEED:-}" == "1" ]]; then
  echo "3/5 Skipping example data (SKIP_SEED=1)"
else
  echo "3/5 Loading example data from supabase/seed.sql…"
  run_sql_file "$DIR/supabase/seed.sql"
fi

echo "4/5 Fetching the public (anon) API key…"
api GET "/v1/projects/$REF/api-keys?reveal=true" > "$TMP/keys.json"
ANON_KEY="$(python3 - "$TMP/keys.json" <<'PY'
import json, sys
keys = json.load(open(sys.argv[1]))
pick = next((k for k in keys if k.get("name") == "anon" and k.get("api_key")), None) \
    or next((k for k in keys if k.get("type") == "publishable" and k.get("api_key")), None)
if not pick:
    sys.exit("No anon or publishable key found in the API response")
print(pick["api_key"])
PY
)"
case "$ANON_KEY" in sb_secret_*|*service_role*) echo "Refusing to write a secret key to config.js" >&2; exit 1;; esac

if [[ "${SKIP_AUTH_CONFIG:-}" == "1" ]]; then
  echo "    Skipping auth URL settings (SKIP_AUTH_CONFIG=1)"
else
  echo "    Setting auth Site URL and redirect allow-list to $SITE_URL"
  python3 -c 'import json,sys; print(json.dumps({"site_url": sys.argv[1], "uri_allow_list": sys.argv[1] + "**"}))' "$SITE_URL" > "$TMP/auth.json"
  api PATCH "/v1/projects/$REF/config/auth" "$TMP/auth.json" > /dev/null \
    || echo "    WARNING: could not update auth settings. Set Site URL to $SITE_URL in Dashboard > Authentication > URL Configuration." >&2
fi

echo "5/5 Writing app/config.js…"
python3 - "$DIR/app/config.js" "$SUPABASE_URL" "$ANON_KEY" <<'PY'
import json, sys
path, url, key = sys.argv[1:4]
open(path, "w", encoding="utf-8").write(
"""// Northline connection settings, written by deploy.sh.
// The anon (public) key is designed to be shipped to browsers; Row Level Security protects the data.
// Never put the service_role key or a personal access token here.
window.NORTHLINE_CONFIG = {
  SUPABASE_URL: %s,
  SUPABASE_ANON_KEY: %s
};
""" % (json.dumps(url), json.dumps(key)))
PY

cat <<MSG

Done. Database loaded and app/config.js now points at $SUPABASE_URL.

Next:
  1. git add app/config.js && git commit -m "Connect Northline to Supabase" && git push origin real-backend
  2. Merge real-backend into main on GitHub to publish. The app will be at:
       $SITE_URL
  3. Open it and tap Create account. The FIRST account becomes the admin; everyone after waits for approval.
MSG
