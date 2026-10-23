#!/usr/bin/env bash
# Apply every migration, in filename order, to a brand-new database.
# Usage: PGHOST=/tmp PGPORT=55432 ./apply.sh [dbname]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
migrations="$here/../../migrations"
db="${1:-harness}"
export PGUSER="${PGUSER:-postgres}"
dropdb --if-exists "$db"
createdb "$db"
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/stub.sql"
ok=0
for f in $(ls "$migrations"/*.sql | sort); do
  if psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$db" -f "$f" >/tmp/harness-apply.log 2>&1; then
    echo "OK    $(basename "$f")"
    ok=$((ok+1))
  else
    echo "FAIL  $(basename "$f")"
    grep -m3 -E "ERROR" /tmp/harness-apply.log | sed 's/^/      /'
    exit 1
  fi
done
echo "Applied $ok migrations to $db"
