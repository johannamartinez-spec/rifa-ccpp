# Manual de instalación y despliegue

Tiempo estimado: 1,5–2 horas. Todo con planes gratuitos. Use **la cuenta Google institucional de Tesorería**
para crear GitHub, Supabase, Vercel y Resend, así la siguiente tesorera hereda todo.

## 1. Requisitos
- Cuenta de correo institucional de Tesorería (ej. `tesoreria@colegio.cl` o Gmail del CCPP).
- Node.js 20+ y la CLI de Supabase (`npm i -g supabase`) en un computador.

## 2. GitHub
1. Cree una cuenta/organización con el correo institucional y un repositorio **privado** `rifa-ccpp`.
2. Suba el contenido de esta carpeta (`git init && git add . && git commit -m "inicial" && git push`).
3. Verifique que `.gitignore` excluye `.env`. **Nunca** suba claves.

## 3. Supabase
1. Cree un proyecto en https://supabase.com (región São Paulo recomendada). Guarde la contraseña de BD en un gestor de contraseñas institucional.
2. Enlace y aplique migraciones:
   ```bash
   supabase login
   supabase link --project-ref <REF>
   supabase db push            # aplica supabase/migrations/0001…0009 en orden
   ```
   (Alternativa sin CLI: pegue cada archivo de `supabase/migrations` en orden en el SQL Editor.)
3. **Auth → Providers → Email**: habilitado; desactive "Allow new users to sign up" (sólo se invita).
4. **Auth → Policies / Passwords**: mínimo 12 caracteres, exigir minúsculas, mayúsculas, dígitos y símbolos.
5. **Auth → MFA**: verifique TOTP habilitado.
6. **Auth → URL Configuration**: Site URL = `https://<su-app>.vercel.app`; Redirect URLs: `https://<su-app>.vercel.app/admin/activar`.
7. **Database → Extensions**: habilite `pg_cron` y `pg_net`. Luego en SQL Editor:
   ```sql
   select vault.create_secret('https://<REF>.supabase.co', 'project_url');
   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
   ```
   y ejecute `supabase/optional/cron_jobs.sql`.
8. Realtime: la migración 0005 agrega `numeros` y `rifas` a la publicación. Verifíquelo en Database → Publications.

## 4. Primer administrador
1. Auth → Users → **Invite user** con el correo institucional de Tesorería.
2. SQL Editor:
   ```sql
   select interno.crear_primer_superadmin('tesoreria@colegio.cl', 'Tesorería CCPP');
   ```
   Sólo funciona si no hay administradores. Además registra ese correo como cuenta institucional para Drive.
3. Abra el correo de invitación → cree contraseña → configure el autenticador (TOTP).

## 5. Funciones Edge y secretos
```bash
cp supabase/functions/.env.example supabase/functions/.env   # complete valores; NO lo suba a GitHub
openssl rand -base64 32                                       # -> TOKEN_ENC_KEY
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy subir-comprobante procesar-notificaciones drive-oauth drive-sync webpay admin-usuarios
```
`config.toml` desactiva la verificación JWT del gateway porque cada función valida internamente (necesario para las redirecciones de Google y Transbank).

## 6. Correo (Resend, gratis)
1. Cree cuenta en resend.com con el correo institucional; verifique un dominio (registros DNS) o use el remitente de pruebas sólo para ensayos.
2. Cree una API key con permiso "Sending access" → `RESEND_API_KEY`; defina `EMAIL_FROM`.
3. Prueba: en el panel → Notificaciones → "Enviar pendientes ahora".

## 7. Google Drive (cuenta institucional)
1. En https://console.cloud.google.com **con la cuenta institucional**: cree proyecto `rifa-ccpp`.
2. APIs → habilite **Google Drive API**.
3. Pantalla de consentimiento OAuth: tipo *Externo* (o *Interno* si es Google Workspace), agregue la cuenta institucional como usuario de prueba, alcance `.../auth/drive.file`. Publique la app ("En producción") para que el token no expire a los 7 días.
4. Credenciales → ID de cliente OAuth → *Aplicación web* → URI de redirección: `https://<REF>.supabase.co/functions/v1/drive-oauth`.
5. Copie ID y secreto a `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` y vuelva a ejecutar `supabase secrets set`.
6. En el panel → Configuración confirme el correo institucional → Respaldo Drive → **Conectar Google Drive** (inicie sesión con esa cuenta).

## 8. Vercel
1. Cree cuenta con el correo institucional, importe el repositorio de GitHub.
2. *Root Directory*: `web`. Framework: Vite.
3. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (clave **pública**), `VITE_WEBPAY_HABILITADO=false`.
4. Deploy. Copie la URL a: Supabase Auth (paso 3.6), `APP_URL`/`ALLOWED_ORIGINS` (secretos) y panel → Configuración → URL pública.

## 9. Dominio propio (opcional)
Vercel → Project → Domains → agregue `rifa.colegio.cl` y cree el CNAME indicado. Actualice las URLs del paso 8.4.

## 10. GitHub Actions
- `ci.yml` ejecuta las pruebas en cada push.
- `mantener-activo.yml` evita la pausa del plan gratuito: agregue secretos `SUPABASE_URL` y `SUPABASE_ANON_KEY` en GitHub.

## 11. Webpay (sólo con contrato Transbank)
Defina `WEBPAY_HABILITADO=true`, ambiente, código de comercio y llave secreta entregados por Transbank; despliegue `webpay`;
`VITE_WEBPAY_HABILITADO=true` en Vercel. Pruebe primero en ambiente de integración con las credenciales de prueba publicadas por Transbank.

## 12. Ejecutar pruebas localmente
```bash
cd db-tests && npm ci && npm test                       # requiere PostgreSQL 15+ local
cd supabase/functions && deno test _shared/shared_test.ts
cd web && npm ci && npx vitest run
POSTGREST=/ruta/postgrest bash web/e2e/entorno/iniciar.sh && cd web && npx playwright test
```
