/** Plantillas de correo (español de Chile). Todo valor dinámico se escapa. */

export type TipoNotificacion =
  | 'reserva_confirmada' | 'recordatorio_pago' | 'reserva_expirada' | 'pago_confirmado'
  | 'pago_rechazado' | 'nuevo_comprobante_solicitado' | 'reserva_cancelada' | 'resultado_sorteo';

export interface DatosNotificacion {
  codigo?: string;
  nombre?: string;
  rifa?: string;
  colegio?: string;
  centro_padres?: string;
  numeros?: number[];
  monto_total?: number;
  expira_at?: string | null;
  motivo?: string | null;
  info_pago?: string | null;
  fecha_sorteo?: string | null;
  ganadores?: { posicion: number; numero: number }[];
}

export function escaparHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const clp = (n?: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0);

export const fechaHora = (iso?: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(iso))
    : '';

export function renderizar(tipo: TipoNotificacion, d: DatosNotificacion, urlPublica: string) {
  const nombre = (d.nombre ?? '').split(' ')[0];
  const nums = (d.numeros ?? []).join(', ');
  const enlace = `${urlPublica.replace(/\/$/, '')}/reserva?codigo=${encodeURIComponent(d.codigo ?? '')}`;
  const e = escaparHtml;
  let asunto = '';
  const p: string[] = [];

  switch (tipo) {
    case 'reserva_confirmada':
      asunto = `Reserva ${d.codigo} — ${d.rifa}`;
      p.push(`Tu reserva de los números <b>${e(nums)}</b> quedó registrada.`,
        `Total a pagar: <b>${e(clp(d.monto_total))}</b>. Plazo para enviar el comprobante: <b>${e(fechaHora(d.expira_at))}</b>.`,
        `<b>Instrucciones de pago:</b><br>${e(d.info_pago).replace(/\n/g, '<br>')}`);
      break;
    case 'recordatorio_pago':
      asunto = `Recordatorio: tu reserva ${d.codigo} está por vencer`;
      p.push(`Tu reserva de los números <b>${e(nums)}</b> vence el <b>${e(fechaHora(d.expira_at))}</b>.`,
        'Si ya transferiste, sube el comprobante desde el enlace de abajo para no perder tus números.');
      break;
    case 'reserva_expirada':
      asunto = `Tu reserva ${d.codigo} venció`;
      p.push(`El plazo de pago de los números <b>${e(nums)}</b> terminó y quedaron disponibles nuevamente.`,
        'Si aún quieres participar, puedes hacer una nueva reserva en la página de la rifa.');
      break;
    case 'pago_confirmado':
      asunto = `¡Pago confirmado! Reserva ${d.codigo}`;
      p.push(`Tesorería confirmó tu pago de <b>${e(clp(d.monto_total))}</b>.`,
        `Tus números <b>${e(nums)}</b> ya participan en el sorteo${d.fecha_sorteo ? ` del <b>${e(fechaHora(d.fecha_sorteo))}</b>` : ''}. ¡Gracias por tu aporte!`);
      break;
    case 'pago_rechazado':
      asunto = `Pago no aprobado — reserva ${d.codigo}`;
      p.push('Tesorería no pudo validar tu comprobante y la reserva fue anulada.',
        d.motivo ? `Motivo: <b>${e(d.motivo)}</b>` : '', `Los números ${e(nums)} quedaron disponibles. Si crees que es un error, contacta a Tesorería.`);
      break;
    case 'nuevo_comprobante_solicitado':
      asunto = `Necesitamos un nuevo comprobante — reserva ${d.codigo}`;
      p.push(d.motivo ? `Motivo: <b>${e(d.motivo)}</b>` : '',
        `Tus números <b>${e(nums)}</b> siguen reservados hasta el <b>${e(fechaHora(d.expira_at))}</b>. Sube un nuevo comprobante desde el enlace.`);
      break;
    case 'reserva_cancelada':
      asunto = `Reserva ${d.codigo} cancelada`;
      p.push('Tesorería canceló tu reserva.', d.motivo ? `Motivo: <b>${e(d.motivo)}</b>` : '');
      break;
    case 'resultado_sorteo':
      asunto = `Resultado del sorteo — ${d.rifa}`;
      p.push('El sorteo se realizó. Números ganadores:',
        `<ul>${(d.ganadores ?? []).map((g) => `<li>${e(g.posicion)}° premio: <b>N° ${e(g.numero)}</b></li>`).join('')}</ul>`,
        `Tus números eran: <b>${e(nums)}</b>. ¡Gracias por participar!`);
      break;
  }

  const cuerpo = p.filter(Boolean).map((x) => `<p style="margin:0 0 12px">${x}</p>`).join('');
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f4f6f4;padding:16px;color:#1d2b22">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dfe7e1">
<div style="background:#1b5e3b;color:#fff;padding:16px 20px"><div style="font-size:13px;opacity:.85">${e(d.centro_padres)} · ${e(d.colegio)}</div>
<div style="font-size:18px;font-weight:bold">${e(d.rifa)}</div></div>
<div style="padding:20px"><p style="margin:0 0 12px">Hola ${e(nombre)}:</p>${cuerpo}
<p style="margin:16px 0"><a href="${e(enlace)}" style="background:#c9a227;color:#1d2b22;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Ver mi reserva ${e(d.codigo)}</a></p>
<p style="font-size:12px;color:#5b6b60">Este es un mensaje automático. No compartas tu código de reserva.</p></div></div></body></html>`;
  const texto = `Hola ${nombre}:\n\n${p.filter(Boolean).join('\n\n').replace(/<[^>]+>/g, '')}\n\nVer reserva: ${enlace}`;
  return { asunto, html, texto };
}
