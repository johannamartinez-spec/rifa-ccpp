# Manual de respaldo y recuperación

## Qué se respalda automáticamente
| Qué | Dónde | Frecuencia |
|---|---|---|
| Comprobantes, actas, reportes guardados, evidencias | Google Drive institucional `CENTRO_DE_PADRES/RIFAS/AAAA/RIFA_XXX/{COMPROBANTES,REPORTES,GANADORES,EVIDENCIAS,ACTAS}` | cada 15 min (`drive-sync`) |
| Código fuente | GitHub (repositorio privado) | cada cambio |

Cada archivo en Drive lleva en su descripción y propiedades: rifa, fecha, código de reserva, identificador del documento,
tipo de evidencia y SHA-256. Los reintentos no duplican archivos (búsqueda por `ccpp_respaldo_id`).
Si Drive no está conectado, todo queda "pendiente" y se sube al reconectar. Estado en **Respaldo Drive**.

## Respaldo de la base de datos (manual, mensual y al cerrar cada rifa)
El plan gratuito de Supabase no ofrece descargas de respaldos automáticos. Haga:
```bash
supabase db dump --linked -f respaldo_esquema_$(date +%F).sql
supabase db dump --linked --data-only -f respaldo_datos_$(date +%F).sql
```
Suba ambos archivos a Drive institucional en `CENTRO_DE_PADRES/RESPALDOS_BD/` (contienen datos personales: carpeta no compartida).
Además, al cerrar cada rifa exporte los reportes (Excel) y guárdelos en Drive.

## Recuperación ante fallas
| Situación | Acción |
|---|---|
| Proyecto Supabase pausado por inactividad | Dashboard de Supabase → *Restore project*. Verifique el workflow `mantener-activo`. |
| Sitio caído en Vercel | Vercel → Deployments → *Redeploy* del último despliegue correcto (*Promote*). |
| Error tras un cambio de código | Revertir el commit en GitHub; Vercel redespliega. |
| Base de datos perdida/corrupta | Crear proyecto nuevo → `supabase db push` → `psql < respaldo_datos_*.sql` → volver a configurar secretos, cron y Vault → actualizar variables en Vercel. Los archivos se recuperan desde Drive. |
| Drive desconectado o token revocado | Respaldo Drive → *Conectar* con la cuenta institucional; luego *Reintentar con error*. |
| Correos no salen | Notificaciones → historial de errores; revisar `RESEND_API_KEY`, dominio, límite diario. |
| Clave `service_role` filtrada | Supabase → Settings → API → rotar claves; actualizar Vault y secretos; redeploy de funciones. |
| Cuenta de administrador comprometida | Desactivar en Usuarios y roles; revisar la bitácora; cambiar contraseñas institucionales. |

## Simulacro recomendado (una vez al año)
Restaurar el último respaldo en un proyecto de prueba y verificar que los reportes cuadran con la cartola.
