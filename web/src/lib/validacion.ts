import { z } from 'zod';
import { normalizarRut, normalizarTelefono } from './formato';

/** Validación del formulario del comprador (espejo de las reglas del servidor). */
export function esquemaComprador(pedirRut: boolean) {
  return z.object({
    nombre: z
      .string()
      .trim()
      .min(3, 'Ingrese su nombre y apellido')
      .max(120, 'Máximo 120 caracteres')
      .regex(/^[\p{L} .'-]+$/u, 'Use sólo letras')
      .refine((v) => v.includes(' '), 'Ingrese nombre y apellido'),
    curso: z.string().trim().min(1, 'Indique el curso').max(40).regex(/^[\p{L}\p{N} °º.-]+$/u, 'Curso inválido'),
    telefono: z.string().refine((v) => normalizarTelefono(v) !== null, 'Celular chileno inválido (ej: 9 1234 5678)'),
    email: z.union([z.literal(''), z.string().trim().email('Correo inválido').max(200)]),
    rut: pedirRut
      ? z.string().refine((v) => normalizarRut(v) !== null, 'RUT inválido')
      : z.string().optional().refine((v) => !v || normalizarRut(v) !== null, 'RUT inválido'),
    acepta: z.literal(true, { error: 'Debe aceptar las bases y la política de privacidad' }),
  });
}

export type DatosComprador = z.infer<ReturnType<typeof esquemaComprador>>;

export function erroresPorCampo(e: z.ZodError): Record<string, string> {
  const r: Record<string, string> = {};
  for (const i of e.issues) {
    const k = String(i.path[0]);
    if (!r[k]) r[k] = i.message;
  }
  return r;
}

export const MAX_COMPROBANTE = 5 * 1024 * 1024;
export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'application/pdf'];

export function validarArchivoComprobante(f: File): string | null {
  if (f.size === 0) return 'El archivo está vacío.';
  if (f.size > MAX_COMPROBANTE) return 'El archivo supera 5 MB. Saque una captura más liviana o use PDF.';
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (!['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) return 'Formato no permitido. Use JPG, PNG o PDF.';
  if (f.type && !TIPOS_COMPROBANTE.includes(f.type)) return 'Formato no permitido. Use JPG, PNG o PDF.';
  return null;
}
