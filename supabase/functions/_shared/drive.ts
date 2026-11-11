/**
 * Cliente mínimo de Google Drive API v3 (OAuth 2.0, alcance drive.file:
 * la app sólo ve y crea SUS propios archivos en el Drive institucional).
 * Documentación oficial: https://developers.google.com/drive/api/v3/reference
 */

type Fetch = typeof fetch;
const FOLDER = 'application/vnd.google-apps.folder';
export const ALCANCES = 'openid email https://www.googleapis.com/auth/drive.file';

export function urlAutorizacion(clientId: string, redirectUri: string, state: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ALCANCES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) p.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function json(r: Response, contexto: string) {
  const t = await r.text();
  let j: any = {};
  try { j = t ? JSON.parse(t) : {}; } catch { /* no json */ }
  if (!r.ok) throw new Error(`${contexto}: HTTP ${r.status} ${j?.error_description ?? j?.error?.message ?? j?.error ?? t.slice(0, 200)}`);
  return j;
}

export async function intercambiarCodigo(cfg: { clientId: string; clientSecret: string; redirectUri: string }, code: string, f: Fetch = fetch) {
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' }),
  });
  return (await json(r, 'Intercambio de código')) as { access_token: string; refresh_token?: string; scope: string };
}

export async function correoDeCuenta(accessToken: string, f: Fetch = fetch): Promise<string> {
  const r = await f('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await json(r, 'Información de la cuenta');
  if (!j.email_verified) throw new Error('La cuenta de Google no tiene el correo verificado');
  return String(j.email).toLowerCase();
}

export async function tokenDeAcceso(cfg: { clientId: string; clientSecret: string }, refreshToken: string, f: Fetch = fetch): Promise<string> {
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  return (await json(r, 'Renovación de token')).access_token;
}

export async function revocar(token: string, f: Fetch = fetch) {
  await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
}

const escaparQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class ClienteDrive {
  constructor(private token: string, public cache: Record<string, string> = {}, private f: Fetch = fetch) {}

  private h(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  async buscar(q: string): Promise<{ id: string; name: string }[]> {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', q);
    u.searchParams.set('fields', 'files(id,name)');
    u.searchParams.set('spaces', 'drive');
    u.searchParams.set('pageSize', '10');
    return (await json(await this.f(u.toString(), { headers: this.h() }), 'Búsqueda en Drive')).files ?? [];
  }

  /** Garantiza la ruta de carpetas "A/B/C" y devuelve el id de la última (con caché). */
  async asegurarRuta(ruta: string): Promise<string> {
    const partes = ruta.split('/').filter(Boolean);
    let padre = 'root';
    let acumulada = '';
    for (const nombre of partes) {
      acumulada = acumulada ? `${acumulada}/${nombre}` : nombre;
      if (this.cache[acumulada]) { padre = this.cache[acumulada]; continue; }
      const existentes = await this.buscar(
        `name = '${escaparQ(nombre)}' and mimeType = '${FOLDER}' and '${padre}' in parents and trashed = false`);
      let id = existentes[0]?.id;
      if (!id) {
        const r = await this.f('https://www.googleapis.com/drive/v3/files?fields=id', {
          method: 'POST',
          headers: this.h({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ name: nombre, mimeType: FOLDER, parents: [padre] }),
        });
        id = (await json(r, `Crear carpeta ${acumulada}`)).id;
      }
      this.cache[acumulada] = id!;
      padre = id!;
    }
    return padre;
  }

  /** Busca un archivo ya respaldado (idempotencia ante reintentos). */
  async buscarRespaldo(respaldoId: string | number): Promise<string | null> {
    const r = await this.buscar(
      `appProperties has { key='ccpp_respaldo_id' and value='${escaparQ(String(respaldoId))}' } and trashed = false`);
    return r[0]?.id ?? null;
  }

  async subir(p: {
    carpetaId: string; nombre: string; mime: string; bytes: Uint8Array;
    descripcion: string; propiedades: Record<string, string>;
  }): Promise<string> {
    const limite = `ccpp${crypto.randomUUID().replace(/-/g, '')}`;
    const meta = JSON.stringify({ name: p.nombre, parents: [p.carpetaId], description: p.descripcion, appProperties: p.propiedades });
    const enc = new TextEncoder();
    const ini = enc.encode(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: ${p.mime}\r\n\r\n`);
    const fin = enc.encode(`\r\n--${limite}--`);
    const cuerpo = new Uint8Array(ini.length + p.bytes.length + fin.length);
    cuerpo.set(ini, 0);
    cuerpo.set(p.bytes, ini.length);
    cuerpo.set(fin, ini.length + p.bytes.length);
    const r = await this.f('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: this.h({ 'Content-Type': `multipart/related; boundary=${limite}` }),
      body: cuerpo,
    });
    return (await json(r, `Subir ${p.nombre}`)).id;
  }
}
