/** Estados, etiquetas y colores (contraste AA sobre su fondo). */

export type EstadoNumero = 'disponible' | 'reservado' | 'pendiente_pago' | 'vendido' | 'bloqueado';
export type EstadoVisual = EstadoNumero | 'seleccionado';

export const ESTILO_NUMERO: Record<EstadoVisual, { etiqueta: string; fondo: string; texto: string; borde: string }> = {
  disponible: { etiqueta: 'Disponible', fondo: '#ffffff', texto: '#1b5e3b', borde: '#7fb08f' },
  seleccionado: { etiqueta: 'Seleccionado', fondo: '#c9a227', texto: '#1d2b22', borde: '#8a6d10' },
  reservado: { etiqueta: 'Reservado', fondo: '#fde7c2', texto: '#7a4a00', borde: '#e0a84a' },
  pendiente_pago: { etiqueta: 'Pago en revisión', fondo: '#dbe8fb', texto: '#123f7a', borde: '#7ea6dd' },
  vendido: { etiqueta: 'Vendido', fondo: '#1b5e3b', texto: '#ffffff', borde: '#1b5e3b' },
  bloqueado: { etiqueta: 'No disponible', fondo: '#e4e4e4', texto: '#555555', borde: '#bdbdbd' },
};

export type EstadoReserva =
  | 'reservado' | 'pendiente_pago' | 'comprobante_enviado' | 'en_revision' | 'pagado' | 'rechazado' | 'cancelado' | 'expirado';

export const ESTADO_RESERVA: Record<EstadoReserva, { etiqueta: string; color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'; ayuda: string }> = {
  reservado: { etiqueta: 'Reservado — falta pagar', color: 'warning', ayuda: 'Transfiera y envíe el comprobante antes del plazo.' },
  pendiente_pago: { etiqueta: 'Nuevo comprobante solicitado', color: 'warning', ayuda: 'Tesorería pidió un nuevo comprobante. Envíelo antes del plazo.' },
  comprobante_enviado: { etiqueta: 'Comprobante enviado', color: 'info', ayuda: 'Tesorería revisará su pago pronto.' },
  en_revision: { etiqueta: 'En revisión', color: 'info', ayuda: 'Tesorería está revisando su comprobante.' },
  pagado: { etiqueta: 'Pagado y confirmado', color: 'success', ayuda: '¡Listo! Sus números participan en el sorteo.' },
  rechazado: { etiqueta: 'Pago rechazado', color: 'error', ayuda: 'El pago no fue aprobado y los números se liberaron.' },
  cancelado: { etiqueta: 'Cancelado', color: 'default', ayuda: 'La reserva fue cancelada.' },
  expirado: { etiqueta: 'Vencido', color: 'default', ayuda: 'El plazo de pago terminó y los números se liberaron.' },
};

export const ESTADO_RIFA: Record<string, { etiqueta: string; color: 'default' | 'success' | 'warning' | 'info' | 'secondary' }> = {
  borrador: { etiqueta: 'Borrador', color: 'default' },
  activa: { etiqueta: 'Venta abierta', color: 'success' },
  pausada: { etiqueta: 'Pausada', color: 'warning' },
  cerrada: { etiqueta: 'Ventas cerradas', color: 'info' },
  sorteada: { etiqueta: 'Sorteada', color: 'secondary' },
};
