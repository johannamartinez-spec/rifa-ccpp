/** Formatos chilenos: CLP, fechas America/Santiago, teléfonos y RUT. */

const ZONA = 'America/Santiago';

export const clp = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n ?? 0));

export const numeroCL = (n: number | null | undefined) => new Intl.NumberFormat('es-CL').format(Number(n ?? 0));

export const fechaHora = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: ZONA }).format(new Date(iso)) : '—';

export const fechaLarga = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: ZONA }).format(new Date(iso))
    : '—';

export const fecha = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeZone: ZONA }).format(new Date(iso)) : '—';

/** Normaliza a +569XXXXXXXX o devuelve null (misma regla que la base de datos). */
export function normalizarTelefono(t: string): string | null {
  const d = (t ?? '').replace(/\D/g, '');
  if (/^569\d{8}$/.test(d)) return `+${d}`;
  if (/^9\d{8}$/.test(d)) return `+56${d}`;
  return null;
}

export function formatoTelefono(t: string | null | undefined): string {
  const n = normalizarTelefono(t ?? '');
  if (!n) return t ?? '';
  return `+56 9 ${n.slice(4, 8)} ${n.slice(8)}`;
}

/** Valida RUT chileno con dígito verificador (módulo 11). Devuelve 12345678-K o null. */
export function normalizarRut(rut: string): string | null {
  const limpio = (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 8 || limpio.length > 9) return null;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return null;
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const res = 11 - (suma % 11);
  const dvCalc = res === 11 ? '0' : res === 10 ? 'K' : String(res);
  return dvCalc === dv ? `${cuerpo.replace(/^0+/, '')}-${dv}` : null;
}

export function formatoRut(rut: string | null | undefined): string {
  const n = normalizarRut(rut ?? '');
  if (!n) return rut ?? '';
  const [c, dv] = n.split('-');
  return `${c.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

/** Convierte "1, 3, 10-15" en [1,3,10,...,15]. Máximo 2000 elementos. */
export function parsearListaNumeros(texto: string): number[] {
  const res = new Set<number>();
  for (const parte of texto.split(/[\s,;]+/).filter(Boolean)) {
    const m = parte.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Valor inválido: "${parte}"`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a) throw new Error(`Rango inválido: "${parte}"`);
    for (let i = a; i <= b; i++) {
      res.add(i);
      if (res.size > 2000) throw new Error('Demasiados números (máximo 2000)');
    }
  }
  return [...res].sort((x, y) => x - y);
}

/** Tiempo restante legible: "12:05" o "1 h 05 min" */
export function tiempoRestante(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m}:${String(seg).padStart(2, '0')}`;
}

export const urlPublica = (ruta: string | null | undefined) =>
  ruta ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/rifas-publico/${ruta}` : undefined;
