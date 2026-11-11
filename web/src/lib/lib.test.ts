import { describe, expect, it } from 'vitest';
import { evaluarClave } from '../pages/admin/Activar';
import { mensajeError } from './errores';
import { clp, formatoRut, normalizarRut, normalizarTelefono, parsearListaNumeros, tiempoRestante } from './formato';
import { aHojas, formatearCelda } from './reportes';
import { calcularGanadores, verificarSorteo } from './sorteo';
import { esquemaComprador, validarArchivoComprobante } from './validacion';

describe('formatos chilenos', () => {
  it('CLP sin decimales', () => expect(clp(1234567)).toBe('$1.234.567'));
  it('teléfono', () => {
    expect(normalizarTelefono('+56 9 8765 4321')).toBe('+56987654321');
    expect(normalizarTelefono('987654321')).toBe('+56987654321');
    expect(normalizarTelefono('221234567')).toBeNull();
  });
  it('RUT con dígito verificador', () => {
    expect(normalizarRut('11.111.111-1')).toBe('11111111-1');
    expect(normalizarRut('11.111.111-2')).toBeNull();
    expect(formatoRut('12345678-5')).toBe('12.345.678-5');
  });
  it('lista de números con rangos', () => {
    expect(parsearListaNumeros('1, 3, 5-7')).toEqual([1, 3, 5, 6, 7]);
    expect(() => parsearListaNumeros('9-2')).toThrow();
    expect(() => parsearListaNumeros('a')).toThrow();
  });
  it('tiempo restante', () => {
    expect(tiempoRestante(65_000)).toBe('1:05');
    expect(tiempoRestante(3_900_000)).toBe('1 h 05 min');
  });
});

describe('validaciones', () => {
  const base = { nombre: 'Ana Pérez', curso: '4°B', telefono: '912345678', email: '', rut: '', acepta: true as const };
  it('acepta datos válidos y rechaza inválidos', () => {
    expect(esquemaComprador(false).safeParse(base).success).toBe(true);
    expect(esquemaComprador(false).safeParse({ ...base, nombre: 'Ana' }).success).toBe(false);
    expect(esquemaComprador(false).safeParse({ ...base, email: 'malo' }).success).toBe(false);
    expect(esquemaComprador(true).safeParse(base).success).toBe(false);
    expect(esquemaComprador(true).safeParse({ ...base, rut: '11.111.111-1' }).success).toBe(true);
    expect(esquemaComprador(false).safeParse({ ...base, acepta: false }).success).toBe(false);
  });
  it('archivos de comprobante', () => {
    expect(validarArchivoComprobante(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(validarArchivoComprobante(new File(['x'], 'a.gif', { type: 'image/gif' }))).not.toBeNull();
    expect(validarArchivoComprobante(new File([], 'a.pdf', { type: 'application/pdf' }))).not.toBeNull();
  });
  it('política de contraseñas', () => {
    expect(evaluarClave('corta').ok).toBe(false);
    expect(evaluarClave('Tesoreria-2026!').ok).toBe(true);
  });
});

describe('mensajes de error comprensibles', () => {
  it('traduce errores de negocio', () => {
    expect(mensajeError({ message: 'NUMEROS_NO_DISPONIBLES: 5, 7' })).toContain('5, 7');
    expect(mensajeError({ message: 'Failed to fetch' })).toContain('Sin conexión');
    expect(mensajeError({ message: 'VALIDACION: curso inválido' })).toBe('curso inválido');
  });
});

describe('sorteo verificable', () => {
  it('reproduce el vector de referencia calculado por PostgreSQL', async () => {
    const padron = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    const g = await calcularGanadores({ semilla: 'ab'.repeat(32), padronHash: 'e0be73c79b2560ba4d8bd89c7917c181565bae97a2a4672cc6fe5a42f77b7d36',
      entropia: 'Loteria 4-18-22', padron, cantidad: 3, permitirRepetidos: false });
    expect(g.map((x) => x.numero)).toEqual([8, 13, 34]);
  });
  it('detecta manipulaciones', async () => {
    const v = await verificarSorteo({ padron: [1, 2, 3], padronHash: '0'.repeat(64), semilla: 'x', semillaCompromiso: '0'.repeat(64),
      entropia: '', cantidad: 1, permitirRepetidos: false, ganadores: [{ posicion: 1, numero: 2 }] });
    expect(v.padronOk || v.compromisoOk).toBe(false);
  });
});

describe('reportes', () => {
  it('formatea celdas y separa la recaudación en hojas', () => {
    expect(formatearCelda('monto', 5000)).toBe('$5.000');
    expect(formatearCelda('numeros', [1, 2])).toBe('1, 2');
    expect(aHojas('recaudacion', { por_rifa: [], por_metodo: [], total_confirmado: 1, total_revertido: 0 })).toHaveLength(3);
  });
});
