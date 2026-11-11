/**
 * Webpay Plus (Transbank) — API REST oficial v1.2.
 * Documentación: https://www.transbankdevelopers.cl/referencia/webpay
 * La confirmación ocurre SIEMPRE en el servidor (commit), nunca en el navegador.
 * Requiere código de comercio y llave secreta entregados por Transbank.
 */

type Fetch = typeof fetch;
const RUTA = '/rswebpaytransaction/api/webpay/v1.2/transactions';
export const HOSTS = { integracion: 'https://webpay3gint.transbank.cl', produccion: 'https://webpay3g.transbank.cl' };

export interface ConfigWebpay {
  ambiente: 'integracion' | 'produccion';
  codigoComercio: string;
  llaveSecreta: string;
}

function cabeceras(c: ConfigWebpay) {
  return { 'Tbk-Api-Key-Id': c.codigoComercio, 'Tbk-Api-Key-Secret': c.llaveSecreta, 'Content-Type': 'application/json' };
}

export async function crearTransaccion(c: ConfigWebpay, p: { buyOrder: string; sessionId: string; monto: number; urlRetorno: string }, f: Fetch = fetch) {
  if (p.buyOrder.length > 26) throw new Error('buy_order excede 26 caracteres');
  const r = await f(`${HOSTS[c.ambiente]}${RUTA}`, {
    method: 'POST', headers: cabeceras(c),
    body: JSON.stringify({ buy_order: p.buyOrder, session_id: p.sessionId, amount: p.monto, return_url: p.urlRetorno }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Webpay crear: HTTP ${r.status} ${j?.error_message ?? ''}`);
  return j as { token: string; url: string };
}

export async function confirmarTransaccion(c: ConfigWebpay, token: string, f: Fetch = fetch) {
  const r = await f(`${HOSTS[c.ambiente]}${RUTA}/${encodeURIComponent(token)}`, { method: 'PUT', headers: cabeceras(c) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Webpay commit: HTTP ${r.status} ${j?.error_message ?? ''}`);
  return j as { status: string; response_code: number; amount: number; buy_order: string; authorization_code?: string };
}

export const autorizada = (r: { status: string; response_code: number }) => r.status === 'AUTHORIZED' && r.response_code === 0;
