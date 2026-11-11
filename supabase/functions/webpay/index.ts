/**
 * Webpay Plus (PREPARADO; deshabilitado hasta tener credenciales comerciales).
 *   POST { accion:'crear', codigo, telefono } -> { url, token }   (público)
 *   GET|POST ?token_ws=... | TBK_TOKEN=...    -> retorno de Transbank
 * La autorización se confirma en el servidor (commit) y se valida el monto.
 */
import { CODIGO_RESERVA, normalizarTelefono } from '../_shared/archivos.ts';
import { aleatorioUrl } from '../_shared/cripto.ts';
import { clienteServicio, cors, env, envOpcional, ErrorHttp, manejarError, responder } from '../_shared/servidor.ts';
import { autorizada, confirmarTransaccion, crearTransaccion, type ConfigWebpay } from '../_shared/webpay.ts';

function config(): ConfigWebpay {
  if (envOpcional('WEBPAY_HABILITADO') !== 'true') throw new ErrorHttp(503, 'El pago con Webpay no está habilitado. Use transferencia bancaria.');
  return {
    ambiente: envOpcional('WEBPAY_AMBIENTE') === 'produccion' ? 'produccion' : 'integracion',
    codigoComercio: env('WEBPAY_CODIGO_COMERCIO'),
    llaveSecreta: env('WEBPAY_LLAVE_SECRETA'),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const url = new URL(req.url);
  const sb = clienteServicio();
  try {
    // ---- Retorno desde Transbank --------------------------------------
    let tokenWs = url.searchParams.get('token_ws');
    let tbkToken = url.searchParams.get('TBK_TOKEN');
    let tbkOrden = url.searchParams.get('TBK_ORDEN_COMPRA');
    if (req.method === 'POST' && (req.headers.get('content-type') ?? '').includes('form')) {
      const f = await req.formData();
      tokenWs ??= f.get('token_ws') as string | null;
      tbkToken ??= f.get('TBK_TOKEN') as string | null;
      tbkOrden ??= f.get('TBK_ORDEN_COMPRA') as string | null;
    }
    const app = env('APP_URL').replace(/\/$/, '');
    if (tbkToken && !tokenWs) {
      // pago abortado por el usuario
      if (tbkOrden) await sb.rpc('confirmar_pago_pasarela', { p_buy_order: tbkOrden, p_token: tbkToken, p_monto: 0, p_autorizada: false, p_respuesta: { abortado: true } });
      return Response.redirect(`${app}/reserva?pago=anulado`, 303);
    }
    if (tokenWs) {
      const r = await confirmarTransaccion(config(), tokenWs);
      const { data } = await sb.rpc('confirmar_pago_pasarela', {
        p_buy_order: r.buy_order, p_token: tokenWs, p_monto: r.amount, p_autorizada: autorizada(r), p_respuesta: r,
      });
      const est = data?.estado === 'autorizada' ? 'ok' : data?.estado === 'requiere_revision' ? 'revision' : 'rechazado';
      return Response.redirect(`${app}/reserva?pago=${est}${data?.codigo ? `&codigo=${data.codigo}` : ''}`, 303);
    }

    // ---- Crear transacción ----------------------------------------------
    if (req.method !== 'POST') throw new ErrorHttp(405, 'Método no permitido');
    const cfg = config();
    const { codigo, telefono } = await req.json();
    const tel = normalizarTelefono(telefono);
    if (!CODIGO_RESERVA.test(String(codigo).toUpperCase()) || !tel) throw new ErrorHttp(400, 'Datos inválidos');
    const { data: res } = await sb.from('reservas').select('id, monto_total, compradores!inner(telefono)')
      .eq('codigo', String(codigo).toUpperCase()).eq('compradores.telefono', tel).maybeSingle();
    if (!res) throw new ErrorHttp(404, 'Reserva no encontrada');
    const buyOrder = `CCPP${aleatorioUrl(16).replace(/[-_]/g, '').slice(0, 20)}`;
    const { error } = await sb.rpc('registrar_transaccion_pasarela', { p_codigo: String(codigo).toUpperCase(), p_buy_order: buyOrder, p_monto: res.monto_total });
    if (error) throw new Error(error.message);
    const t = await crearTransaccion(cfg, { buyOrder, sessionId: res.id.slice(0, 61), monto: res.monto_total, urlRetorno: `${env('SUPABASE_URL')}/functions/v1/webpay` });
    await sb.from('transacciones_pasarela').update({ token: t.token }).eq('buy_order', buyOrder);
    return responder(req, { url: t.url, token: t.token });
  } catch (e) {
    return manejarError(req, e);
  }
});
