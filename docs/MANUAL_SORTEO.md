# Manual del sorteo

## Antes del día
1. Panel → **Sorteos y premios** → elija la rifa → **Cerrar ventas** (o desde la ficha de la rifa).
2. Resuelva todo en **Pagos**: no deben quedar reservas "por revisar" ni "esperando pago" (las vigentes vencerán solas).
   Si decide congelar igual, marque *forzar*: esas reservas quedan excluidas y se informa en el acta.
3. Defina cantidad de ganadores (por defecto, uno por premio) y si un número puede ganar más de un premio.
4. **Congelar padrón**. Se publican:
   - Huella del padrón (SHA-256) y lista de números participantes.
   - **Compromiso de la semilla**. Publíquelo en el grupo de apoderados *antes* del sorteo (captura de pantalla).
   Desde aquí nadie puede cambiar participantes, premios ni pagos.

## Durante el sorteo (transmisión)
1. Abra la **pantalla de transmisión** (`/sorteo/<id>`) en el proyector o transmisión en vivo → *Pantalla completa*.
2. Pida a un apoderado o al ministro de fe que genere la **entropía externa** a la vista de todos (p. ej. lanzar 3 dados, o leer los números de un sorteo oficial del día). Escríbala exactamente.
3. En otro dispositivo (panel): ingrese la entropía → **Ejecutar sorteo** → *Sortear ahora*.
4. La pantalla muestra la animación y revela los ganadores uno a uno. **La animación no decide nada**: el servidor ya calculó el resultado.

## Después
1. Ingrese testigos/ministro de fe → **Generar acta PDF** (se descarga, se guarda y se respalda en Drive en `ACTAS/`). Imprímala y fírmela; suba el escaneo firmado como evidencia si lo desea.
2. **Exportar resultados (Excel)** (ganadores + padrón).
3. Los participantes con correo reciben el resultado automáticamente.
4. Comparta el enlace **Verificar el sorteo**: cualquier persona puede recalcular el resultado en su navegador.
5. Entrega de premios: en la tabla de resultados, **Registrar entrega** con el nombre de quien recibe (inmutable).

## Si algo falla
- El sorteo **no se puede repetir ni modificar** una vez ejecutado. Si hubo un error de procedimiento grave, la directiva debe resolverlo y dejarlo en acta; el sistema conserva la evidencia original.
- Sin internet en el lugar: ejecute el sorteo desde un celular con datos; la pantalla de transmisión se actualiza cada 4 segundos.
