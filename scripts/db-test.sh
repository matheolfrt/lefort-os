#!/usr/bin/env bash
# Applies all migrations to a throwaway database and runs the SQL test suite.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/db-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=lefort_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done
psql -q -t -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/domain_test.sql >/dev/null
# Vinted sync runs on its own fresh database
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}_vinted" -c "create database ${DB}_vinted"
psql -q -v ON_ERROR_STOP=1 -d ${DB}_vinted -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d ${DB}_vinted -f "$f"
done
psql -q -t -v ON_ERROR_STOP=1 -d ${DB}_vinted -f supabase/tests/vinted_test.sql >/dev/null
echo "DB tests passed"
