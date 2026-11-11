#!/usr/bin/env bash
# Levanta el entorno E2E local: PostgreSQL (migraciones reales) + PostgREST + función Edge (Deno) + pasarela + frontend.
# Requisitos: postgres en localhost, binario postgrest en $POSTGREST, deno en PATH.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"; WEB="$AQUI/../.."; RAIZ="$WEB/.."
export DB_NAME=rifa_e2e PGHOST=localhost
bash "$RAIZ/db-tests/reset_db.sh" > /dev/null
psql -q -v ON_ERROR_STOP=1 -h localhost -U postgres -d rifa_e2e -f "$AQUI/semilla_e2e.sql"
ANON=$(node "$AQUI/claves.mjs" anon); SERVICIO=$(node "$AQUI/claves.mjs" service_role)
cat > /tmp/pgrst-e2e.conf <<CONF
db-uri = "postgres://authenticator@localhost:5432/rifa_e2e"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "secreto-de-pruebas-e2e-de-al-menos-32-caracteres"
server-port = 3001
db-max-rows = 1000
CONF
pkill -f pgrst-e2e.conf 2>/dev/null || true; pkill -f pasarela.mjs 2>/dev/null || true; pkill -f "subir-comprobante/index.ts" 2>/dev/null || true; pkill -f "vite preview" 2>/dev/null || true
sleep 0.5
nohup "${POSTGREST:-postgrest}" /tmp/pgrst-e2e.conf > /tmp/e2e-postgrest.log 2>&1 &
DENO_SERVE_ADDRESS=tcp:127.0.0.1:8101 SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY="$SERVICIO" SUPABASE_ANON_KEY="$ANON" \
  nohup deno run --allow-net --allow-env "$RAIZ/supabase/functions/subir-comprobante/index.ts" > /tmp/e2e-deno.log 2>&1 &
DB_NAME=rifa_e2e nohup node "$AQUI/pasarela.mjs" > /tmp/e2e-pasarela.log 2>&1 &
cd "$WEB"
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY="$ANON" npx vite build --logLevel error > /dev/null
nohup npx vite preview --port 4173 --strictPort > /tmp/e2e-vite.log 2>&1 &
for i in $(seq 1 60); do
  if curl -sf localhost:4173 >/dev/null && curl -sf localhost:3001 >/dev/null && curl -s localhost:54321 >/dev/null && curl -s 127.0.0.1:8101 >/dev/null; then echo "Entorno E2E listo"; exit 0; fi
  sleep 1
done
echo "El entorno no levantó; revise /tmp/e2e-*.log"; exit 1
