import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const clave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configuracionFaltante = !url || !clave;

// Sólo la clave pública (anon/publishable). La autorización real la aplica RLS en el servidor.
export const supabase = createClient(url ?? 'http://localhost:54321', clave ?? 'falta-configurar', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  realtime: { params: { eventsPerSecond: 5 } },
});

export const urlFuncion = (nombre: string) => `${url}/functions/v1/${nombre}`;

/** Llama a una función Edge con la sesión actual (si existe). */
export async function llamarFuncion<T = unknown>(nombre: string, cuerpo?: unknown, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { apikey: clave ?? '' };
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  if (cuerpo !== undefined && !(cuerpo instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(urlFuncion(nombre), {
    method: 'POST',
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
    body: cuerpo instanceof FormData ? cuerpo : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}

/** RPC con error lanzado como excepción */
export async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
