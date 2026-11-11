/**
 * Procesa la cola de notificaciones. Invocada por pg_cron (service_role)
 * o manualmente por un administrador con permiso notificaciones.gestionar.
 * Correo: Resend. WhatsApp: Cloud API oficial (sólo si está configurado).
 */
import { renderizar, type TipoNotificacion } from '../_shared/plantillas.ts';
import { enviarCorreoResend, enviarWhatsAppCloud, ErrorProveedor } from '../_shared/proveedores.ts';
import { clienteServicio, cors, esLlamadaServicio, exigirAdmin, envOpcional, manejarError, responder } from '../_shared/servidor.ts';

const MAX_INTENTOS = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    if (!esLlamadaServicio(req)) await exigirAdmin(req, 'notificaciones.gestionar');

    const resendKey = envOpcional('RESEND_API_KEY');
    const remitente = envOpcional('EMAIL_FROM');
    const waToken = envOpcional('WHATSAPP_TOKEN');
    const waPhone = envOpcional('WHATSAPP_PHONE_NUMBER_ID');
    const waPlantillas = JSON.parse(envOpcional('WHATSAPP_PLANTILLAS') ?? '{}');
    if (!resendKey || !remitente) {
      // No se toman trabajos: quedan pendientes hasta que se configure el proveedor.
      return responder(req, { configurado: false, mensaje: 'Configure RESEND_API_KEY y EMAIL_FROM para enviar correos.' });
    }

    const sb = clienteServicio();
    const { data: urlCfg } = await sb.from('configuraciones').select('valor').eq('clave', 'institucion.url_publica').maybeSingle();
    const urlPublica = String(urlCfg?.valor ?? envOpcional('APP_URL') ?? '');

    const { data: trabajos, error } = await sb.rpc('tomar_notificaciones', { p_limite: 25 });
    if (error) throw error;
    const resumen = { enviados: 0, errores: 0, omitidos: 0 };

    for (const n of trabajos ?? []) {
      try {
        let proveedorId = '';
        if (n.canal === 'email') {
          const m = renderizar(n.tipo as TipoNotificacion, n.datos, urlPublica);
          proveedorId = await enviarCorreoResend(
            { apiKey: resendKey, remitente, responderA: envOpcional('EMAIL_REPLY_TO') },
            { para: n.destinatario, asunto: m.asunto, html: m.html, texto: m.texto, idempotencia: `ccpp-notif-${n.id}` },
          );
        } else {
          if (!waToken || !waPhone) {
            await sb.from('notificaciones').update({ estado: 'omitido', error: 'Proveedor oficial de WhatsApp no configurado' }).eq('id', n.id);
            resumen.omitidos++;
            continue;
          }
          proveedorId = await enviarWhatsAppCloud(
            { token: waToken, phoneNumberId: waPhone, plantillas: waPlantillas },
            { telefono: n.destinatario, tipo: n.tipo, parametros: [String(n.datos?.codigo ?? ''), (n.datos?.numeros ?? []).join(', ')] },
          );
        }
        await sb.from('notificaciones').update({ estado: 'enviado', enviado_at: new Date().toISOString(), proveedor_id: proveedorId, error: null }).eq('id', n.id);
        resumen.enviados++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const definitivo = (e instanceof ErrorProveedor && !e.reintentable) || n.intentos >= MAX_INTENTOS;
        await sb.from('notificaciones').update({ estado: definitivo ? 'error' : 'pendiente', error: msg.slice(0, 500) }).eq('id', n.id);
        resumen.errores++;
      }
    }
    return responder(req, { configurado: true, procesados: trabajos?.length ?? 0, ...resumen });
  } catch (e) {
    return manejarError(req, e);
  }
});
