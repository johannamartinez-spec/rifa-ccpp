/** Generación del acta oficial del sorteo en PDF. */
import { fechaLarga } from './formato';
import type { SorteoPublico } from './tipos';

export async function generarActa(s: SorteoPublico, responsable: string, testigos: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const so = s.sorteo!;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const x = 50;
  let y = 60;
  const linea = (t: string, tam = 10, negrita = false) => {
    doc.setFont('helvetica', negrita ? 'bold' : 'normal').setFontSize(tam);
    const partes = doc.splitTextToSize(t, 495);
    doc.text(partes, x, y);
    y += partes.length * (tam + 4) + 4;
  };
  linea('ACTA OFICIAL DE SORTEO', 16, true);
  linea(`${s.rifa.centro_padres} — ${s.rifa.colegio}`, 11);
  linea(`Rifa: ${s.rifa.nombre} (${s.rifa.codigo})`, 11, true);
  y += 6;
  linea(`Cierre del padrón: ${fechaLarga(so.padron_congelado_at)}`);
  linea(`Ejecución del sorteo: ${fechaLarga(so.ejecutado_at)}`);
  linea(`Números participantes (sólo pagados y confirmados): ${so.total_participantes}`);
  linea(`Cantidad de ganadores: ${so.cantidad_ganadores} · Repetición de números permitida: ${so.permitir_repetidos ? 'Sí' : 'No'}`);
  linea(`Algoritmo: ${so.algoritmo} versión ${so.version} (selección en servidor, SHA-256 con muestreo por rechazo)`);
  y += 4;
  linea('EVIDENCIA VERIFICABLE', 11, true);
  linea(`Hash SHA-256 del padrón: ${so.padron_hash}`, 8);
  linea(`Compromiso de semilla (publicado antes del sorteo): ${so.semilla_compromiso}`, 8);
  linea(`Semilla revelada: ${so.semilla}`, 8);
  linea(`Entropía externa: ${so.entropia_externa || '(ninguna)'}`, 8);
  linea(`Hash base: ${so.hash_base}`, 8);
  autoTable(doc, {
    startY: y + 6,
    head: [['Lugar', 'Premio', 'Número ganador']],
    body: (so.ganadores ?? []).map((g) => [`${g.posicion}°`, g.premio ?? '—', String(g.numero)]),
    headStyles: { fillColor: [27, 94, 59] },
    margin: { left: x },
  });
  y = (doc as any).lastAutoTable.finalY + 24;
  linea('Cualquier persona puede verificar este resultado en la página pública "Verificar sorteo" de la rifa, que recalcula los ganadores a partir del padrón, la semilla y la entropía externa.', 9);
  y += 30;
  linea(`Responsable: ${responsable}`, 10);
  y += 30;
  doc.line(x, y, x + 200, y);
  doc.text('Firma responsable', x, y + 14);
  doc.line(x + 260, y, x + 460, y);
  doc.text('Firma ministro de fe / testigo', x + 260, y + 14);
  y += 40;
  if (testigos.trim()) linea(`Testigos: ${testigos}`, 10);
  y += 10;
  doc.addPage();
  y = 60;
  linea('ANEXO: PADRÓN OFICIAL DE NÚMEROS PARTICIPANTES', 12, true);
  linea(so.participantes.join(', '), 8);
  return doc.output('blob');
}
