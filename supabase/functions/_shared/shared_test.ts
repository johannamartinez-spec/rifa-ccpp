// deno test supabase/functions/_shared/shared_test.ts
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, m?: string) => nodeAssert.ok(v, m);
const assertEquals = (a: unknown, b: unknown, m?: string) => nodeAssert.deepStrictEqual(a, b, m);
const assertStringIncludes = (s: string, sub: string) => nodeAssert.ok(s.includes(sub), `"${sub}" no está en el texto`);
async function assertRejects(fn: () => Promise<unknown>, tipo?: new (...a: any[]) => Error): Promise<Error> {
  try { await fn(); } catch (e) { if (tipo) nodeAssert.ok(e instanceof tipo); return e as Error; }
  throw new Error('Se esperaba un rechazo');
}
import { normalizarTelefono, validarComprobante } from './archivos.ts';
import { cifrar, descifrar, iguales } from './cripto.ts';
import { ClienteDrive, urlAutorizacion } from './drive.ts';
import { escaparHtml, renderizar } from './plantillas.ts';
import { enviarCorreoResend, ErrorProveedor } from './proveedores.ts';
import { autorizada, confirmarTransaccion, crearTransaccion } from './webpay.ts';

const enc = new TextEncoder();
const bytes = (...partes: (number[] | string)[]) => {
  const arr: number[] = [];
  for (const p of partes) arr.push(...(typeof p === 'string' ? enc.encode(p) : p));
  return new Uint8Array(arr);
};
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF datos de imagen', [0xff, 0xd9]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR...IDAT...IEND', [0xae, 0x42, 0x60, 0x82]);
const PDF = bytes('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF\n');

Deno.test('archivos: acepta JPG, PNG y PDF válidos', () => {
  for (const [n, m, b] of [['pago.jpg', 'image/jpeg', JPG], ['pago.PNG', 'image/png', PNG], ['cartola.pdf', 'application/pdf', PDF]] as const) {
    const r = validarComprobante(n, m, b);
    assert(r.ok, `${n}: ${!r.ok && r.error}`);
  }
});

Deno.test('archivos: rechaza extensión, contenido o MIME falsificado', () => {
  assertEquals(validarComprobante('virus.exe', 'application/octet-stream', JPG).ok, false);
  assertEquals(validarComprobante('pago.jpg', 'image/jpeg', PDF).ok, false); // PDF disfrazado
  assertEquals(validarComprobante('pago.pdf', 'image/png', PDF).ok, false); // MIME declarado distinto
  assertEquals(validarComprobante('pago.exe.jpg', 'image/jpeg', JPG).ok, false); // doble extensión
  assertEquals(validarComprobante('pago.jpg', 'image/jpeg', bytes('<html>hola</html>')).ok, false);
  assertEquals(validarComprobante('pago.png', 'image/png', new Uint8Array(0)).ok, false);
});

Deno.test('archivos: rechaza tamaño mayor a 5 MB', () => {
  const grande = new Uint8Array(5 * 1024 * 1024 + 1);
  grande.set(JPG);
  const r = validarComprobante('pago.jpg', 'image/jpeg', grande);
  assertEquals(r.ok, false);
});

Deno.test('archivos: detecta PDF con JavaScript, incluso ofuscado', () => {
  const malo = bytes('%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF');
  const ofuscado = bytes('%PDF-1.4\n1 0 obj << /OpenAction << /S /J#61vaScript >> >> endobj\n%%EOF');
  const adjunto = bytes('%PDF-1.7\n<< /EmbeddedFiles 3 0 R >>\n%%EOF');
  for (const b of [malo, ofuscado, adjunto]) {
    const r = validarComprobante('x.pdf', 'application/pdf', b);
    assertEquals(r.ok, false);
    if (!r.ok) assertStringIncludes(r.error, 'elementos activos');
  }
  assertEquals(validarComprobante('x.pdf', 'application/pdf', bytes('%PDF-1.4 sin fin')).ok, false);
});

Deno.test('archivos: detecta imágenes políglotas (script o PDF incrustado)', () => {
  const poli = bytes([0xff, 0xd8, 0xff, 0xe0], '<script>alert(1)</script>', [0xff, 0xd9]);
  const php = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '<?php system($_GET[c]); ?>IEND');
  assertEquals(validarComprobante('a.jpg', 'image/jpeg', poli).ok, false);
  assertEquals(validarComprobante('a.png', 'image/png', php).ok, false);
});

Deno.test('archivos: nombre visible seguro (sin rutas ni caracteres de control)', () => {
  const r = validarComprobante('../../etc/pa<ss>wd\u0000.jpg', 'image/jpeg', JPG);
  assert(r.ok);
  if (r.ok) assertEquals(r.nombreVisible, 'passwd.jpg');
});

Deno.test('teléfono chileno', () => {
  assertEquals(normalizarTelefono('+56 9 1234 5678'), '+56912345678');
  assertEquals(normalizarTelefono('912345678'), '+56912345678');
  assertEquals(normalizarTelefono('22345678'), null);
});

Deno.test('plantillas: escapan HTML (XSS) y generan enlace de reserva', () => {
  const m = renderizar('reserva_confirmada', {
    codigo: 'CCPP-ABCD-EFGH', nombre: '<img src=x onerror=alert(1)> Pérez', rifa: 'Rifa <b>', numeros: [1, 2],
    monto_total: 2000, info_pago: 'Banco <script>', expira_at: new Date().toISOString(),
  }, 'https://rifa.example.cl');
  assert(!m.html.includes('<img src=x'));
  assert(!m.html.includes('<script>'));
  assertStringIncludes(m.html, '&lt;script&gt;');
  assertStringIncludes(m.html, 'reserva?codigo=CCPP-ABCD-EFGH');
  assertStringIncludes(m.html, '$2.000');
  assertEquals(escaparHtml(`"'&`), '&quot;&#39;&amp;');
  for (const t of ['recordatorio_pago', 'reserva_expirada', 'pago_confirmado', 'pago_rechazado', 'nuevo_comprobante_solicitado', 'reserva_cancelada', 'resultado_sorteo'] as const) {
    assert(renderizar(t, { codigo: 'X', ganadores: [{ posicion: 1, numero: 7 }] }, 'https://x').asunto.length > 5, t);
  }
});

Deno.test('cripto: cifrado AES-GCM ida y vuelta; manipulación detectada', async () => {
  const clave = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const c = await cifrar('1//refresh-token-secreto', clave);
  assert(!c.includes('refresh'));
  assertEquals(await descifrar(c, clave), '1//refresh-token-secreto');
  const [v, iv, ct] = c.split('.');
  const alterado = `${v}.${iv}.${ct.slice(0, -4)}AAAA`;
  await assertRejects(() => descifrar(alterado, clave));
  assert(iguales('abc', 'abc') && !iguales('abc', 'abd'));
});

Deno.test('resend: envía con idempotencia y clasifica errores', async () => {
  let cuerpo: any; let cab: any;
  const ok = (async (_u: string, init: RequestInit) => {
    cuerpo = JSON.parse(String(init.body)); cab = init.headers;
    return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
  }) as typeof fetch;
  const id = await enviarCorreoResend({ apiKey: 'k', remitente: 'Rifa <rifa@x.cl>' }, { para: 'a@b.cl', asunto: 'S', html: '<p>h</p>', texto: 'h', idempotencia: 'ccpp-1' }, ok);
  assertEquals(id, 'msg_1');
  assertEquals(cuerpo.to, ['a@b.cl']);
  assertEquals(cab['Idempotency-Key'], 'ccpp-1');
  const err = (async () => new Response(JSON.stringify({ message: 'invalid' }), { status: 422 })) as typeof fetch;
  const e = await assertRejects(() => enviarCorreoResend({ apiKey: 'k', remitente: 'r' }, { para: 'a', asunto: 's', html: '', texto: '', idempotencia: 'i' }, err), ErrorProveedor);
  assertEquals((e as ErrorProveedor).reintentable, false);
});

/** Google Drive simulado en memoria */
function driveFalso() {
  const archivos: { id: string; name: string; mimeType: string; parents: string[]; appProperties?: Record<string, string> }[] = [];
  let n = 0;
  const llamadas: string[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    llamadas.push(`${init.method ?? 'GET'} ${u.pathname}`);
    if (u.pathname === '/drive/v3/files' && (init.method ?? 'GET') === 'GET') {
      const q = u.searchParams.get('q')!;
      const nombre = q.match(/name = '([^']+)'/)?.[1];
      const padre = q.match(/'([^']+)' in parents/)?.[1];
      const prop = q.match(/value='([^']+)'/)?.[1];
      const files = archivos.filter((a) => (nombre ? a.name === nombre && a.parents.includes(padre!) : true)
        && (prop ? a.appProperties?.ccpp_respaldo_id === prop : true));
      return new Response(JSON.stringify({ files }));
    }
    if (u.pathname === '/drive/v3/files' && init.method === 'POST') {
      const m = JSON.parse(String(init.body));
      archivos.push({ id: `f${++n}`, ...m });
      return new Response(JSON.stringify({ id: `f${n}` }));
    }
    if (u.pathname === '/upload/drive/v3/files') {
      const txt = new TextDecoder().decode(init.body as Uint8Array);
      const meta = JSON.parse(txt.split('\r\n\r\n')[1].split('\r\n')[0]);
      archivos.push({ id: `f${++n}`, mimeType: 'file', ...meta });
      return new Response(JSON.stringify({ id: `f${n}` }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { archivos, f, llamadas };
}

Deno.test('drive: crea la estructura CENTRO_DE_PADRES/RIFAS/AAAA/RIFA_XXX/TIPO sin duplicar carpetas', async () => {
  const d = driveFalso();
  const c = new ClienteDrive('tok', {}, d.f);
  const id1 = await c.asegurarRuta('CENTRO_DE_PADRES/RIFAS/2026/RIFA_001/COMPROBANTES');
  const id2 = await c.asegurarRuta('CENTRO_DE_PADRES/RIFAS/2026/RIFA_001/ACTAS');
  const carpetas = d.archivos.map((a) => a.name);
  assertEquals(carpetas, ['CENTRO_DE_PADRES', 'RIFAS', '2026', 'RIFA_001', 'COMPROBANTES', 'ACTAS']);
  assert(id1 !== id2);
  // Nuevo cliente sin caché encuentra las existentes (no duplica)
  const c2 = new ClienteDrive('tok', {}, d.f);
  assertEquals(await c2.asegurarRuta('CENTRO_DE_PADRES/RIFAS/2026/RIFA_001/COMPROBANTES'), id1);
  assertEquals(d.archivos.length, 6);
});

Deno.test('drive: sube con metadatos y detecta respaldos ya existentes (idempotencia)', async () => {
  const d = driveFalso();
  const c = new ClienteDrive('tok', {}, d.f);
  const carpeta = await c.asegurarRuta('CENTRO_DE_PADRES/RIFAS/2026/RIFA_001/COMPROBANTES');
  assertEquals(await c.buscarRespaldo(42), null);
  const id = await c.subir({ carpetaId: carpeta, nombre: 'RIFA_001_x.jpg', mime: 'image/jpeg', bytes: JPG, descripcion: 'Reserva: CCPP-AAAA-BBBB',
    propiedades: { ccpp_respaldo_id: '42', ccpp_reserva: 'CCPP-AAAA-BBBB', ccpp_tipo: 'COMPROBANTES' } });
  assertEquals(await c.buscarRespaldo(42), id);
  const subido = d.archivos.find((a) => a.id === id)!;
  assertEquals(subido.parents, [carpeta]);
  assertEquals(subido.appProperties?.ccpp_reserva, 'CCPP-AAAA-BBBB');
});

Deno.test('drive: URL OAuth con alcance mínimo drive.file y acceso offline', () => {
  const u = new URL(urlAutorizacion('cid', 'https://p.supabase.co/functions/v1/drive-oauth', 'st', 'tesoreria@colegio.cl'));
  assertStringIncludes(u.searchParams.get('scope')!, 'drive.file');
  assert(!u.searchParams.get('scope')!.includes('auth/drive '));
  assertEquals(u.searchParams.get('access_type'), 'offline');
  assertEquals(u.searchParams.get('login_hint'), 'tesoreria@colegio.cl');
});

Deno.test('webpay: crea y confirma en servidor; sólo AUTHORIZED con código 0 es válido', async () => {
  const llamadas: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push(`${init.method} ${url}`);
    if (init.method === 'POST') return new Response(JSON.stringify({ token: 't1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' }));
    return new Response(JSON.stringify({ status: 'AUTHORIZED', response_code: 0, amount: 3000, buy_order: 'CCPP1' }));
  }) as typeof fetch;
  const cfg = { ambiente: 'integracion' as const, codigoComercio: 'c', llaveSecreta: 's' };
  const t = await crearTransaccion(cfg, { buyOrder: 'CCPP1', sessionId: 's', monto: 3000, urlRetorno: 'https://x' }, f);
  assertEquals(t.token, 't1');
  const r = await confirmarTransaccion(cfg, 't1', f);
  assert(autorizada(r));
  assert(!autorizada({ status: 'FAILED', response_code: -1 }));
  assert(!autorizada({ status: 'AUTHORIZED', response_code: -1 }));
  assertStringIncludes(llamadas[1], 'PUT https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions/t1');
  await assertRejects(() => crearTransaccion(cfg, { buyOrder: 'X'.repeat(27), sessionId: 's', monto: 1, urlRetorno: 'u' }, f));
});
