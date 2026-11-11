/**
 * Proveedores de envío. Cada uno recibe `fetch` inyectable (pruebas).
 * - Correo: Resend (plan gratuito). API oficial https://resend.com/docs/api-reference/emails/send-email
 * - WhatsApp: WhatsApp Business Cloud API oficial de Meta, SÓLO con plantillas
 *   aprobadas y número verificado. Sin credenciales queda deshabilitado.
 */

type Fetch = typeof fetch;

export class ErrorProveedor extends Error {
  constructor(msg: string, public reintentable: boolean) {
    super(msg);
  }
}

export async function enviarCorreoResend(
  cfg: { apiKey: string; remitente: string; responderA?: string },
  msg: { para: string; asunto: string; html: string; texto: string; idempotencia: string },
  f: Fetch = fetch,
): Promise<string> {
  const r = await f('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': msg.idempotencia,
    },
    body: JSON.stringify({
      from: cfg.remitente,
      to: [msg.para],
      subject: msg.asunto,
      html: msg.html,
      text: msg.texto,
      ...(cfg.responderA ? { reply_to: cfg.responderA } : {}),
    }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new ErrorProveedor(`Resend ${r.status}: ${cuerpo?.message ?? r.statusText}`, r.status === 429 || r.status >= 500);
  }
  return String(cuerpo.id ?? '');
}

/** Envío por plantilla aprobada en WhatsApp Cloud API (Meta). */
export async function enviarWhatsAppCloud(
  cfg: { token: string; phoneNumberId: string; plantillas: Record<string, string>; idioma?: string },
  msg: { telefono: string; tipo: string; parametros: string[] },
  f: Fetch = fetch,
): Promise<string> {
  const plantilla = cfg.plantillas[msg.tipo];
  if (!plantilla) throw new ErrorProveedor(`No hay plantilla aprobada configurada para "${msg.tipo}"`, false);
  const r = await f(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: msg.telefono.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: plantilla,
        language: { code: cfg.idioma ?? 'es' },
        components: [{ type: 'body', parameters: msg.parametros.map((t) => ({ type: 'text', text: t.slice(0, 200) })) }],
      },
    }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorProveedor(`WhatsApp ${r.status}: ${cuerpo?.error?.message ?? r.statusText}`, r.status >= 500);
  return String(cuerpo?.messages?.[0]?.id ?? '');
}
