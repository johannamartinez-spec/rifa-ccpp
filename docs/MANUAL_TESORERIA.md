# Manual de Tesorería

## Rutina diaria (5–10 minutos)
1. Ingrese a `/admin` con su correo, contraseña y código del autenticador.
2. **Resumen**: revise "Comprobantes por revisar".
3. **Pagos y comprobantes → Por revisar**: abra cada reserva (más antiguas primero).
4. Pulse **Ver** en el comprobante y compare con la **cartola bancaria**: monto exacto, fecha, cuenta de destino y código en el comentario.
5. Decida:
   - **Aprobar pago**: los números pasan a *Vendido* y el apoderado recibe confirmación. Queda registrado que usted aprobó.
   - **Rechazar / pedir otro**: escriba el motivo.
     - Marcando *Solicitar un nuevo comprobante*: los números siguen reservados con un nuevo plazo.
     - Sin marcar: rechazo definitivo; los números se liberan.
   - Si el abono **no aparece aún** en la cartola, deje la reserva en revisión y vuelva más tarde.

## Casos especiales
- **Pago en efectivo** o transferencia vista en cartola sin comprobante: abra la reserva → *Confirmar pago manual* → método, N° de operación/recibo y justificación (obligatoria). Aparece en el reporte de *Ajustes*.
- **Aprobé por error**: *Revertir pago (ajuste)* con justificación. Sólo antes de congelar el padrón. Queda en *Ajustes* y en la bitácora.
- **Apoderado pide anular**: *Cancelar reserva* con motivo (libera números). Si ya pagó, coordine la devolución fuera del sistema y use *Revertir pago*.
- **Bloquear números** (p. ej. reservados para donantes): Rifas → la rifa → Números → "1, 5, 10-20" + motivo.
- **Pago Webpay sobre reserva vencida** (si se habilita Webpay): aparece en la bitácora como `PAGO_SOBRE_RESERVA_NO_VIGENTE`; gestione devolución o asignación manual.

## Crear y publicar una rifa
1. Rifas → **Nueva rifa**: nombre, precio, rango (máx. 10.000 números), fecha del sorteo, minutos para pagar (30 sugerido), bases, instrucciones de pago (sólo datos para transferir: banco, tipo y N° de cuenta, RUT, correo; **nunca** claves).
2. Guarde (queda en borrador, invisible). Suba afiche y premios con fotos (el orden define el lugar).
3. **Publicar**. Desde la primera reserva no se puede cambiar el precio ni reducir el rango.
4. Comparta el enlace `https://…/rifa/<id>` en los grupos de apoderados.

## Reportes
Reportes → elija tipo, rifa, fechas, curso → **Generar** → Excel o PDF. Recaudación considera **sólo pagos confirmados**.
"Guardar en documentos y Drive" lo deja respaldado en `REPORTES/` de la rifa.

## Rendición de cuentas
Al cierre de cada rifa genere: *Recaudación*, *Pagos confirmados*, *Ajustes*, *Ganadores*, *Premios entregados*, y el acta del sorteo. Todos quedan en Drive.

## Traspaso a la nueva tesorera
1. La saliente (superadmin) invita a la nueva en **Usuarios y roles** con rol *Tesorera* (o *Superadministrador*).
2. Entregue la cuenta institucional (correo + Drive + GitHub + Supabase + Vercel + Resend) cambiando contraseñas y el segundo factor de esas cuentas en presencia de la directiva.
3. La nueva tesorera verifica que puede ingresar y que Drive sigue "Conectado".
4. Desactive la cuenta de la saliente en **Usuarios y roles** (bloquea el acceso y las sesiones abiertas).
5. Deje constancia en acta de directiva. Toda la historia queda en la bitácora.
