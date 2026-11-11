/**
 * Verificación pública del sorteo — algoritmo CCPP-SHA256-RS v1.0.0.
 * Reproduce EXACTAMENTE public.calcular_ganadores_sorteo() del servidor,
 * para que cualquier apoderado pueda comprobar el resultado en su navegador.
 * Esta función NO decide el sorteo: el resultado oficial se calcula en el servidor.
 */

export const ALGORITMO = 'CCPP-SHA256-RS';
export const VERSION_ALGORITMO = '1.0.0';
const RANGO = 2 ** 48;

export async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Bytes(datos: ArrayBuffer): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function padronTexto(padron: number[]): string {
  return padron.join(',');
}

export interface GanadorCalculado {
  posicion: number;
  numero: number;
  intento: number;
}

export async function calcularGanadores(params: {
  semilla: string;
  padronHash: string;
  entropia: string;
  padron: number[];
  cantidad: number;
  permitirRepetidos: boolean;
}): Promise<GanadorCalculado[]> {
  const { semilla, padronHash, entropia, padron, cantidad, permitirRepetidos } = params;
  const base = await sha256Hex(`${semilla}|${padronHash}|${entropia ?? ''}`);
  let lista = [...padron];
  const ganadores: GanadorCalculado[] = [];
  for (let k = 1; k <= cantidad; k++) {
    const m = lista.length;
    if (m === 0) throw new Error('No quedan participantes');
    const limite = RANGO - (RANGO % m);
    let c = 0;
    let x: number;
    for (;;) {
      const h = await sha256Hex(`${base}|${k}|${c}`);
      x = parseInt(h.slice(0, 12), 16);
      if (x < limite) break;
      c++;
    }
    const idx = x % m;
    ganadores.push({ posicion: k, numero: lista[idx], intento: c });
    if (!permitirRepetidos) lista = [...lista.slice(0, idx), ...lista.slice(idx + 1)];
  }
  return ganadores;
}

export interface ResultadoVerificacion {
  padronOk: boolean;
  compromisoOk: boolean;
  ganadoresOk: boolean;
  calculados: GanadorCalculado[];
}

/** Verifica un sorteo publicado: hash del padrón, compromiso de semilla y ganadores. */
export async function verificarSorteo(s: {
  padron: number[];
  padronHash: string;
  semilla: string;
  semillaCompromiso: string;
  entropia: string;
  cantidad: number;
  permitirRepetidos: boolean;
  ganadores: { posicion: number; numero: number }[];
}): Promise<ResultadoVerificacion> {
  const ordenado = [...s.padron].sort((a, b) => a - b);
  const padronOk = (await sha256Hex(padronTexto(ordenado))) === s.padronHash;
  const compromisoOk = (await sha256Hex(s.semilla)) === s.semillaCompromiso;
  const calculados = await calcularGanadores({
    semilla: s.semilla,
    padronHash: s.padronHash,
    entropia: s.entropia,
    padron: ordenado,
    cantidad: s.cantidad,
    permitirRepetidos: s.permitirRepetidos,
  });
  const ganadoresOk =
    calculados.length === s.ganadores.length &&
    calculados.every((g, i) => g.numero === s.ganadores[i].numero && g.posicion === s.ganadores[i].posicion);
  return { padronOk, compromisoOk, ganadoresOk, calculados };
}
