/** Utilidades de las funciones Edge (Deno). */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { iguales } from './cripto.ts';

export const env = (k: string, def?: string): string => {
  const v = Deno.env.get(k) ?? def;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${k}`);
  return v;
};
export const envOpcional = (k: string): string | undefined => Deno.env.get(k) || undefined;

export function clienteServicio(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function cors(req: Request): Record<string, string> {
  const permitidos = (envOpcional('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origen = req.headers.get('origin') ?? '';
  const permitido = permitidos.length === 0 ? '*' : permitidos.includes(origen) ? origen : permitidos[0];
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function responder(req: Request, cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** ¿La llamada viene del propio servidor (pg_cron con la clave service_role)? */
export function esLlamadaServicio(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const clave = envOpcional('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return !!clave && iguales(auth, `Bearer ${clave}`);
}

/** Verifica el JWT del administrador y su permiso (validación en servidor). */
export async function exigirAdmin(req: Request, permiso: string): Promise<{ id: string; email: string; cliente: SupabaseClient }> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) throw new ErrorHttp(401, 'No autenticado');
  const cliente = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await cliente.auth.getUser(auth.slice(7));
  if (error || !data.user) throw new ErrorHttp(401, 'Sesión inválida o expirada');
  const { data: ok, error: e2 } = await cliente.rpc('tiene_permiso', { p_permiso: permiso });
  if (e2 || ok !== true) throw new ErrorHttp(403, `Sin permiso: ${permiso} (¿activó el segundo factor?)`);
  return { id: data.user.id, email: data.user.email ?? '', cliente };
}

export class ErrorHttp extends Error {
  constructor(public estado: number, msg: string) {
    super(msg);
  }
}

export function manejarError(req: Request, e: unknown): Response {
  if (e instanceof ErrorHttp) return responder(req, { error: e.message }, e.estado);
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  // Mensajes de negocio de la base de datos (prefijo en mayúsculas) son seguros de mostrar
  const negocio = /^[A-Z_]{4,}:?/.test(msg);
  return responder(req, { error: negocio ? msg : 'Error interno. Intente nuevamente.' }, negocio ? 400 : 500);
}
