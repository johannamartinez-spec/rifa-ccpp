#!/usr/bin/env bash
# Recrea la base de pruebas local "rifa_test" y aplica shim + migraciones.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -h ${PGHOST:-localhost} -U ${PGUSER:-postgres}"
DB="${DB_NAME:-rifa_test}"
$PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
$PSQL -d "$DB" -f "$ROOT/db-tests/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "Aplicando $(basename "$f")"
  $PSQL -d "$DB" -f "$f"
done
echo "OK"
