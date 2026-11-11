/**
 * Conexión OAuth 2.0 con la cuenta Google INSTITUCIONAL de Tesorería.
 *   POST { accion: 'iniciar' }      (admin drive.gestionar) -> { url }
 *   GET  ?code=...&state=...        (redirección de Google)  -> vuelve al panel
 *   POST { accion: 'desconectar' }  (admin drive.gestionar)
 * Nunca se guardan contraseñas; sólo el refresh token CIFRADO (AES-GCM).
 * Si la cuenta autorizada no coincide con la cuenta institucional configurada, se rechaza.
 */
import { aleatorioUrl, cifrar, descifrar, iguales } from '../_shared/cripto.ts';
import { correoDeCuenta, intercambiarCodigo, revocar, urlAutorizacion } from '../_shared/drive.ts';
import { clienteServicio, cors, env, ErrorHttp, exigirAdmin, manejarError, responder } from '../_shared/servidor.ts';

const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/drive-oauth`;
const volver = (estado: string, detalle = '') =>
  Response.redirect(`${env('APP_URL').replace(/\/$/, '')}/admin/drive?drive=${estado}&detalle=${encodeURIComponent(detalle)}`, 302);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const url = new URL(req.url);
  const sb = clienteServicio();

  // --- Retorno desde Google ---------------------------------------------
  if (req.method === 'GET' && (url.searchParams.has('code') || url.searchParams.has('error'))) {
    try {
      if (url.searchParams.get('error')) return volver('cancelado', url.searchParams.get('error') ?? '');
      const state = url.searchParams.get('state') ?? '';
      const { data: integ } = await sb.from('integraciones').select('*').eq('proveedor', 'google_drive').maybeSingle();
      if (!integ?.oauth_state || !iguales(integ.oauth_state, state) || new Date(integ.oauth_state_expira) < new Date()) {
        return volver('error', 'Solicitud expirada o inválida. Intente conectar nuevamente.');
      }
      const uid = state.split('.')[1];
      const tokens = await intercambiarCodigo(
        { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET'), redirectUri: redirectUri() },
        url.searchParams.get('code')!,
      );
      const correo = await correoDeCuenta(tokens.access_token);
      const { data: cfg } = await sb.from('configuraciones').select('valor').eq('clave', 'drive.cuenta_institucional').maybeSingle();
      const esperada = typeof cfg?.valor === 'string' ? cfg.valor.toLowerCase() : null;
      if (!esperada) {
        await revocar(tokens.access_token);
        return volver('error', 'Configure primero el correo de la cuenta institucional en Configuración.');
      }
      if (correo !== esperada) {
        await revocar(tokens.access_token);
        return volver('error', `La cuenta ${correo} no es la cuenta institucional (${esperada}). Inicie sesión en Google con la cuenta de Tesorería.`);
      }
      if (!tokens.refresh_token) return volver('error', 'Google no entregó un token de actualización. Revoque el acceso en myaccount.google.com/permissions y reintente.');
      await sb.from('integraciones').update({
        cuenta_email: correo,
        token_cifrado: await cifrar(tokens.refresh_token, env('TOKEN_ENC_KEY')),
        conectado_at: new Date().toISOString(),
        conectado_por: uid || null,
        oauth_state: null,
        oauth_state_expira: null,
        carpetas_cache: {},
      }).eq('proveedor', 'google_drive');
      return volver('ok', correo);
    } catch (e) {
      console.error(e);
      return volver('error', e instanceof Error ? e.message.slice(0, 200) : 'Error');
    }
  }

  // --- Acciones del panel -----------------------------------------------
  try {
    if (req.method !== 'POST') throw new ErrorHttp(405, 'Método no permitido');
    const admin = await exigirAdmin(req, 'drive.gestionar');
    const { accion } = await req.json().catch(() => ({}));

    if (accion === 'iniciar') {
      const state = `${aleatorioUrl(24)}.${admin.id}`;
      const { data: cfg } = await sb.from('configuraciones').select('valor').eq('clave', 'drive.cuenta_institucional').maybeSingle();
      await sb.from('integraciones').upsert({
        proveedor: 'google_drive', oauth_state: state,
        oauth_state_expira: new Date(Date.now() + 10 * 60_000).toISOString(),
      }, { onConflict: 'proveedor' });
      return responder(req, { url: urlAutorizacion(env('GOOGLE_CLIENT_ID'), redirectUri(), state, typeof cfg?.valor === 'string' ? cfg.valor : undefined) });
    }
    if (accion === 'desconectar') {
      const { data: integ } = await sb.from('integraciones').select('token_cifrado').eq('proveedor', 'google_drive').maybeSingle();
      if (integ?.token_cifrado) {
        try { await revocar(await descifrar(integ.token_cifrado, env('TOKEN_ENC_KEY'))); } catch (_) { /* puede estar ya revocado */ }
      }
      await sb.from('integraciones').update({ token_cifrado: null, conectado_at: null, carpetas_cache: {} }).eq('proveedor', 'google_drive');
      return responder(req, { ok: true });
    }
    throw new ErrorHttp(400, 'Acción desconocida');
  } catch (e) {
    return manejarError(req, e);
  }
});
