/** Exportación de reportes a Excel (.xlsx) y PDF. Las librerías se cargan bajo demanda. */
import { clp, fechaHora } from './formato';

export const TIPOS_REPORTE: { valor: string; etiqueta: string; personal: boolean }[] = [
  { valor: 'ventas_por_rifa', etiqueta: 'Ventas por rifa', personal: false },
  { valor: 'recaudacion', etiqueta: 'Recaudación (sólo pagos confirmados)', personal: false },
  { valor: 'pagos_confirmados', etiqueta: 'Pagos confirmados', personal: true },
  { valor: 'pagos_pendientes', etiqueta: 'Pagos pendientes', personal: true },
  { valor: 'comprobantes_rechazados', etiqueta: 'Comprobantes rechazados', personal: true },
  { valor: 'ajustes', etiqueta: 'Ajustes (reversiones y confirmaciones manuales)', personal: true },
  { valor: 'compradores', etiqueta: 'Compradores', personal: true },
  { valor: 'numeros_vendidos', etiqueta: 'Números vendidos', personal: true },
  { valor: 'numeros_disponibles', etiqueta: 'Números disponibles', personal: false },
  { valor: 'reservas_vencidas', etiqueta: 'Reservas vencidas', personal: true },
  { valor: 'ganadores', etiqueta: 'Ganadores', personal: true },
  { valor: 'premios_entregados', etiqueta: 'Premios entregados', personal: true },
];

const ETIQUETAS: Record<string, string> = {
  codigo: 'Código', nombre: 'Nombre', estado: 'Estado', precio_numero: 'Precio', total_numeros: 'Total números',
  vendidos: 'Vendidos', reservados: 'Reservados', en_validacion: 'En validación', disponibles: 'Disponibles',
  bloqueados: 'Bloqueados', recaudacion_confirmada: 'Recaudación confirmada', avance_pct: 'Avance %', curso: 'Curso',
  telefono: 'Teléfono', email: 'Correo', rifa: 'Rifa', reservas_pagadas: 'Reservas pagadas', numeros_pagados: 'Números pagados',
  monto_pagado: 'Monto pagado', reservas_totales: 'Reservas totales', numero: 'Número', reserva: 'Reserva',
  fecha_pago: 'Fecha pago', metodo: 'Método', cantidad: 'Cantidad', monto_total: 'Monto', creada: 'Creada',
  expirada_at: 'Expiró', numeros: 'Números', expira_at: 'Vence', monto: 'Monto', referencia_externa: 'Referencia',
  validado_at: 'Validado', validado_por: 'Validado por', observacion: 'Observación', enviado_at: 'Enviado',
  revisado_at: 'Revisado', motivo_rechazo: 'Motivo', revisado_por: 'Revisado por', tipo: 'Tipo', fecha: 'Fecha',
  responsable: 'Responsable', detalle: 'Detalle', posicion: 'Lugar', premio: 'Premio', ejecutado_at: 'Fecha sorteo',
  entregado: 'Entregado', ganador: 'Ganador', recibido_por: 'Recibido por', entregado_at: 'Fecha entrega',
  registrado_por: 'Registrado por', pagos: 'Pagos',
};
const MONEDA = new Set(['precio_numero', 'recaudacion_confirmada', 'monto_pagado', 'monto_total', 'monto']);
const FECHAS = new Set(['fecha_pago', 'creada', 'expirada_at', 'expira_at', 'validado_at', 'enviado_at', 'revisado_at', 'fecha', 'ejecutado_at', 'entregado_at']);

export interface Hoja {
  titulo: string;
  filas: Record<string, unknown>[];
}

/** Normaliza la respuesta del servidor en una o más hojas. */
export function aHojas(tipo: string, datos: unknown): Hoja[] {
  if (tipo === 'recaudacion' && datos && !Array.isArray(datos)) {
    const d = datos as { por_rifa: any[]; por_metodo: any[]; total_confirmado: number; total_revertido: number };
    return [
      { titulo: 'Resumen', filas: [{ concepto: 'Total confirmado', valor: clp(d.total_confirmado) }, { concepto: 'Total revertido (ajustes)', valor: clp(d.total_revertido) }] },
      { titulo: 'Por rifa', filas: d.por_rifa },
      { titulo: 'Por método', filas: d.por_metodo },
    ];
  }
  return [{ titulo: 'Reporte', filas: (datos as Record<string, unknown>[]) ?? [] }];
}

export function formatearCelda(clave: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (MONEDA.has(clave)) return clp(Number(v));
  if (FECHAS.has(clave)) return fechaHora(String(v));
  return String(v);
}

export const etiqueta = (k: string) => ETIQUETAS[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
export const columnas = (filas: Record<string, unknown>[]) => (filas[0] ? Object.keys(filas[0]) : []);

export async function exportarExcel(nombre: string, titulo: string, filtros: string, hojas: Hoja[]): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rifa Online CCPP';
  wb.created = new Date();
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.titulo.slice(0, 31));
    ws.addRow([titulo]).font = { bold: true, size: 14 };
    ws.addRow([filtros]);
    ws.addRow([`Generado: ${fechaHora(new Date().toISOString())}`]);
    ws.addRow([]);
    const cols = columnas(h.filas);
    const cab = ws.addRow(cols.map(etiqueta));
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E3B' } }; });
    for (const f of h.filas) {
      ws.addRow(cols.map((k) => {
        const v = f[k];
        if (MONEDA.has(k) || typeof v === 'number') return Number(v);
        return formatearCelda(k, v);
      }));
    }
    cols.forEach((k, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(45, Math.max(12, etiqueta(k).length + 4));
      if (MONEDA.has(k)) col.numFmt = '"$"#,##0';
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  descargar(blob, `${nombre}.xlsx`);
  return blob;
}

export async function exportarPdf(nombre: string, titulo: string, filtros: string, hojas: Hoja[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  let y = 40;
  doc.setFontSize(15).text(titulo, 40, y);
  doc.setFontSize(9).text(`${filtros} · Generado: ${fechaHora(new Date().toISOString())}`, 40, (y += 16));
  for (const h of hojas) {
    const cols = columnas(h.filas);
    if (hojas.length > 1) doc.setFontSize(11).text(h.titulo, 40, (y += 22));
    autoTable(doc, {
      startY: y + 8,
      head: [cols.map(etiqueta)],
      body: h.filas.map((f) => cols.map((k) => formatearCelda(k, f[k]))),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [27, 94, 59] },
      margin: { left: 40, right: 40 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8).text(`Página ${i} de ${paginas}`, doc.internal.pageSize.getWidth() - 100, doc.internal.pageSize.getHeight() - 20);
  }
  const blob = doc.output('blob');
  descargar(blob, `${nombre}.pdf`);
  return blob;
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
