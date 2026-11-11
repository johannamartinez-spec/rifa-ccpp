/**
 * Pruebas de extremo a extremo en Chrome con viewport de Android (Pixel 7), contra el
 * backend REAL local: PostgreSQL con las migraciones, PostgREST y la función Edge en Deno.
 * Auth y Storage son emulados por la pasarela de pruebas (ver e2e/entorno/pasarela.mjs).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

const db = new pg.Pool({ host: 'localhost', user: 'postgres', database: 'rifa_e2e' });
const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
const RIFA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLAVE = 'Clave-de-prueba-2026!';
// PNG mínimo válido (firma + IHDR + IEND)
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

test.afterAll(async () => { await db.end(); });

async function elegir(page: Page, numeros: number[]) {
  for (const n of numeros) await page.locator(`button[data-numero="${n}"]`).click();
}
async function completarFormulario(page: Page, datos: { nombre: string; curso: string; tel: string; email?: string }) {
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nombre y apellido').fill(datos.nombre);
  await page.getByLabel('Curso del estudiante').fill(datos.curso);
  await page.getByLabel('Celular').fill(datos.tel);
  if (datos.email) await page.getByLabel('Correo electrónico (opcional)').fill(datos.email);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Revisar y reservar' }).click();
}
async function ingresar(page: Page, email: string) {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/ingresar/);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(CLAVE);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

test('1-6, 18: apoderado reserva desde el celular y envía comprobante', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Gran Rifa Ficticia E2E' })).toBeVisible();
  await page.getByText('Elegir mis números').click();
  await expect(page.getByRole('heading', { name: 'Elige tus números' })).toBeVisible();

  // diseño responsivo: sin desplazamiento horizontal en el celular
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde).toBeLessThanOrEqual(0);

  // validación del formulario en el cliente
  await elegir(page, [10, 11, 12]);
  await expect(page.getByText('3 números · $6.000')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nombre y apellido').fill('Ana');
  await page.getByLabel('Celular').fill('123');
  await page.getByRole('button', { name: 'Revisar y reservar' }).click();
  await expect(page.getByText('Ingrese nombre y apellido')).toBeVisible();
  await expect(page.getByText(/Celular chileno inválido/)).toBeVisible();
  await page.getByRole('button', { name: 'Volver' }).click();

  await completarFormulario(page, { nombre: 'Ana Pérez Soto', curso: '3°A', tel: '9 8765 4321', email: 'ana@correo.test' });
  await expect(page.getByText('¿Confirmas tu reserva?')).toBeVisible();
  await page.getByRole('button', { name: 'Sí, reservar' }).click();

  await expect(page.getByText('¡Números reservados!')).toBeVisible();
  const codigo = (await page.getByTestId('codigo-reserva').textContent())!.trim();
  expect(codigo).toMatch(/^CCPP-/);
  await expect(page.getByText('Total a transferir: $6.000')).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('Tiempo para enviar el comprobante');

  const [r] = await q('select estado, monto_total from reservas where codigo = $1', [codigo]);
  expect(r).toEqual({ estado: 'reservado', monto_total: 6000 });
  expect((await q('select estado from numeros where rifa_id = $1 and numero = any($2)', [RIFA, [10, 11, 12]])).map((x) => x.estado)).toEqual(['reservado', 'reservado', 'reservado']);

  // archivo no permitido (validación en el cliente)
  await page.locator('input[type=file]').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByText('Formato no permitido. Use JPG, PNG o PDF.')).toBeVisible();
  // archivo disfrazado: extensión .png pero contenido HTML (lo rechaza el servidor)
  await page.locator('input[type=file]').setInputFiles({ name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('<html><script>alert(1)</script></html>') });
  await page.getByRole('button', { name: 'Enviar comprobante' }).click();
  await expect(page.getByText(/no corresponde a una imagen/)).toBeVisible();
  // comprobante válido
  await page.locator('input[type=file]').setInputFiles({ name: 'transferencia.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Enviar comprobante' }).click();
  await expect(page.getByText('¡Comprobante recibido!')).toBeVisible();

  const [r2] = await q('select estado, expira_at from reservas where codigo = $1', [codigo]);
  expect(r2.estado).toBe('comprobante_enviado');
  expect(r2.expira_at).toBeNull();
  expect((await q(`select count(*)::int c from respaldos_drive where codigo_reserva = $1 and estado = 'pendiente'`, [codigo]))[0].c).toBe(1);

  // consulta pública del estado
  await page.goto(`/reserva?codigo=${codigo}`);
  await page.getByLabel('Celular').fill('987654321');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByTestId('estado-reserva')).toHaveText('Comprobante enviado');
});

test('2-3: dos compradores eligen el mismo número; sólo uno lo obtiene', async ({ browser }) => {
  const abrir = async (b: Browser) => { const ctx = await b.newContext({ ...test.info().project.use }); const p = await ctx.newPage(); await p.goto(`/rifa/${RIFA}`); return p; };
  const p1 = await abrir(browser);
  const p2 = await abrir(browser);
  await elegir(p1, [20]);
  await elegir(p2, [20]);
  await completarFormulario(p1, { nombre: 'Bruno Díaz', curso: '1°B', tel: '911110001' });
  await completarFormulario(p2, { nombre: 'Carla Rojas', curso: '2°C', tel: '911110002' });
  await p1.getByRole('button', { name: 'Sí, reservar' }).click();
  await expect(p1.getByText('¡Números reservados!')).toBeVisible();
  await p2.getByRole('button', { name: 'Sí, reservar' }).click();
  await expect(p2.getByText(/alguien acaba de reservar: 20/)).toBeVisible();
  // tras el error, la grilla del segundo comprador se actualiza y el 20 ya no es seleccionable
  await expect(p2.locator('button[data-numero="20"]')).toHaveAttribute('data-estado', 'reservado');
  await expect(p2.locator('button[data-numero="20"]')).toBeDisabled();
  expect((await q(`select count(*)::int c from detalle_reservas d join numeros n on n.id = d.numero_id where n.rifa_id = $1 and n.numero = 20 and d.activo`, [RIFA]))[0].c).toBe(1);
  await p1.context().close(); await p2.context().close();
});

test('11: sin sesión o sin permiso no se accede al panel', async ({ page }) => {
  await page.goto('/admin/pagos');
  await expect(page).toHaveURL(/\/admin\/ingresar/);
  await page.getByLabel('Correo').fill('tesorera@e2e.test');
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();

  await ingresar(page, 'presidenta@e2e.test');
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.goto('/admin/pagos');
  await expect(page.getByText(/No tiene permiso para ver esta sección/)).toBeVisible();
  // ni siquiera manipulando la API: la base de datos devuelve 0 compradores
  const filas = await page.evaluate(async () => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'))!;
    const s = JSON.parse(localStorage.getItem(k)!);
    const r = await fetch('http://localhost:54321/rest/v1/compradores?select=*', { headers: { apikey: 'x', Authorization: `Bearer ${s.access_token}` } });
    return (await r.json()).length;
  });
  expect(filas).toBe(0);
});

test('12, 7-8, 9-10: Tesorería aprueba y rechaza pagos', async ({ page }) => {
  // preparar una segunda reserva con comprobante para rechazar
  const [{ r }] = await q(`select public.reservar_numeros($1, '{30,31}', 'Diego Muñoz', '4°A', '+56922223333') as r`, [RIFA]);
  await q(`select public.registrar_comprobante($1, '+56922223333', 'x/rechazo.png', 'rechazo.png', 'image/png', 100, repeat('b',64))`, [r.codigo]);

  await ingresar(page, 'tesorera@e2e.test');
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('link', { name: 'Pagos y comprobantes' }).click();
  await expect(page.getByRole('heading', { name: 'Pagos y comprobantes' })).toBeVisible();

  // aprobar la reserva de Ana
  await page.getByRole('row', { name: /Ana Pérez Soto/ }).click();
  await page.getByRole('button', { name: 'Ver' }).first().click();
  await page.getByRole('button', { name: 'Aprobar pago' }).click();
  await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(page.getByText('Pago aprobado', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Pagado y confirmado')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  expect((await q('select estado from numeros where rifa_id = $1 and numero = any($2)', [RIFA, [10, 11, 12]])).map((x) => x.estado)).toEqual(['vendido', 'vendido', 'vendido']);
  const [pago] = await q(`select p.validado_por from pagos p join reservas r on r.id = p.reserva_id join compradores c on c.id = r.comprador_id where c.nombre = 'Ana Pérez Soto' and p.estado = 'aprobado'`);
  expect(pago.validado_por).toBe('11111111-1111-1111-1111-111111111111');

  // rechazar definitivamente la de Diego -> números liberados
  await page.getByRole('row', { name: /Diego Muñoz/ }).click();
  await page.getByRole('button', { name: 'Rechazar / pedir otro' }).click();
  await page.getByLabel('Motivo (se informa al comprador)').fill('El monto transferido no coincide');
  await page.getByRole('button', { name: 'Rechazar', exact: true }).click();
  await expect(page.getByText('Pago rechazado y números liberados')).toBeVisible();
  expect((await q('select estado from numeros where rifa_id = $1 and numero = any($2) order by numero', [RIFA, [30, 31]])).map((x) => x.estado)).toEqual(['disponible', 'disponible']);
});

test('13: reporte financiero sólo con pagos confirmados', async ({ page }) => {
  await ingresar(page, 'tesorera@e2e.test');
  await page.goto('/admin/reportes');
  await page.getByLabel('Reporte').click();
  await page.getByRole('option', { name: 'Recaudación (sólo pagos confirmados)' }).click();
  await page.getByRole('button', { name: 'Generar' }).click();
  await expect(page.getByRole('cell', { name: '$6.000' }).first()).toBeVisible();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar Excel' }).click();
  expect((await descarga).suggestedFilename()).toMatch(/^RECAUDACION_TODAS_.*\.xlsx$/);
});

test('14-16: sorteo en el servidor, sólo pagados y verificable públicamente', async ({ page }) => {
  // Cancelar reservas abiertas para poder congelar sin forzar
  for (const { id } of await q(`select id from reservas where rifa_id = $1 and estado in ('reservado','pendiente_pago','comprobante_enviado','en_revision')`, [RIFA])) {
    await q(`select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}', false)`);
    await db.query(`begin; select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}', true); select public.cancelar_reserva('${id}', 'Limpieza de prueba e2e'); commit;`);
  }
  await ingresar(page, 'tesorera@e2e.test');
  await page.goto('/admin/sorteos');
  await page.getByLabel('Rifa').click();
  await page.getByRole('option', { name: /Gran Rifa Ficticia E2E/ }).click();
  await page.getByRole('button', { name: 'Cerrar ventas' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('heading', { name: 'Generar el padrón oficial' })).toBeVisible();
  await page.getByLabel('Cantidad de ganadores').fill('2');
  await page.getByRole('button', { name: 'Congelar padrón' }).click();
  await page.getByRole('button', { name: 'Congelar', exact: true }).click();
  await expect(page.getByText(/Padrón congelado/)).toBeVisible();
  await page.getByLabel('Entropía externa').fill('Dado lanzado en vivo: 4');
  await page.getByRole('button', { name: 'Ejecutar sorteo' }).click();
  await page.getByRole('button', { name: 'Sortear ahora' }).click();
  await expect(page.getByText(/Resultado \(inmutable\)/)).toBeVisible();

  const ganadores = (await q(`select g.numero from ganadores g join sorteos s on s.id = g.sorteo_id where s.rifa_id = $1 order by posicion`, [RIFA])).map((x) => x.numero);
  const pagados = (await q(`select n.numero from numeros n where n.rifa_id = $1 and n.estado = 'vendido'`, [RIFA])).map((x) => x.numero);
  expect(ganadores).toHaveLength(2);
  ganadores.forEach((g) => expect(pagados).toContain(g));

  // página pública de verificación: el navegador recalcula y coincide
  await page.goto(`/sorteo/${RIFA}/verificar`);
  await expect(page.getByText('Su navegador recalculó el sorteo y obtuvo exactamente los mismos ganadores.')).toBeVisible();
  // pantalla de transmisión: muestra ganadores (ya ejecutado => sin animación)
  await page.goto(`/sorteo/${RIFA}`);
  await expect(page.getByText(`N° ${ganadores[0]}`).first()).toBeVisible();
  // bitácora con operaciones del sorteo
  expect((await q(`select count(*)::int c from auditoria where operacion in ('CONGELAR_PADRON','EJECUTAR_SORTEO') and usuario_id = '11111111-1111-1111-1111-111111111111'`))[0].c).toBe(2);
});
