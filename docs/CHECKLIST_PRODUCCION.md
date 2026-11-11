# Checklist de puesta en producción

## Legal (verificar con asesoría; no soy abogado)
- [ ] **Ley 20.851 (2015)**: permite a los centros generales de padres y apoderados realizar rifas de **bienes muebles**,
      en el **ámbito local** y de **carácter no habitual**, sólo con fines **solidarios o de beneficencia** o para financiar los fines propios del CCPP.
      Confirmar que la rifa cumple: premios que sean bienes (evitar premios en dinero), difusión acotada a la comunidad escolar,
      frecuencia ocasional. Una venta online abierta a cualquier persona podría discutirse como fuera del "ámbito local".
- [ ] Si la rifa no calza en la Ley 20.851, tramitar autorización (Ley 10.262 / DS 955, vía Delegación Presidencial o municipalidad según alcance) con la anticipación exigida.
- [ ] Bases publicadas: organizador, fines, fecha y modo de sorteo, premios, plazo de retiro, uso de datos.
- [ ] **Datos personales**: la Ley 21.719 (modifica la Ley 19.628) entra en vigencia el **1 de diciembre de 2026**, salvo que se publique la postergación en trámite (el Senado aprobó en primer trámite moverla al 15-oct-2027). Revisar política de privacidad (`/privacidad`), responsable, plazos de conservación y canal de derechos.
- [ ] Consultar al SII sobre tratamiento tributario si los montos son relevantes.
- [ ] Aprobación de la directiva en acta (uso del sistema, roles, cuenta institucional).

## Cuentas e infraestructura
- [ ] Todas las cuentas (GitHub, Supabase, Vercel, Resend, Google Cloud) creadas con el **correo institucional** y con MFA.
- [ ] Repositorio privado; ningún secreto en Git (`git log -p | grep -i service_role` vacío).
- [ ] Migraciones 0001–0009 aplicadas; `cron_jobs.sql` ejecutado; Vault con `project_url` y `service_role_key`.
- [ ] Auth: registro público desactivado, política de contraseñas, URLs de redirección, TOTP.
- [ ] Secretos de funciones cargados; las 6 funciones desplegadas.
- [ ] Vercel con `VITE_SUPABASE_URL` y clave **pública**; encabezados de seguridad activos (revisar en securityheaders.com).
- [ ] Workflow `mantener-activo` con secretos configurados.

## Configuración funcional
- [ ] Primer superadmin creado y MFA enrolado.
- [ ] Configuración: colegio, centro de padres, contacto, URL pública, cuenta institucional Drive.
- [ ] Drive conectado (estado "Conectado" con la cuenta institucional).
- [ ] Correo de prueba recibido (reservar con un correo propio en una rifa borrador→activa de prueba).
- [ ] **No** cargar `supabase/seed/datos_prueba.sql` en producción; si se usó un proyecto de prueba, crear uno nuevo para producción.

## Prueba de humo en producción (con la directiva)
- [ ] Reservar desde un Android y un iPhone, subir comprobante, ver estado.
- [ ] Dos personas intentan el mismo número a la vez → sólo una lo logra.
- [ ] Aprobar, rechazar y pedir nuevo comprobante.
- [ ] Reserva que vence → números liberados (esperar el plazo o usar una rifa de prueba con 5 minutos).
- [ ] Usuario sin permisos no ve datos personales.
- [ ] Reporte de recaudación cuadra con la cartola.
- [ ] Simulacro de sorteo en una rifa de prueba y verificación pública OK.
- [ ] Archivo aparece en Drive en la carpeta correcta.
- [ ] Eliminar/archivar la rifa de prueba (borrador) o dejarla documentada.
