/**
 * Validación de comprobantes de transferencia (JPG, PNG, PDF).
 * Se valida: tamaño, extensión, tipo MIME declarado, firma binaria real
 * ("magic bytes"), estructura mínima y contenido potencialmente malicioso.
 * El nombre de almacenamiento lo genera el servidor (nunca el del usuario).
 */

export const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export type MimePermitido = 'image/jpeg' | 'image/png' | 'application/pdf';

const EXTENSIONES: Record<string, MimePermitido> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};
export const EXTENSION_SALIDA: Record<MimePermitido, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export type ResultadoValidacion =
  | { ok: true; mime: MimePermitido; extension: string; nombreVisible: string }
  | { ok: false; error: string };

function empiezaCon(b: Uint8Array, firma: number[]): boolean {
  return firma.every((v, i) => b[i] === v);
}

export function detectarTipo(b: Uint8Array): MimePermitido | null {
  if (b.length >= 3 && empiezaCon(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (b.length >= 8 && empiezaCon(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // %PDF- (se tolera hasta 1024 bytes de basura inicial como los lectores, pero lo exigimos al inicio)
  if (b.length >= 5 && empiezaCon(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

function comoLatin1(b: Uint8Array): string {
  let s = '';
  const paso = 0x8000;
  for (let i = 0; i < b.length; i += paso) {
    s += String.fromCharCode(...b.subarray(i, i + paso));
  }
  return s;
}

/** Decodifica nombres PDF ofuscados (/J#61vaScript -> /JavaScript) */
function normalizarNombresPdf(s: string): string {
  return s.replace(/\/[^\s/<>[\]()]+/g, (n) => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
}

const PDF_PELIGROSO = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFiles?\b/, /\/RichMedia\b/, /\/XFA\b/, /\/SubmitForm\b/, /\/ImportData\b/];
const MARCADORES_SCRIPT = [/<script/i, /<\?php/i, /<%[=@\s]/, /<html/i, /<svg/i, /javascript:/i];

export function nombreVisibleSeguro(nombre: string): string {
  const base = (nombre ?? '').split(/[\\/]/).pop() ?? '';
  // eliminar caracteres de control y no imprimibles
  // deno-lint-ignore no-control-regex
  const limpio = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  return (limpio || 'comprobante').slice(0, 120);
}

export function validarComprobante(nombre: string, mimeDeclarado: string, bytes: Uint8Array): ResultadoValidacion {
  if (!bytes || bytes.length === 0) return { ok: false, error: 'El archivo está vacío.' };
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'El archivo supera el máximo de 5 MB.' };

  const nombreVisible = nombreVisibleSeguro(nombre);
  const partes = nombreVisible.toLowerCase().split('.');
  const ext = partes.length > 1 ? partes.pop()! : '';
  const mimeExt = EXTENSIONES[ext];
  if (!mimeExt) return { ok: false, error: 'Formato no permitido. Use JPG, PNG o PDF.' };
  // doble extensión ejecutable (p. ej. comprobante.exe.jpg)
  if (partes.some((p) => /^(exe|bat|cmd|com|scr|js|vbs|php|html?|svg|sh|jar|msi|ps1)$/.test(p))) {
    return { ok: false, error: 'Nombre de archivo no permitido.' };
  }

  const real = detectarTipo(bytes);
  if (!real) return { ok: false, error: 'El contenido del archivo no corresponde a una imagen JPG/PNG ni a un PDF.' };
  if (real !== mimeExt) return { ok: false, error: 'La extensión no coincide con el contenido real del archivo.' };
  const declarado = (mimeDeclarado || '').toLowerCase().split(';')[0].trim();
  const declaradoNorm = declarado === 'image/jpg' || declarado === 'image/pjpeg' ? 'image/jpeg' : declarado;
  if (declaradoNorm && declaradoNorm !== 'application/octet-stream' && declaradoNorm !== real) {
    return { ok: false, error: 'El tipo de archivo declarado no coincide con su contenido.' };
  }

  const texto = comoLatin1(bytes);
  if (real === 'application/pdf') {
    if (!texto.slice(-2048).includes('%%EOF')) return { ok: false, error: 'El PDF está incompleto o dañado.' };
    const norm = normalizarNombresPdf(texto);
    if (PDF_PELIGROSO.some((r) => r.test(norm))) {
      return { ok: false, error: 'El PDF contiene elementos activos (scripts, adjuntos o acciones) y fue rechazado por seguridad.' };
    }
  } else {
    if (real === 'image/png' && !texto.includes('IEND')) return { ok: false, error: 'La imagen PNG está incompleta o dañada.' };
    if (texto.includes('%PDF-') || MARCADORES_SCRIPT.some((r) => r.test(texto))) {
      return { ok: false, error: 'La imagen contiene contenido sospechoso y fue rechazada por seguridad.' };
    }
  }
  return { ok: true, mime: real, extension: EXTENSION_SALIDA[real], nombreVisible };
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Normaliza teléfono chileno a +569XXXXXXXX (igual que la base de datos) */
export function normalizarTelefono(t: string): string | null {
  const d = (t ?? '').replace(/\D/g, '');
  if (/^569\d{8}$/.test(d)) return `+${d}`;
  if (/^9\d{8}$/.test(d)) return `+56${d}`;
  return null;
}

export const CODIGO_RESERVA = /^CCPP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
