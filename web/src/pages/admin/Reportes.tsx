import { Alert, Button, Card, CardContent, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Cargando, ErrorCaja, useAviso } from '../../components/comunes';
import { useAuth } from '../../lib/auth';
import { mensajeError } from '../../lib/errores';
import { aHojas, columnas, etiqueta, exportarExcel, exportarPdf, formatearCelda, TIPOS_REPORTE, type Hoja } from '../../lib/reportes';
import { sha256Bytes } from '../../lib/sorteo';
import { rpc, supabase } from '../../lib/supabase';
import { SelectorRifa, useRifasLista } from './Dashboard';

export default function Reportes() {
  const auth = useAuth();
  const avisar = useAviso();
  const rifas = useRifasLista();
  const [tipo, setTipo] = useState('ventas_por_rifa');
  const [rifa, setRifa] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [curso, setCurso] = useState('');
  const [hojas, setHojas] = useState<Hoja[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tipos = TIPOS_REPORTE.filter((t) => !t.personal || auth.tiene('compradores.ver'));
  const def = TIPOS_REPORTE.find((t) => t.valor === tipo)!;
  const rifaSel = rifas.find((r) => r.id === rifa);
  const descripcionFiltros = [`Rifa: ${rifaSel ? `${rifaSel.codigo} ${rifaSel.nombre}` : 'todas'}`, desde && `desde ${desde}`, hasta && `hasta ${hasta}`, curso && `curso ${curso}`].filter(Boolean).join(' · ');
  const nombreArchivo = `${def.valor.toUpperCase()}_${rifaSel?.codigo ?? 'TODAS'}_${new Date().toISOString().slice(0, 10)}`;

  const generar = async () => {
    setCargando(true); setError(null);
    try {
      const datos = await rpc('reporte', { p_tipo: tipo, p_rifa_id: rifa || null, p_desde: desde || null, p_hasta: hasta || null, p_curso: curso || null });
      setHojas(aHojas(tipo, datos));
    } catch (e) { setError(mensajeError(e)); } finally { setCargando(false); }
  };

  const guardarEnDrive = async () => {
    if (!rifa || !hojas) return;
    try {
      const blob = await exportarExcel(nombreArchivo, def.etiqueta, descripcionFiltros, hojas);
      const ruta = `${rifa}/REPORTES/${nombreArchivo}_${Date.now()}.xlsx`;
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const { error: e } = await supabase.storage.from('documentos').upload(ruta, blob, { contentType: mime });
      if (e) throw e;
      await rpc('registrar_documento', { p_rifa_id: rifa, p_tipo: 'REPORTES', p_storage_path: ruta, p_nombre: `${nombreArchivo}.xlsx`, p_mime: mime, p_sha256: await sha256Bytes(await blob.arrayBuffer()) });
      avisar('Reporte guardado y en cola de respaldo en Drive');
    } catch (e) { avisar(mensajeError(e), 'error'); }
  };

  return (
    <>
      <Typography variant="h1" gutterBottom>Reportes</Typography>
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} flexWrap="wrap">
          <TextField select size="small" label="Reporte" value={tipo} onChange={(e) => { setTipo(e.target.value); setHojas(null); }} sx={{ minWidth: 280 }}>
            {tipos.map((t) => <MenuItem key={t.valor} value={t.valor}>{t.etiqueta}</MenuItem>)}
          </TextField>
          <SelectorRifa valor={rifa} onCambio={setRifa} />
          <TextField size="small" type="date" label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ maxWidth: 170 }} />
          <TextField size="small" type="date" label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ maxWidth: 170 }} />
          <TextField size="small" label="Curso" value={curso} onChange={(e) => setCurso(e.target.value)} sx={{ maxWidth: 130 }} />
          <Button variant="contained" onClick={generar} disabled={cargando}>Generar</Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Los montos de recaudación consideran únicamente pagos aprobados por Tesorería o autorizados por la pasarela.</Typography>
      </CardContent></Card>
      <ErrorCaja error={error} />
      {cargando && <Cargando texto="Generando reporte…" />}
      {hojas && !cargando && (
        <>
          <Stack direction="row" gap={1} sx={{ mb: 2 }} flexWrap="wrap">
            <Button variant="outlined" onClick={() => exportarExcel(nombreArchivo, def.etiqueta, descripcionFiltros, hojas)}>Descargar Excel</Button>
            <Button variant="outlined" onClick={() => exportarPdf(nombreArchivo, def.etiqueta, descripcionFiltros, hojas)}>Descargar PDF</Button>
            {auth.tiene('rifas.gestionar') && <Button onClick={guardarEnDrive} disabled={!rifa}>Guardar en documentos y Drive {!rifa && '(elija una rifa)'}</Button>}
          </Stack>
          {hojas.map((h) => (
            <Card key={h.titulo} sx={{ mb: 2 }}>
              <CardContent>
                {hojas.length > 1 && <Typography variant="h3" gutterBottom>{h.titulo}</Typography>}
                {h.filas.length === 0 ? <Alert severity="info">Sin datos para los filtros elegidos.</Alert> : (
                  <TableContainer sx={{ maxHeight: 520 }}>
                    <Table size="small" stickyHeader>
                      <TableHead><TableRow>{columnas(h.filas).map((c) => <TableCell key={c}>{etiqueta(c)}</TableCell>)}</TableRow></TableHead>
                      <TableBody>
                        {h.filas.slice(0, 500).map((f, i) => <TableRow key={i}>{columnas(h.filas).map((c) => <TableCell key={c}>{formatearCelda(c, f[c])}</TableCell>)}</TableRow>)}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
                {h.filas.length > 500 && <Typography variant="body2" sx={{ mt: 1 }}>Mostrando 500 de {h.filas.length} filas. Descargue el archivo para verlas todas.</Typography>}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </>
  );
}
