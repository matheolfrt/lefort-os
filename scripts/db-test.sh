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
# Production board on its own fresh database
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}_prod" -c "create database ${DB}_prod"
psql -q -v ON_ERROR_STOP=1 -d ${DB}_prod -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d ${DB}_prod -f "$f"
done
psql -q -t -v ON_ERROR_STOP=1 -d ${DB}_prod -f supabase/tests/production_test.sql >/dev/null
# Objectives and to-dos on their own fresh database
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}_goals" -c "create database ${DB}_goals"
psql -q -v ON_ERROR_STOP=1 -d ${DB}_goals -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d ${DB}_goals -f "$f"
done
psql -q -t -v ON_ERROR_STOP=1 -d ${DB}_goals -f supabase/tests/goals_todos_test.sql >/dev/null
# Suppliers on their own fresh database
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}_sup" -c "create database ${DB}_sup"
psql -q -v ON_ERROR_STOP=1 -d ${DB}_sup -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d ${DB}_sup -f "$f"
done
psql -q -t -v ON_ERROR_STOP=1 -d ${DB}_sup -f supabase/tests/suppliers_test.sql >/dev/null
echo "DB tests passed"
