/**
 * Pruebas de integración de la base de datos (PostgreSQL 16 real + capa Supabase).
 * Cubren los casos obligatorios 1–16 del requerimiento.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anon, como, crearAdmin, crearRifaActiva, esperaError, estadosNumeros, pool, reservaId, reservar,
  servicio, sql, subirComprobante, telefono, type Contexto,
} from './helpers';
import { calcularGanadores, sha256Hex, verificarSorteo } from '../web/src/lib/sorteo';

let superadmin: Contexto, tesorera: Contexto, presidenta: Contexto, auditor: Contexto;
let rifa: { id: string; codigo: string };

beforeAll(async () => {
  superadmin = await crearAdmin('superadmin');
  tesorera = await crearAdmin('tesorera', 'Tesorera Prueba');
  presidenta = await crearAdmin('presidenta');
  auditor = await crearAdmin('auditor');
  rifa = await crearRifaActiva(tesorera, { hasta: 200, minutos: 30, maxTel: 50 });
});
afterAll(async () => { await pool.end(); });

describe('Caso 1 — reserva de números disponibles', () => {
  it('reserva, calcula el monto, genera código y fija plazo', async () => {
    const r = await reservar(rifa.id, [5, 6, 7], telefono(), { email: 'apoderado@correo.test' });
    expect(r.codigo).toMatch(/^CCPP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(r.monto_total).toBe(3000);
    const min = (new Date(r.expira_at).getTime() - Date.now()) / 60000;
    expect(min).toBeGreaterThan(29);
    expect(min).toBeLessThanOrEqual(30);
    expect(await estadosNumeros(rifa.id, [5, 6, 7])).toEqual({ 5: 'reservado', 6: 'reservado', 7: 'reservado' });
    const [n] = await sql(`select count(*)::int c from public.notificaciones where tipo = 'reserva_confirmada' and destinatario = 'apoderado@correo.test'`);
    expect(n.c).toBe(1);
  });

  it('rechaza datos inválidos (teléfono, nombre sin apellido, selección vacía, número inexistente)', async () => {
    await esperaError(como(anon(), `select public.reservar_numeros($1, '{10}', 'Ana Pérez', '1A', '12345')`, [rifa.id]), 'teléfono');
    await esperaError(como(anon(), `select public.reservar_numeros($1, '{10}', 'Ana', '1A', '+56911111111')`, [rifa.id]), 'nombre y apellido');
    await esperaError(como(anon(), `select public.reservar_numeros($1, '{}', 'Ana Pérez', '1A', '+56911111111')`, [rifa.id]), 'al menos un número');
    await esperaError(reservar(rifa.id, [9999]), 'NUMEROS_INEXISTENTES');
  });

  it('el visitante ve el estado de los números pero NO los datos personales', async () => {
    const nums = await como(anon(), `select numero, estado from public.numeros where rifa_id = $1 and numero = 5`, [rifa.id]);
    expect(nums[0].estado).toBe('reservado');
    await esperaError(como(anon(), 'select * from public.compradores'), 'permission denied');
    await esperaError(como(anon(), 'select * from public.reservas'), 'permission denied');
    await esperaError(como(anon(), 'select * from public.detalle_reservas'), 'permission denied');
    const cols = await sql(`select column_name from information_schema.columns where table_schema='public' and table_name='numeros'`);
    expect(cols.map((c: any) => c.column_name).sort()).toEqual(['estado', 'id', 'numero', 'rifa_id', 'updated_at']);
  });

  it('consulta de reserva exige código y teléfono correctos', async () => {
    const r = await reservar(rifa.id, [11]);
    const [ok] = await como(anon(), 'select public.consultar_reserva($1, $2) as r', [r.codigo, r.telefono]);
    expect(ok.r.estado).toBe('reservado');
    expect(ok.r.numeros).toEqual([11]);
    expect(ok.r).not.toHaveProperty('telefono');
    await esperaError(como(anon(), 'select public.consultar_reserva($1, $2)', [r.codigo, '+56900000000']), 'RESERVA_NO_ENCONTRADA');
  });
});

describe('Casos 2 y 3 — concurrencia: dos o más compradores por el mismo número', () => {
  it('60 compradores simultáneos por el número 50: exactamente uno lo obtiene', async () => {
    const intentos = Array.from({ length: 60 }, (_, i) =>
      reservar(rifa.id, [50], telefono(), { ip: `192.168.1.${i}` }).then(() => 'ok', (e) => String(e.message)));
    const res = await Promise.all(intentos);
    const exitos = res.filter((r) => r === 'ok');
    expect(exitos).toHaveLength(1);
    expect(res.filter((r) => r.includes('NUMEROS_NO_DISPONIBLES'))).toHaveLength(59);
    const [d] = await sql(`select count(*)::int c from public.detalle_reservas d join public.numeros n on n.id = d.numero_id
                           where n.rifa_id = $1 and n.numero = 50 and d.activo`, [rifa.id]);
    expect(d.c).toBe(1);
  });

  it('selecciones superpuestas en paralelo nunca duplican números (sin interbloqueos)', async () => {
    const tareas = Array.from({ length: 40 }, (_, i) => {
      const base = 100 + (i % 10) * 3;
      const sel = [base, base + 1, base + 2, base + 4].filter((n) => n <= 200);
      return reservar(rifa.id, i % 2 ? sel : [...sel].reverse(), telefono(), { ip: `172.16.0.${i}` })
        .then((r) => r.numeros, (e) => { if (!String(e.message).includes('NO_DISPONIBLES')) throw e; return null; });
    });
    const res = await Promise.all(tareas);
    const asignados = res.filter(Boolean).flat() as number[];
    expect(new Set(asignados).size).toBe(asignados.length);
    const [inc] = await sql(`
      select count(*)::int c from public.numeros n
       where n.rifa_id = $1 and (
         (n.estado in ('reservado','pendiente_pago','vendido')) <>
         exists (select 1 from public.detalle_reservas d where d.numero_id = n.id and d.activo))`, [rifa.id]);
    expect(inc.c).toBe(0);
  });

  it('el índice único impide un segundo detalle activo aunque se salte la función', async () => {
    const r = await reservar(rifa.id, [60]);
    const otra = await reservar(rifa.id, [61]);
    await esperaError(sql(`insert into public.detalle_reservas (reserva_id, numero_id, rifa_id, numero)
      select $1, n.id, n.rifa_id, n.numero from public.numeros n where n.rifa_id = $2 and n.numero = 60`,
      [await reservaId(otra.codigo), rifa.id]), 'detalle_numero_activo_uk');
    expect(r.numeros).toEqual([60]);
  });
});

describe('Casos 4 y 5 — vencimiento y liberación', () => {
  it('la tarea programada expira la reserva y libera los números', async () => {
    const r = await reservar(rifa.id, [70, 71], telefono(), { email: 'vence@correo.test' });
    await sql(`update public.reservas set expira_at = now() - interval '1 second' where codigo = $1`, [r.codigo]);
    const [x] = await como(servicio, 'select public.liberar_reservas_vencidas() as n');
    expect(x.n).toBeGreaterThanOrEqual(1);
    expect(await estadosNumeros(rifa.id, [70, 71])).toEqual({ 70: 'disponible', 71: 'disponible' });
    const [re] = await sql('select estado from public.reservas where codigo = $1', [r.codigo]);
    expect(re.estado).toBe('expirado');
    const [n] = await sql(`select count(*)::int c from public.notificaciones where tipo='reserva_expirada' and destinatario='vence@correo.test'`);
    expect(n.c).toBe(1);
  });

  it('liberación perezosa: otro comprador obtiene un número vencido aunque el cron no haya corrido', async () => {
    const r = await reservar(rifa.id, [72]);
    await sql(`update public.reservas set expira_at = now() - interval '1 second' where codigo = $1`, [r.codigo]);
    const r2 = await reservar(rifa.id, [72]);
    expect(r2.numeros).toEqual([72]);
    const [re] = await sql('select estado from public.reservas where codigo = $1', [r.codigo]);
    expect(re.estado).toBe('expirado');
  });

  it('no se puede subir comprobante a una reserva vencida', async () => {
    const r = await reservar(rifa.id, [73]);
    await sql(`update public.reservas set expira_at = now() - interval '1 second' where codigo = $1`, [r.codigo]);
    await esperaError(subirComprobante(r.codigo, r.telefono), 'RESERVA_NO_ADMITE_COMPROBANTE');
  });
});

describe('Casos 6, 7 y 8 — comprobante y aprobación', () => {
  it('el comprobante detiene el plazo y deja los números en validación', async () => {
    const r = await reservar(rifa.id, [80, 81]);
    const c = await subirComprobante(r.codigo, r.telefono);
    expect(c.estado).toBe('comprobante_enviado');
    expect(await estadosNumeros(rifa.id, [80, 81])).toEqual({ 80: 'pendiente_pago', 81: 'pendiente_pago' });
    const [re] = await sql('select estado, expira_at from public.reservas where codigo = $1', [r.codigo]);
    expect(re.expira_at).toBeNull();
    const [bk] = await sql(`select count(*)::int c from public.respaldos_drive where codigo_reserva = $1 and estado = 'pendiente'`, [r.codigo]);
    expect(bk.c).toBe(1);
  });

  it('un visitante NO puede registrar comprobantes directamente (sólo la función Edge)', async () => {
    const r = await reservar(rifa.id, [82]);
    await esperaError(como(anon(), `select public.registrar_comprobante($1,$2,'x','x.jpg','image/jpeg',10,$3)`,
      [r.codigo, r.telefono, 'a'.repeat(64)]), 'permission denied');
  });

  it('Tesorería aprueba y los números pasan a vendidos con trazabilidad', async () => {
    const r = await reservar(rifa.id, [83, 84]);
    await subirComprobante(r.codigo, r.telefono);
    const id = await reservaId(r.codigo);
    await como(tesorera, 'select public.iniciar_revision($1)', [id]);
    const [a] = await como(tesorera, 'select public.aprobar_pago($1, $2) as r', [id, 'Transferencia verificada en cartola']);
    expect(a.r.estado).toBe('pagado');
    expect(await estadosNumeros(rifa.id, [83, 84])).toEqual({ 83: 'vendido', 84: 'vendido' });
    const [p] = await sql(`select estado, validado_por, validado_at from public.pagos where reserva_id = $1`, [id]);
    expect(p.estado).toBe('aprobado');
    expect(p.validado_por).toBe(tesorera.sub);
    expect(p.validado_at).not.toBeNull();
  });

  it('nadie puede marcar como pagada una reserva sin validación autorizada', async () => {
    const r = await reservar(rifa.id, [85]);
    await subirComprobante(r.codigo, r.telefono);
    const id = await reservaId(r.codigo);
    // presidenta sin permiso pagos.validar
    await esperaError(como(presidenta, 'select public.aprobar_pago($1)', [id]), 'SIN_PERMISO');
    // auditor: sólo lectura
    await esperaError(como(auditor, 'select public.aprobar_pago($1)', [id]), 'SIN_PERMISO');
    // tesorera no puede saltarse la función con UPDATE directo
    await esperaError(como(tesorera, `update public.reservas set estado = 'pagado' where id = $1`, [id]), 'permission denied');
    // ni siquiera el superusuario sin un pago aprobado (trigger)
    await esperaError(sql(`update public.reservas set estado = 'pagado' where id = $1`, [id]), 'PAGO_NO_VALIDADO');
    // ni con un pago "aprobado" falso sin validador
    await esperaError(sql(`update public.pagos set estado='aprobado', validado_at=now() where reserva_id=$1`, [id]), 'pagos_validacion_ck');
  });

  it('confirmación manual exige justificación y queda registrada como ajuste', async () => {
    const r = await reservar(rifa.id, [86]);
    const id = await reservaId(r.codigo);
    await esperaError(como(tesorera, `select public.confirmar_pago_manual($1, 'efectivo', null, 'ok')`, [id]), 'justificar');
    await como(tesorera, `select public.confirmar_pago_manual($1, 'efectivo', null, 'Pago en efectivo en reunión de apoderados 4°B')`, [id]);
    expect(await estadosNumeros(rifa.id, [86])).toEqual({ 86: 'vendido' });
    const [aj] = await como(tesorera, `select public.reporte('ajustes', $1) as r`, [rifa.id]);
    expect(aj.r.some((x: any) => x.reserva === r.codigo && x.tipo === 'CONFIRMACION_MANUAL')).toBe(true);
  });
});

describe('Casos 9 y 10 — rechazo de pago', () => {
  it('rechazo definitivo libera los números', async () => {
    const r = await reservar(rifa.id, [90, 91]);
    await subirComprobante(r.codigo, r.telefono);
    const id = await reservaId(r.codigo);
    await esperaError(como(tesorera, `select public.rechazar_pago($1, '')`, [id]), 'motivo');
    await como(tesorera, `select public.rechazar_pago($1, 'El comprobante no corresponde al monto', false)`, [id]);
    expect(await estadosNumeros(rifa.id, [90, 91])).toEqual({ 90: 'disponible', 91: 'disponible' });
    const [c] = await sql(`select estado_revision, motivo_rechazo from public.comprobantes where reserva_id = $1`, [id]);
    expect(c.estado_revision).toBe('rechazado');
    // otro comprador puede tomarlos
    expect((await reservar(rifa.id, [90])).numeros).toEqual([90]);
  });

  it('solicitar nuevo comprobante mantiene los números con un nuevo plazo', async () => {
    const r = await reservar(rifa.id, [92]);
    await subirComprobante(r.codigo, r.telefono);
    const id = await reservaId(r.codigo);
    await como(tesorera, `select public.rechazar_pago($1, 'Imagen ilegible, envíe otra', true)`, [id]);
    expect(await estadosNumeros(rifa.id, [92])).toEqual({ 92: 'reservado' });
    const [re] = await sql('select estado, expira_at from public.reservas where id = $1', [id]);
    expect(re.estado).toBe('pendiente_pago');
    expect(re.expira_at).not.toBeNull();
    await subirComprobante(r.codigo, r.telefono);
    await como(tesorera, 'select public.aprobar_pago($1)', [id]);
    expect(await estadosNumeros(rifa.id, [92])).toEqual({ 92: 'vendido' });
  });
});

describe('Casos 11 y 12 — acceso al panel', () => {
  it('un usuario autenticado sin rol administrativo no ve datos ni ejecuta acciones', async () => {
    const intruso: Contexto = { rol: 'authenticated', sub: '00000000-0000-0000-0000-00000000dead', aal: 'aal2' };
    expect(await como(intruso, 'select * from public.compradores')).toHaveLength(0);
    expect(await como(intruso, 'select * from public.pagos')).toHaveLength(0);
    expect(await como(intruso, 'select * from public.auditoria')).toHaveLength(0);
    await esperaError(como(intruso, 'select public.dashboard_resumen()'), 'SIN_PERMISO');
    await esperaError(como(intruso, `insert into public.rifas (nombre, colegio, centro_padres, precio_numero, numero_final) values ('X rifa','C','CP',1000,10)`), 'row-level security');
  });

  it('anónimo no ejecuta funciones administrativas', async () => {
    await esperaError(como(anon(), `select public.aprobar_pago(gen_random_uuid())`), 'permission denied');
    await esperaError(como(anon(), `select public.dashboard_resumen()`), 'permission denied');
  });

  it('con MFA obligatorio, una sesión aal1 no tiene permisos', async () => {
    const t1 = { ...tesorera, aal: 'aal1' as const };
    expect(await como(t1, 'select * from public.compradores')).toHaveLength(0);
    await esperaError(como(t1, 'select public.dashboard_resumen()'), 'SIN_PERMISO');
  });

  it('un administrador autorizado (aal2) accede y ve el dashboard', async () => {
    const [d] = await como(tesorera, 'select public.dashboard_resumen($1) as d', [rifa.id]);
    expect(d.d.numeros.total).toBe(200);
    expect((await como(tesorera, 'select * from public.compradores')).length).toBeGreaterThan(0);
  });

  it('el auditor lee pero no puede modificar', async () => {
    expect((await como(auditor, 'select * from public.auditoria limit 5')).length).toBeGreaterThan(0);
    await esperaError(como(auditor, `update public.rifas set nombre = 'Hackeada' where id = $1`, [rifa.id]).then((r) => {
      if (r.length === 0) throw new Error('row-level security: sin filas'); }), /row-level|permission/);
    const [x] = await sql('select nombre from public.rifas where id = $1', [rifa.id]);
    expect(x.nombre).toBe('Rifa de prueba');
  });

  it('nadie puede cambiar su propio rol; sólo superadmin otorga superadmin', async () => {
    await esperaError(como(superadmin, `update public.usuarios set rol = 'auditor' where id = $1`, [superadmin.sub]), 'propio rol');
    const [u] = await como(superadmin, `update public.usuarios set rol = 'secretaria' where id = $1 returning rol`, [presidenta.sub]);
    expect(u.rol).toBe('secretaria');
    await como(superadmin, `update public.usuarios set rol = 'presidenta' where id = $1`, [presidenta.sub]);
  });
});

describe('Protección de la rifa y abuso', () => {
  it('no se puede cambiar el precio ni reducir el rango con ventas iniciadas', async () => {
    await esperaError(como(tesorera, 'update public.rifas set precio_numero = 500 where id = $1', [rifa.id]), 'precio');
    await esperaError(como(tesorera, 'update public.rifas set numero_final = 150 where id = $1', [rifa.id]), 'ampliar');
    await esperaError(como(tesorera, 'delete from public.rifas where id = $1', [rifa.id]).then((r) => r), /RIFA_PROTEGIDA|row-level|^$/).catch(() => {});
    const [n] = await sql('select count(*)::int c from public.rifas where id = $1', [rifa.id]);
    expect(n.c).toBe(1);
  });

  it('límite de reservas activas por teléfono', async () => {
    const r2 = await crearRifaActiva(tesorera, { hasta: 20, maxTel: 2 });
    const tel = telefono();
    await reservar(r2.id, [1], tel);
    await reservar(r2.id, [2], tel);
    await esperaError(reservar(r2.id, [3], tel), 'LIMITE_EXCEDIDO');
  });

  it('una rifa en borrador no es visible ni reservable', async () => {
    const [b] = await como(tesorera, `insert into public.rifas (nombre, colegio, centro_padres, precio_numero, numero_final)
       values ('Borrador secreto', 'Colegio', 'CCPP', 1000, 10) returning id`);
    expect(await como(anon(), 'select * from public.rifas where id = $1', [b.id])).toHaveLength(0);
    expect(await como(anon(), 'select * from public.numeros where rifa_id = $1', [b.id])).toHaveLength(0);
    await esperaError(reservar(b.id, [1]), 'RIFA_NO_DISPONIBLE');
  });

  it('almacenamiento: comprobantes privados, legibles sólo con pagos.ver', async () => {
    await sql(`insert into storage.objects (bucket_id, name) values ('comprobantes', 'x/y.jpg')`);
    expect(await como(anon(), `select * from storage.objects where bucket_id = 'comprobantes'`)).toHaveLength(0);
    expect(await como(presidenta, `select * from storage.objects where bucket_id = 'comprobantes'`)).toHaveLength(0);
    expect((await como(tesorera, `select * from storage.objects where bucket_id = 'comprobantes'`)).length).toBe(1);
    await esperaError(como(anon(), `insert into storage.objects (bucket_id, name) values ('comprobantes', 'malo.jpg')`), 'row-level security');
  });
});

describe('Caso 13 — reporte financiero', () => {
  it('la recaudación considera sólo pagos aprobados', async () => {
    const r3 = await crearRifaActiva(tesorera, { hasta: 30, precio: 2000 });
    const a = await reservar(r3.id, [1, 2]);      // se aprueba: 4000
    const b = await reservar(r3.id, [3]);         // comprobante pendiente: no cuenta
    await reservar(r3.id, [4]);                   // sin pagar: no cuenta
    await subirComprobante(a.codigo, a.telefono);
    await subirComprobante(b.codigo, b.telefono);
    await como(tesorera, 'select public.aprobar_pago($1)', [await reservaId(a.codigo)]);
    const [rep] = await como(tesorera, `select public.reporte('recaudacion', $1) as r`, [r3.id]);
    expect(Number(rep.r.total_confirmado)).toBe(4000);
    const [conf] = await como(tesorera, `select public.reporte('pagos_confirmados', $1) as r`, [r3.id]);
    expect(conf.r).toHaveLength(1);
    expect(conf.r[0].validado_por).toBe('Tesorera Prueba');
    const [pend] = await como(tesorera, `select public.reporte('pagos_pendientes', $1) as r`, [r3.id]);
    expect(pend.r).toHaveLength(2);
    // filtro por curso inexistente
    const [vac] = await como(tesorera, `select public.reporte('pagos_confirmados', $1, null, null, '8°Z') as r`, [r3.id]);
    expect(vac.r).toHaveLength(0);
    // presidenta: tiene reportes.ver pero no datos personales
    await como(presidenta, `select public.reporte('ventas_por_rifa', $1)`, [r3.id]);
    await esperaError(como(presidenta, `select public.reporte('compradores', $1)`, [r3.id]), 'compradores.ver');
  });

  it('revertir un pago queda como ajuste trazable', async () => {
    const r4 = await crearRifaActiva(tesorera, { hasta: 10 });
    const a = await reservar(r4.id, [1]);
    await subirComprobante(a.codigo, a.telefono);
    const id = await reservaId(a.codigo);
    await como(tesorera, 'select public.aprobar_pago($1)', [id]);
    await como(tesorera, `select public.revertir_pago($1, 'Aprobado por error: depósito era de otra rifa', true)`, [id]);
    expect(await estadosNumeros(r4.id, [1])).toEqual({ 1: 'disponible' });
    const [rep] = await como(tesorera, `select public.reporte('recaudacion', $1) as r`, [r4.id]);
    expect(Number(rep.r.total_confirmado)).toBe(0);
    expect(Number(rep.r.total_revertido)).toBe(1000);
  });
});

describe('Casos 14, 15 y 16 — sorteo auditable', () => {
  let rs: { id: string; codigo: string };
  let pagados: number[] = [];
  let sorteoId: string;

  beforeAll(async () => {
    rs = await crearRifaActiva(tesorera, { hasta: 50 });
    await como(tesorera, `insert into public.premios (rifa_id, posicion, nombre) values ($1,1,'Gift card $50.000'),($1,2,'Canasta familiar'),($1,3,'Entrada al cine')`, [rs.id]);
    for (let i = 0; i < 12; i++) {
      const nums = [i * 4 + 1, i * 4 + 2];
      const r = await reservar(rs.id, nums, telefono(), { email: `p${i}@correo.test` });
      if (i < 8) {
        await subirComprobante(r.codigo, r.telefono);
        await como(tesorera, 'select public.aprobar_pago($1)', [await reservaId(r.codigo)]);
        pagados.push(...nums);
      } else if (i < 10) {
        await subirComprobante(r.codigo, r.telefono); // pendiente
      }
    }
    pagados = pagados.sort((a, b) => a - b);
  });

  it('no se congela el padrón con ventas abiertas ni con reservas pendientes (sin forzar)', async () => {
    await esperaError(como(tesorera, 'select public.congelar_padron($1, 3)', [rs.id]), 'cerrar las ventas');
    await como(tesorera, 'select public.cerrar_ventas($1)', [rs.id]);
    await esperaError(reservar(rs.id, [49]), 'RIFA_NO_DISPONIBLE');
    await esperaError(como(tesorera, 'select public.congelar_padron($1, 3)', [rs.id]), 'RESERVAS_PENDIENTES');
    await esperaError(como(presidenta, 'select public.congelar_padron($1, 3, false, true)', [rs.id]), 'SIN_PERMISO');
  });

  it('el padrón contiene sólo números pagados y publica un compromiso de semilla', async () => {
    const [p] = await como(tesorera, 'select public.congelar_padron($1, 3, false, true) as r', [rs.id]);
    sorteoId = p.r.sorteo_id;
    expect(p.r.total_participantes).toBe(16);
    expect(p.r.reservas_excluidas).toBe(4);
    const part = await sql('select numero from public.participantes_sorteo where sorteo_id = $1 order by orden', [sorteoId]);
    expect(part.map((x: any) => x.numero)).toEqual(pagados);
    expect(p.r.padron_hash).toBe(await sha256Hex(pagados.join(',')));
    // la semilla no es visible antes del sorteo
    const [pub] = await como(anon(), 'select public.sorteo_publico($1) as s', [rs.id]);
    expect(pub.s.sorteo.semilla).toBeNull();
    expect(pub.s.sorteo.semilla_compromiso).toMatch(/^[0-9a-f]{64}$/);
    await esperaError(como(anon(), 'select * from interno.semillas_sorteo'), 'permission denied');
    // no se puede alterar el padrón congelado
    await esperaError(sql('update public.participantes_sorteo set numero = 49 where sorteo_id = $1', [sorteoId]), 'REGISTRO_INMUTABLE');
    await esperaError(sql(`update public.sorteos set padron_hash = repeat('0',64) where id = $1`, [sorteoId]), 'SORTEO_INMUTABLE');
    // ni revertir pagos después de congelar
    const [g] = await sql(`select reserva_id from public.participantes_sorteo where sorteo_id = $1 limit 1`, [sorteoId]);
    await esperaError(como(tesorera, `select public.revertir_pago($1, 'intento posterior al congelamiento', true)`, [g.reserva_id]), 'padrón');
  });

  it('ejecuta en el servidor, ganadores únicos y pagados, verificable en el navegador', async () => {
    const [e] = await como(tesorera, `select public.ejecutar_sorteo($1, $2) as r`, [sorteoId, 'Lotería 2026-12-15: 4-18-22-31']);
    const s = e.r.sorteo;
    expect(s.estado).toBe('ejecutado');
    const nums = s.ganadores.map((g: any) => g.numero);
    expect(nums).toHaveLength(3);
    expect(new Set(nums).size).toBe(3);
    nums.forEach((n: number) => expect(pagados).toContain(n));
    expect(s.ganadores[0].premio).toBe('Gift card $50.000');

    // Verificación independiente con la implementación TypeScript pública
    const v = await verificarSorteo({
      padron: s.participantes, padronHash: s.padron_hash, semilla: s.semilla, semillaCompromiso: s.semilla_compromiso,
      entropia: s.entropia_externa, cantidad: s.cantidad_ganadores, permitirRepetidos: s.permitir_repetidos, ganadores: s.ganadores,
    });
    expect(v).toMatchObject({ padronOk: true, compromisoOk: true, ganadoresOk: true });

    // no se puede volver a ejecutar ni modificar
    await esperaError(como(tesorera, `select public.ejecutar_sorteo($1, 'otra')`, [sorteoId]), 'SORTEO_YA_EJECUTADO');
    await esperaError(sql('update public.ganadores set numero = 1 where sorteo_id = $1', [sorteoId]), 'REGISTRO_INMUTABLE');
    await esperaError(sql('delete from public.ganadores where sorteo_id = $1', [sorteoId]), 'REGISTRO_INMUTABLE');
    await esperaError(sql(`update public.sorteos set entropia_externa = 'x' where id = $1`, [sorteoId]), 'SORTEO_INMUTABLE');
    const [rf] = await sql('select estado from public.rifas where id = $1', [rs.id]);
    expect(rf.estado).toBe('sorteada');
    const [n] = await sql(`select count(*)::int c from public.notificaciones where tipo = 'resultado_sorteo' and rifa_id = $1`, [rs.id]);
    expect(n.c).toBe(8);
  });

  it('la función pura SQL y la de TypeScript coinciden en 200 sorteos aleatorios', async () => {
    for (let t = 0; t < 200; t++) {
      const tam = 1 + Math.floor(Math.random() * 300);
      const padron = Array.from({ length: tam }, (_, i) => i * 3 + (t % 3)).sort((a, b) => a - b);
      const cantidad = 1 + Math.floor(Math.random() * Math.min(5, tam));
      const rep = t % 4 === 0;
      const semilla = (await sha256Hex(`semilla-${t}`));
      const ph = await sha256Hex(padron.join(','));
      const ent = t % 2 ? `externo-${t}` : '';
      const db = await sql(`select posicion, numero, intento from public.calcular_ganadores_sorteo($1,$2,$3,$4,$5,$6)`,
        [semilla, ph, ent, padron, cantidad, rep]);
      const js = await calcularGanadores({ semilla, padronHash: ph, entropia: ent, padron, cantidad, permitirRepetidos: rep });
      expect(js).toEqual(db);
    }
  });

  it('registro de entrega de premio (una vez, inmutable)', async () => {
    const [g] = await sql('select id from public.ganadores where sorteo_id = $1 and posicion = 1', [sorteoId]);
    await como(tesorera, `select public.registrar_entrega_premio($1, 'Apoderada titular', 'Entregado en reunión')`, [g.id]);
    await esperaError(como(tesorera, `select public.registrar_entrega_premio($1, 'Otra persona')`, [g.id]), 'duplicate key');
    const [rep] = await como(tesorera, `select public.reporte('premios_entregados', $1) as r`, [rs.id]);
    expect(rep.r).toHaveLength(1);
  });

  it('Caso 16 — trazabilidad: historial, auditoría con usuario e inmutabilidad de la bitácora', async () => {
    const [r] = await sql(`select re.id from public.reservas re where re.rifa_id = $1 and re.estado = 'pagado' limit 1`, [rs.id]);
    const hist = await sql('select estado_anterior, estado_nuevo, actor, usuario_id from public.historial_reservas where reserva_id = $1 order by id', [r.id]);
    expect(hist.map((h: any) => h.estado_nuevo)).toEqual(['reservado', 'comprobante_enviado', 'pagado']);
    expect(hist[2].usuario_id).toBe(tesorera.sub);
    const aud = await sql(`select usuario_id, operacion from public.auditoria where registro_id = $1 and operacion = 'APROBAR_PAGO'`, [r.id]);
    expect(aud).toHaveLength(1);
    expect(aud[0].usuario_id).toBe(tesorera.sub);
    const [cong] = await sql(`select count(*)::int c from public.auditoria where operacion in ('CONGELAR_PADRON','EJECUTAR_SORTEO') and registro_id = $1`, [sorteoId]);
    expect(cong.c).toBe(2);
    await esperaError(sql('update public.auditoria set operacion = $1 where id = (select max(id) from public.auditoria)', ['X']), 'REGISTRO_INMUTABLE');
    await esperaError(sql('delete from public.auditoria'), 'REGISTRO_INMUTABLE');
    await esperaError(como(tesorera, 'delete from public.auditoria'), 'permission denied');
  });
});

describe('Lista blanca de privilegios (protección contra exposición accidental)', () => {
  it('anon sólo puede ejecutar las funciones públicas previstas', async () => {
    const rows = await sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(rows.map((r: any) => r.proname)).toEqual(['calcular_ganadores_sorteo', 'consultar_reserva', 'es_usuario_admin',
      'reservar_numeros', 'sorteo_publico', 'tiene_permiso']);
  });
  it('anon sólo puede leer tablas públicas y no escribe en ninguna', async () => {
    const rows = await sql(`select c.relname, has_table_privilege('anon', c.oid, 'select') s,
        has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete') w
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v') order by 1`);
    expect(rows.filter((r: any) => r.s).map((r: any) => r.relname)).toEqual(['configuraciones', 'numeros', 'premios', 'rifas', 'sorteos']);
    expect(rows.filter((r: any) => r.w)).toHaveLength(0);
  });
  it('todas las tablas de public tienen RLS activo', async () => {
    const rows = await sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toHaveLength(0);
  });
  it('funciones de servidor no son ejecutables por administradores autenticados', async () => {
    for (const f of ['registrar_comprobante', 'tomar_notificaciones', 'tomar_respaldos', 'confirmar_pago_pasarela', 'liberar_reservas_vencidas']) {
      const [r] = await sql(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p where proname = $1`, [f]);
      expect(r.x, f).toBe(false);
    }
  });
});

describe('Privacidad', () => {
  it('anonimizar un comprador sin reservas en curso', async () => {
    const r5 = await crearRifaActiva(tesorera, { hasta: 5 });
    const a = await reservar(r5.id, [1], telefono(), { nombre: 'Pedro Soto', email: 'pedro@correo.test' });
    const [c] = await sql('select comprador_id from public.reservas where codigo = $1', [a.codigo]);
    await esperaError(como(tesorera, `select public.anonimizar_comprador($1, 'Solicitud del titular')`, [c.comprador_id]), 'en curso');
    await como(tesorera, `select public.cancelar_reserva($1, 'Solicitud del apoderado')`, [await reservaId(a.codigo)]);
    await como(tesorera, `select public.anonimizar_comprador($1, 'Solicitud del titular')`, [c.comprador_id]);
    const [x] = await sql('select nombre, telefono, email, anonimizado_at from public.compradores where id = $1', [c.comprador_id]);
    expect(x).toMatchObject({ nombre: 'Titular anonimizado', telefono: null, email: null });
  });
});
