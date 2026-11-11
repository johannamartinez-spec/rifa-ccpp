import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  user: process.env.PGUSER ?? 'postgres',
  database: 'rifa_test',
  max: 80,
});

type Rol = 'anon' | 'authenticated' | 'service_role';

export interface Contexto {
  rol: Rol;
  sub?: string;
  email?: string;
  aal?: 'aal1' | 'aal2';
  ip?: string;
}

/** Ejecuta una consulta simulando el contexto de PostgREST (rol + JWT + cabeceras). */
export async function como<T = any>(ctx: Contexto, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('role', $1, true)`, [ctx.rol]);
    const claims = { role: ctx.rol, sub: ctx.sub, email: ctx.email, aal: ctx.aal ?? 'aal2' };
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(`select set_config('request.headers', $1, true)`, [
      JSON.stringify({ 'x-forwarded-for': ctx.ip ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
    ]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const anon = (ip?: string): Contexto => ({ rol: 'anon', ip });
export const servicio: Contexto = { rol: 'service_role' };

/** Consulta como superusuario (preparación de datos de prueba). */
export async function sql<T = any>(q: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(q, params)).rows as T[];
}

export async function crearAdmin(rol: string, nombre = `Usuario ${rol}`): Promise<Contexto> {
  const id = randomUUID();
  const email = `${rol}.${id.slice(0, 6)}@ccpp.test`;
  await sql('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  await sql('insert into public.usuarios (id, email, nombre, rol) values ($1, $2, $3, $4)', [id, email, nombre, rol]);
  return { rol: 'authenticated', sub: id, email, aal: 'aal2' };
}

let correlativoTel = 10000000;
export function telefono(): string {
  correlativoTel += 1;
  return `+569${correlativoTel}`;
}

export async function crearRifaActiva(tesorera: Contexto, opciones: Partial<{ desde: number; hasta: number; precio: number; minutos: number; maxTel: number }> = {}) {
  const [r] = await como(tesorera, `
    insert into public.rifas (nombre, colegio, centro_padres, precio_numero, numero_inicial, numero_final,
                              fecha_sorteo, bases, info_pago, minutos_reserva, max_reservas_activas_telefono)
    values ('Rifa de prueba', 'Colegio Ficticio', 'CCPP Ficticio', $1, $2, $3, now() + interval '30 days',
            'Bases de prueba', 'Transferir a cuenta ficticia', $4, $5)
    returning id, codigo`, [opciones.precio ?? 1000, opciones.desde ?? 1, opciones.hasta ?? 100, opciones.minutos ?? 30, opciones.maxTel ?? 3]);
  await como(tesorera, `update public.rifas set estado = 'activa' where id = $1`, [r.id]);
  return r as { id: string; codigo: string };
}

export async function reservar(rifaId: string, numeros: number[], tel = telefono(), extra: { email?: string; ip?: string; nombre?: string } = {}) {
  const [r] = await como(anon(extra.ip), `select public.reservar_numeros($1, $2, $3, '4°B', $4, $5) as r`,
    [rifaId, numeros, extra.nombre ?? 'María González', tel, extra.email ?? null]);
  return { ...(r.r as any), telefono: tel } as { codigo: string; numeros: number[]; monto_total: number; expira_at: string; telefono: string };
}

export async function subirComprobante(codigo: string, tel: string, sha = randomUUID().replace(/-/g, '').padEnd(64, '0')) {
  const [r] = await como(servicio, `select public.registrar_comprobante($1, $2, $3, 'comprobante.jpg', 'image/jpeg', 12345, $4) as r`,
    [codigo, tel, `rifa/${codigo}/${randomUUID()}.jpg`, sha]);
  return r.r;
}

export async function reservaId(codigo: string): Promise<string> {
  const [r] = await sql('select id from public.reservas where codigo = $1', [codigo]);
  return r.id;
}

export async function estadosNumeros(rifaId: string, numeros: number[]): Promise<Record<number, string>> {
  const rows = await sql('select numero, estado from public.numeros where rifa_id = $1 and numero = any($2)', [rifaId, numeros]);
  return Object.fromEntries(rows.map((r: any) => [r.numero, r.estado]));
}

export async function esperaError(p: Promise<unknown>, patron: RegExp | string) {
  try {
    await p;
  } catch (e: any) {
    const msg = String(e.message);
    if (typeof patron === 'string' ? msg.includes(patron) : patron.test(msg)) return msg;
    throw new Error(`Se esperaba error ${patron} pero fue: ${msg}`);
  }
  throw new Error(`Se esperaba error ${patron} pero la operación tuvo éxito`);
}
