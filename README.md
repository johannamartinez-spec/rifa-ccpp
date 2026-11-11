# RIFA ONLINE CCPP — Sistema de Gestión de Rifas del Centro de Padres y Apoderados

Aplicación web para rifas solidarias: los apoderados eligen números desde el celular sin crear cuenta,
transfieren y suben el comprobante; Tesorería valida pagos, genera reportes y realiza un sorteo auditable y verificable.

**Stack:** React + TypeScript + Vite + MUI · Supabase (PostgreSQL, RLS, Auth+MFA, Storage, Realtime, Edge Functions, pg_cron) · Vercel · Google Drive (OAuth) · Resend.
Todo con planes gratuitos.

## Documentación
- [Arquitectura y modelo de datos](docs/ARQUITECTURA.md)
- [Instalación y despliegue](docs/MANUAL_INSTALACION.md)
- [Manual de Tesorería](docs/MANUAL_TESORERIA.md) · [Manual de sorteo](docs/MANUAL_SORTEO.md) · [Administración](docs/MANUAL_ADMINISTRACION.md)
- [Respaldo y recuperación](docs/MANUAL_RESPALDO_RECUPERACION.md) · [Checklist de producción](docs/CHECKLIST_PRODUCCION.md)
- [Estado del proyecto y pruebas](PROJECT_STATUS.md)

## Pruebas
```bash
cd db-tests && npm ci && npm test                                  # 40 pruebas de BD (PostgreSQL real)
cd supabase/functions && deno test _shared/shared_test.ts          # 14 pruebas de funciones Edge
cd web && npm ci && npx vitest run                                 # 15 pruebas de frontend
POSTGREST=/ruta/postgrest bash web/e2e/entorno/iniciar.sh && (cd web && npx playwright test)   # 6 E2E
```

Variables de ejemplo: `web/.env.example` (públicas) y `supabase/functions/.env.example` (secretos del servidor).
Sitio: https://rifa-ccpp.vercel.app
