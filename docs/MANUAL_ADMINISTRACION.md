# Manual de administración (superadministrador)

## Roles por defecto
| Rol | Permisos iniciales |
|---|---|
| Superadministrador | Todo, incluido usuarios y permisos |
| Tesorera | Todo excepto gestionar usuarios |
| Presidenta | Ver rifas y reportes (sin datos personales) |
| Secretaria | Ver rifas y registrar entrega de premios |
| Auditor | Sólo lectura de todo (incluida bitácora), sin modificar |

La directiva puede ampliar o reducir en **Usuarios y roles → Permisos por rol** (cambios inmediatos, quedan en bitácora).
Permisos: `rifas.ver`, `rifas.gestionar`, `numeros.bloquear`, `compradores.ver`, `pagos.ver`, `pagos.validar`,
`sorteos.ejecutar`, `premios.entregar`, `reportes.ver`, `usuarios.gestionar`, `configuracion.gestionar`,
`auditoria.ver`, `drive.gestionar`, `notificaciones.gestionar`.

## Usuarios
- **Invitar usuario**: llega un correo para crear contraseña; luego configura el autenticador (MFA).
- **Desactivar**: bloquea el ingreso de inmediato (incluye sesiones abiertas). Nadie puede cambiar su propio rol ni desactivarse; siempre debe quedar al menos un administrador con gestión de usuarios.
- Use correos institucionales por cargo cuando sea posible.

## Recuperación de cuentas
- Contraseña olvidada: "¿Olvidó su contraseña?" en `/admin/ingresar`.
- Perdió el autenticador: un superadmin en Supabase → Auth → Users → el usuario → eliminar factor MFA; al ingresar volverá a enrolarse. Registre el motivo en acta.

## Configuración
- Datos institucionales, URL pública, cuenta institucional de Drive, meses de conservación de datos.
- **MFA obligatorio**: mantenerlo activo.

## Notificaciones
Activar/desactivar correo, WhatsApp y cada tipo de aviso; historial con errores; reintentos.
WhatsApp sólo funciona con la API oficial de Meta y plantillas aprobadas; sin eso los avisos quedan "omitidos". No se usan automatizaciones no oficiales.

## Bitácora
Registro inmutable: usuario, operación, fecha, valores anteriores y nuevos, identificador del registro.

## Protección de datos
- Solicitudes de acceso/rectificación: responder con los datos de *Compradores*.
- Supresión: Compradores → *Suprimir datos* (anonimiza; conserva cifras).
- Conservación automática mensual según "meses de conservación" (tarea `ccpp-conservacion`).
