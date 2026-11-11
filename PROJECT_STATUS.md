# PROJECT_STATUS — RIFA ONLINE CCPP

Última actualización: 2026-11-11

## Módulos terminados (código + pruebas ejecutadas)
| Módulo | Estado |
|---|---|
| Base de datos: 26 tablas, RLS en todas, funciones, triggers, auditoría inmutable | ✅ probado (PostgreSQL 16) |
| Reserva pública transaccional, anti-duplicidad, liberación de vencidas, límites antiabuso | ✅ probado (60 compradores simultáneos) |
| Comprobantes: validación servidor (firma binaria, MIME, PDF activo, políglotas), bucket privado | ✅ probado (Deno + E2E) |
| Validación por Tesorería: aprobar, rechazar, pedir nuevo, manual, cancelar, revertir | ✅ probado |
| Panel: dashboard + gráficos, rifas, premios, números, compradores, pagos, reportes, usuarios/roles, bitácora, configuración | ✅ compila; flujos clave probados E2E |
| Roles y permisos editables, MFA TOTP obligatorio configurable | ✅ permisos y claim aal probados en BD |
| Sorteo: padrón congelado, compromiso de semilla, ejecución en servidor, inmutable, verificación en navegador, transmisión, acta PDF, entregas | ✅ probado |
| Reportes Excel/PDF (12 tipos, filtros fecha/rifa/curso, sólo pagos confirmados, ajustes) | ✅ probado |
| Notificaciones: cola, 8 tipos, activables, historial, reintentos (Resend) | ✅ lógica probada con proveedor simulado |
| Respaldo Google Drive: OAuth institucional, token cifrado, carpetas, idempotencia, panel de estado | ✅ lógica probada con Drive simulado |
| Webpay Plus (preparado, deshabilitado) | ⚠️ implementado, probado sólo con Transbank simulado |
| WhatsApp Cloud API (preparado, deshabilitado) | ⚠️ implementado, no probado contra Meta |
| Privacidad: política, supresión/anonimización, conservación automática | ✅ probado |
| Documentación: arquitectura, instalación, administración, tesorería, sorteo, respaldo, checklist | ✅ |

## Pruebas realizadas (todas ejecutadas el 2026-11-11)
- **Base de datos** (`db-tests/`, Vitest + PostgreSQL 16 real con capa Supabase): **40/40**, repetido 6 veces sin fallos. Incluye casos 1–16 y lista blanca de privilegios.
- **Funciones Edge** (`supabase/functions/_shared/shared_test.ts`, Deno 2.9): **14/14**; `deno check` de las 6 funciones sin errores.
- **Frontend** (Vitest + Testing Library): **15/15**; TypeScript estricto sin errores; build de producción OK.
- **E2E** (Playwright, Chrome con perfil Pixel 7, contra PostgreSQL + PostgREST 12.2.12 + función Edge real en Deno): **6/6**, casos 1–16 y 18.
- Caso 17 (Drive): probado con Drive simulado; **la conexión real no se pudo probar** (requiere la cuenta Google institucional).

## Errores encontrados y corregidos durante las pruebas
1. Funciones creadas después de la revocación de privilegios quedaban ejecutables por visitantes (incl. la cola de notificaciones con correos). → Migración 0009 de lista blanca + prueba automática.
2. Columna ambigua en `dashboard_resumen`.
3. Menú lateral en celular no se cerraba al navegar (bloqueaba la pantalla).
4. Condición de carrera tras el login: usuarios válidos veían "sin acceso" antes de cargar permisos.
5. Dependencias vulnerables: jsPDF (crítica), zod (alta), React Router (moderada) actualizadas.

## Pendiente / requiere al administrador
- Crear cuentas y desplegar (Supabase, Vercel, GitHub, Resend, Google Cloud) — ver `docs/MANUAL_INSTALACION.md`. **La aplicación no está publicada aún**: requiere sus cuentas.
- Conectar y probar Drive real y correo real con las cuentas institucionales.
- Revisión legal (Ley 20.851, Ley 21.719) — `docs/CHECKLIST_PRODUCCION.md`.
- 2 vulnerabilidades moderadas restantes en `exceljs` → `uuid` (no explotables en el uso actual: sólo generación de Excel en el panel); revisar cuando exceljs publique versión corregida.
- No probado: Realtime real de Supabase (en E2E se usa el respaldo por consulta periódica), MFA TOTP real (Supabase Auth), iPhone/Safari.

## Decisiones técnicas
- `numeros` sin datos personales → lectura pública y Realtime seguros.
- Liberación de reservas doble: pg_cron + perezosa (correcta aunque el cron falle).
- Plazo se detiene al enviar comprobante (Tesorería puede tardar).
- Compradores sin cuenta: consulta con código no adivinable (≈40 bits) + teléfono, con límite por IP.
- Sorteo commit-reveal con entropía externa; SQL y TypeScript verificados idénticos.
- Alcance Drive `drive.file` (mínimo) y bloqueo de cuentas no institucionales.
- Webpay y WhatsApp deshabilitados por defecto (costo/contrato); transferencia es la modalidad funcional.

## Próximos pasos
1. Seguir `docs/MANUAL_INSTALACION.md`. 2. Prueba de humo con la directiva (checklist). 3. Primera rifa real.
