/**
 * Pasarela LOCAL de pruebas que imita las rutas de Supabase:
 *   /rest/v1/*       -> PostgREST real (puerto 3001) sobre PostgreSQL real
 *   /functions/v1/*  -> funciones Edge reales ejecutadas con Deno
 *   /auth/v1/*       -> emulación mínima de Supabase Auth (contraseña + JWT HS256)
 *   /storage/v1/*    -> emulación en memoria de Supabase Storage
 * SÓLO PARA PRUEBAS E2E. No se usa en producción.
 */
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import pg from 'pg';

export const SECRETO = 'secreto-de-pruebas-e2e-de-al-menos-32-caracteres';
const PUERTO = Number(process.env.PUERTO_PASARELA ?? 54321);
const FUNCIONES = JSON.parse(process.env.FUNCIONES ?? '{"subir-comprobante":8101}');
const db = new pg.Pool({ host: 'localhost', user: 'postgres', database: process.env.DB_NAME ?? 'rifa_e2e' });

const b64u = (b) => Buffer.from(b).toString('base64url');
export function firmar(payload) {
  const cab = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...payload }));
  const firma = createHmac('sha256', SECRETO).update(`${cab}.${cuerpo}`).digest('base64url');
  return `${cab}.${cuerpo}.${firma}`;
}
function leerJwt(token) {
  try {
    const [c, p, f] = token.split('.');
    if (createHmac('sha256', SECRETO).update(`${c}.${p}`).digest('base64url') !== f) return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString());
  } catch { return null; }
}

// Usuarios de prueba (contraseña fija)
export const CLAVE = 'Clave-de-prueba-2026!';
const almacen = new Map(); // `${bucket}/${ruta}` -> { tipo, datos }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Profile',
};
const json = (res, estado, cuerpo) => { res.writeHead(estado, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(cuerpo)); };
const leer = (req) => new Promise((r) => { const p = []; req.on('data', (c) => p.push(c)); req.on('end', () => r(Buffer.concat(p))); });

async function proxy(req, res, destino, cuerpo) {
  const cab = { ...req.headers };
  delete cab.host; delete cab['content-length']; delete cab.connection;
  if (!cab.authorization && cab.apikey) cab.authorization = `Bearer ${cab.apikey}`;
  const r = await fetch(destino, { method: req.method, headers: cab, body: ['GET', 'HEAD'].includes(req.method) ? undefined : cuerpo, redirect: 'manual' });
  const salida = { ...cors };
  r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection', 'access-control-allow-origin'].includes(k)) salida[k] = v; });
  res.writeHead(r.status, salida);
  res.end(Buffer.from(await r.arrayBuffer()));
}

function usuarioDeSesion(fila, aal = 'aal1') {
  return { id: fila.id, aud: 'authenticated', role: 'authenticated', email: fila.email, app_metadata: { provider: 'email' }, user_metadata: {}, factors: [], created_at: new Date().toISOString() };
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, `http://localhost:${PUERTO}`);
    const cuerpo = await leer(req);

    if (url.pathname.startsWith('/rest/v1')) return proxy(req, res, `http://localhost:3001${url.pathname.slice(8)}${url.search}`, cuerpo);

    if (url.pathname.startsWith('/functions/v1/')) {
      const nombre = url.pathname.split('/')[3];
      if (!FUNCIONES[nombre]) return json(res, 404, { error: `función ${nombre} no levantada en pruebas` });
      return proxy(req, res, `http://127.0.0.1:${FUNCIONES[nombre]}/${url.search}`, cuerpo);
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = JSON.parse(cuerpo.toString() || '{}');
      const { rows } = await db.query('select id, email from auth.users where lower(email) = lower($1)', [email]);
      if (!rows[0] || password !== CLAVE) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      const token = firmar({ sub: rows[0].id, email: rows[0].email, role: 'authenticated', aud: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }], session_id: randomUUID() });
      return json(res, 200, { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: randomUUID(), user: usuarioDeSesion(rows[0]) });
    }
    if (url.pathname === '/auth/v1/user') {
      const p = leerJwt((req.headers.authorization ?? '').replace('Bearer ', ''));
      if (!p?.sub) return json(res, 401, { msg: 'invalid JWT' });
      return json(res, 200, usuarioDeSesion({ id: p.sub, email: p.email }));
    }
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
    if (url.pathname.startsWith('/auth/v1/')) return json(res, 200, {});

    // ---- Storage en memoria ------------------------------------------
    const m = url.pathname.match(/^\/storage\/v1\/object\/(sign\/|public\/|authenticated\/)?([^/]+)\/(.+)$/);
    if (m) {
      const [, modo, bucket, ruta] = m;
      const clave = `${bucket}/${decodeURIComponent(ruta)}`;
      if (req.method === 'POST' && modo === 'sign/') return json(res, 200, { signedURL: `/object/public/${bucket}/${ruta}?token=e2e` });
      if (req.method === 'POST' || req.method === 'PUT') {
        if (almacen.has(clave) && req.headers['x-upsert'] !== 'true') return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        let datos = cuerpo; let tipo = req.headers['content-type'] ?? 'application/octet-stream';
        if (tipo.startsWith('multipart/form-data')) {
          const f = await new Request('http://x', { method: 'POST', headers: { 'content-type': tipo }, body: cuerpo }).formData();
          const archivo = [...f.values()].find((v) => typeof v !== 'string');
          datos = Buffer.from(await archivo.arrayBuffer()); tipo = archivo.type || tipo;
        }
        almacen.set(clave, { tipo, datos });
        return json(res, 200, { Key: clave, Id: randomUUID() });
      }
      if (req.method === 'GET') {
        const o = almacen.get(clave);
        if (!o) return json(res, 404, { error: 'not_found' });
        res.writeHead(200, { ...cors, 'Content-Type': o.tipo }); return res.end(o.datos);
      }
      if (req.method === 'DELETE') { almacen.delete(clave); return json(res, 200, {}); }
    }
    if (url.pathname === '/storage/v1/object/comprobantes' && req.method === 'DELETE') return json(res, 200, []);
    if (url.pathname === '/__pruebas/almacen') return json(res, 200, [...almacen.keys()]);
    return json(res, 404, { error: `ruta no emulada: ${req.method} ${url.pathname}` });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e) });
  }
}).listen(PUERTO, () => console.log(`pasarela e2e en http://localhost:${PUERTO}`));
