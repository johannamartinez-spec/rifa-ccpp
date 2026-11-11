/** Traduce errores técnicos o de negocio a mensajes comprensibles para apoderados. */
export function mensajeError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e ?? '');
  const tras = (pref: string) => msg.split(pref)[1]?.replace(/^[:\s]+/, '').trim();

  if (msg.includes('NUMEROS_NO_DISPONIBLES')) {
    return `Lo sentimos, alguien acaba de reservar: ${tras('NUMEROS_NO_DISPONIBLES')}. Elija otros números.`;
  }
  if (msg.includes('NUMEROS_INEXISTENTES')) return 'Algunos números no existen en esta rifa.';
  if (msg.includes('RIFA_NO_DISPONIBLE')) return 'La venta de esta rifa no está abierta en este momento.';
  if (msg.includes('LIMITE_EXCEDIDO')) return tras('LIMITE_EXCEDIDO') ?? 'Demasiados intentos. Espere unos minutos.';
  if (msg.includes('RESERVA_NO_ENCONTRADA')) return 'No encontramos una reserva con ese código y teléfono.';
  if (msg.includes('VALIDACION')) return tras('VALIDACION') ?? 'Datos inválidos.';
  if (msg.includes('SIN_PERMISO')) return 'No tiene permiso para realizar esta acción.';
  if (msg.includes('NO_AUTENTICADO')) return 'Su sesión expiró. Ingrese nuevamente.';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
    return 'Sin conexión. Revise su internet e intente nuevamente.';
  }
  const negocio = msg.match(/^([A-Z_]{4,}):\s*(.+)$/);
  if (negocio) return negocio[2];
  return msg || 'Ocurrió un error inesperado. Intente nuevamente.';
}
