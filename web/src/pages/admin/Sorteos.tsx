import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, FormControlLabel, Stack, Step, StepLabel, Stepper, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cargando, Confirmar, ErrorCaja, useAviso } from '../../components/comunes';
import { generarActa } from '../../lib/acta';
import { sha256Bytes } from '../../lib/sorteo';
import { useAuth } from '../../lib/auth';
import { mensajeError } from '../../lib/errores';
import { fechaHora } from '../../lib/formato';
import { descargar, exportarExcel } from '../../lib/reportes';
import { rpc, supabase } from '../../lib/supabase';
import type { SorteoPublico } from '../../lib/tipos';
import { SelectorRifa } from './Dashboard';

interface GanadorAdmin { id: string; posicion: number; numero: number; premio: { nombre: string } | null; comprador: { nombre: string; curso: string; telefono: string | null } | null; entrega: { recibido_por: string; entregado_at: string }[] }

// PostgREST devuelve objeto (relación 1 a 1) o arreglo según la versión: se normaliza a arreglo
const normalizar = (g: any): GanadorAdmin => ({ ...g, entrega: g.entrega ? (Array.isArray(g.entrega) ? g.entrega : [g.entrega]) : [] });

export default function Sorteos() {
  const auth = useAuth();
  const avisar = useAviso();
  const puede = auth.tiene('sorteos.ejecutar');
  const [rifaId, setRifaId] = useState('');
  const [s, setS] = useState<SorteoPublico | null>(null);
  const [estadoRifa, setEstadoRifa] = useState('');
  const [pendientes, setPendientes] = useState(0);
  const [ganadores, setGanadores] = useState<GanadorAdmin[]>([]);
  const [cantidad, setCantidad] = useState(1);
  const [repetidos, setRepetidos] = useState(false);
  const [forzar, setForzar] = useState(false);
  const [entropia, setEntropia] = useState('');
  const [testigos, setTestigos] = useState('');
  const [dialogo, setDialogo] = useState<null | 'cerrar' | 'congelar' | 'ejecutar'>(null);
  const [entrega, setEntrega] = useState<GanadorAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!rifaId) return;
    setError(null);
    try {
      const [d, r, p, g] = await Promise.all([
        rpc<SorteoPublico>('sorteo_publico', { p_rifa_id: rifaId }),
        supabase.from('rifas').select('estado').eq('id', rifaId).single(),
        supabase.from('reservas').select('id', { count: 'exact', head: true }).eq('rifa_id', rifaId).in('estado', ['reservado', 'pendiente_pago', 'comprobante_enviado', 'en_revision']),
        supabase.from('ganadores').select('id, posicion, numero, premio:premios(nombre), comprador:compradores(nombre, curso, telefono), entrega:entrega_premios(recibido_por, entregado_at), sorteos!inner(rifa_id)').eq('sorteos.rifa_id', rifaId).order('posicion'),
      ]);
      setS(d); setEstadoRifa(r.data?.estado ?? ''); setPendientes(p.count ?? 0);
      setGanadores((g.data ?? []).map(normalizar));
      if (d?.premios?.length) setCantidad((c) => (c === 1 ? d.premios.length : c));
    } catch (e) { setError(mensajeError(e)); }
  }, [rifaId]);
  useEffect(() => { setS(null); void cargar(); }, [cargar]);

  const so = s?.sorteo;
  const paso = !s ? 0 : estadoRifa === 'activa' || estadoRifa === 'pausada' ? 0 : !so ? 1 : so.estado !== 'ejecutado' ? 2 : 3;

  const subirActa = async () => {
    try {
      const blob = await generarActa(s!, auth.nombre, testigos);
      descargar(blob, `ACTA_${s!.rifa.codigo}.pdf`);
      const ruta = `${rifaId}/ACTAS/acta_sorteo_${s!.rifa.codigo}_${Date.now()}.pdf`;
      const { error: e } = await supabase.storage.from('documentos').upload(ruta, blob, { contentType: 'application/pdf' });
      if (e) throw e;
      const sha = await sha256Bytes(await blob.arrayBuffer());
      await rpc('registrar_documento', { p_rifa_id: rifaId, p_tipo: 'ACTAS', p_storage_path: ruta, p_nombre: `acta_sorteo_${s!.rifa.codigo}.pdf`, p_mime: 'application/pdf', p_sha256: sha, p_sorteo_acta: so!.id });
      avisar('Acta generada, guardada y en cola de respaldo en Drive');
    } catch (e) { avisar(mensajeError(e), 'error'); }
  };

  const exportar = async () => {
    await exportarExcel(`GANADORES_${s!.rifa.codigo}`, `Ganadores — ${s!.rifa.nombre}`, `Sorteo ejecutado ${fechaHora(so!.ejecutado_at)}`, [
      { titulo: 'Ganadores', filas: ganadores.map((g) => ({ posicion: g.posicion, premio: g.premio?.nombre, numero: g.numero, nombre: g.comprador?.nombre, curso: g.comprador?.curso, telefono: g.comprador?.telefono, entregado: g.entrega.length > 0 })) },
      { titulo: 'Padrón', filas: so!.participantes.map((n) => ({ numero: n })) },
    ]);
  };

  return (
    <>
      <Typography variant="h1" gutterBottom>Sorteos y premios</Typography>
      <SelectorRifa valor={rifaId} onCambio={setRifaId} todas={false} />
      <ErrorCaja error={error} />
      {rifaId && !s && !error && <Cargando />}
      {s && (
        <>
          <Stepper activeStep={paso} alternativeLabel sx={{ my: 3 }}>
            {['Cerrar ventas', 'Congelar padrón', 'Ejecutar sorteo', 'Acta y entrega de premios'].map((t) => <Step key={t}><StepLabel>{t}</StepLabel></Step>)}
          </Stepper>
          <Stack direction="row" gap={1} sx={{ mb: 2 }}>
            <Button component={Link} to={`/sorteo/${rifaId}`} target="_blank" startIcon={<OpenInNewIcon />} variant="outlined">Pantalla de transmisión en vivo</Button>
            <Button component={Link} to={`/sorteo/${rifaId}/verificar`} target="_blank">Página de verificación</Button>
          </Stack>

          {paso === 0 && (
            <Card><CardContent>
              <Typography gutterBottom>La venta está abierta. Para sortear, primero cierre las ventas.</Typography>
              {puede && auth.tiene('rifas.gestionar') && <Button variant="contained" color="error" onClick={() => setDialogo('cerrar')}>Cerrar ventas</Button>}
            </CardContent></Card>
          )}

          {paso === 1 && (
            <Card><CardContent>
              <Typography variant="h3" gutterBottom>Generar el padrón oficial</Typography>
              <Typography gutterBottom>Sólo participan números vendidos, pagados y confirmados. Al congelar, el listado queda fijo y se publica su huella SHA-256 y el compromiso de la semilla.</Typography>
              {pendientes > 0 && <Alert severity="warning" sx={{ my: 1 }}>Hay {pendientes} reservas sin resolver (pagos por revisar o reservas vigentes). Resuélvalas en "Pagos" antes de congelar, o marque "forzar" para excluirlas (quedará en el acta).</Alert>}
              <Stack direction={{ xs: 'column', md: 'row' }} gap={2} sx={{ mt: 1 }} alignItems={{ md: 'center' }}>
                <TextField type="number" size="small" label="Cantidad de ganadores" value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value)))} sx={{ maxWidth: 200 }} helperText={`${s.premios.length} premios configurados`} />
                <FormControlLabel control={<Checkbox checked={repetidos} onChange={(e) => setRepetidos(e.target.checked)} />} label="Un número puede ganar más de un premio" />
                {pendientes > 0 && <FormControlLabel control={<Checkbox checked={forzar} onChange={(e) => setForzar(e.target.checked)} />} label="Forzar (excluir reservas no resueltas)" />}
              </Stack>
              {puede && <Button variant="contained" sx={{ mt: 2 }} onClick={() => setDialogo('congelar')} disabled={pendientes > 0 && !forzar}>Congelar padrón</Button>}
            </CardContent></Card>
          )}

          {so && (
            <Card sx={{ mt: 2 }}><CardContent>
              <Typography variant="h3" gutterBottom>Padrón congelado <Chip size="small" label={`${so.total_participantes} números`} /></Typography>
              <Typography variant="body2">Congelado: {fechaHora(so.padron_congelado_at)} · Ganadores: {so.cantidad_ganadores} · Repetidos: {so.permitir_repetidos ? 'sí' : 'no'}</Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>SHA-256 padrón: {so.padron_hash}</Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>Compromiso semilla: <b>{so.semilla_compromiso}</b> (publíquelo antes del sorteo, p. ej. en el grupo de apoderados)</Typography>
              <Box sx={{ maxHeight: 120, overflow: 'auto', mt: 1, fontSize: 13, color: 'text.secondary' }}>{so.participantes.join(', ')}</Box>
            </CardContent></Card>
          )}

          {paso === 2 && (
            <Card sx={{ mt: 2 }}><CardContent>
              <Typography variant="h3" gutterBottom>Ejecutar el sorteo</Typography>
              <Typography gutterBottom>Entropía externa (recomendado): un valor público que nadie conoce de antemano, anunciado en vivo. Ej.: números de un dado lanzado por un apoderado o los números ganadores de un sorteo oficial del día.</Typography>
              <TextField label="Entropía externa" value={entropia} onChange={(e) => setEntropia(e.target.value)} inputProps={{ maxLength: 200 }} sx={{ maxWidth: 500 }} />
              {puede && <Button variant="contained" color="secondary" size="large" sx={{ mt: 2, display: 'block' }} onClick={() => setDialogo('ejecutar')}>Ejecutar sorteo</Button>}
            </CardContent></Card>
          )}

          {paso === 3 && (
            <Card sx={{ mt: 2 }}><CardContent>
              <Typography variant="h3" gutterBottom>Resultado (inmutable) — {fechaHora(so!.ejecutado_at)}</Typography>
              <Table size="small">
                <TableHead><TableRow><TableCell>Lugar</TableCell><TableCell>Premio</TableCell><TableCell>Número</TableCell><TableCell>Ganador</TableCell><TableCell>Entrega</TableCell></TableRow></TableHead>
                <TableBody>
                  {ganadores.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>{g.posicion}°</TableCell><TableCell>{g.premio?.nombre ?? '—'}</TableCell><TableCell><b>{g.numero}</b></TableCell>
                      <TableCell>{g.comprador ? `${g.comprador.nombre} · ${g.comprador.curso}` : 'Sin acceso a datos personales'}</TableCell>
                      <TableCell>{g.entrega.length ? `Entregado a ${g.entrega[0].recibido_por} (${fechaHora(g.entrega[0].entregado_at)})`
                        : auth.tiene('premios.entregar') ? <Button size="small" variant="outlined" onClick={() => setEntrega(g)}>Registrar entrega</Button> : 'Pendiente'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TextField label="Testigos / ministro de fe (para el acta)" value={testigos} onChange={(e) => setTestigos(e.target.value)} sx={{ mt: 2, maxWidth: 500 }} size="small" />
              <Stack direction="row" gap={1} sx={{ mt: 2 }} flexWrap="wrap">
                {puede && <Button variant="contained" onClick={subirActa}>Generar acta PDF</Button>}
                <Button variant="outlined" onClick={exportar}>Exportar resultados (Excel)</Button>
              </Stack>
            </CardContent></Card>
          )}
        </>
      )}

      <Confirmar abierto={dialogo === 'cerrar'} titulo="Cerrar ventas" peligro mensaje="No se aceptarán nuevas reservas."
        onCancelar={() => setDialogo(null)} onConfirmar={async () => { await rpc('cerrar_ventas', { p_rifa_id: rifaId }); setDialogo(null); await cargar(); }} />
      <Confirmar abierto={dialogo === 'congelar'} titulo="Congelar padrón" textoConfirmar="Congelar"
        mensaje={<>Se fijará el listado de números participantes y la cantidad de ganadores (<b>{cantidad}</b>). <b>No se podrá modificar.</b></>}
        onCancelar={() => setDialogo(null)}
        onConfirmar={async () => { await rpc('congelar_padron', { p_rifa_id: rifaId, p_cantidad_ganadores: cantidad, p_permitir_repetidos: repetidos, p_forzar: forzar }); setDialogo(null); await cargar(); }} />
      <Confirmar abierto={dialogo === 'ejecutar'} titulo="Ejecutar sorteo" textoConfirmar="Sortear ahora"
        mensaje={<>El servidor calculará los ganadores de forma definitiva. Entropía externa: <b>{entropia || '(ninguna)'}</b>. Abra la pantalla de transmisión antes para que el público vea la animación.</>}
        onCancelar={() => setDialogo(null)}
        onConfirmar={async () => { await rpc('ejecutar_sorteo', { p_sorteo_id: so!.id, p_entropia_externa: entropia }); setDialogo(null); avisar('Sorteo ejecutado'); await cargar(); }} />
      <Confirmar abierto={!!entrega} titulo={`Entrega del ${entrega?.posicion}° premio (N° ${entrega?.numero})`} pedirMotivo="Nombre de quien recibe" minMotivo={3}
        mensaje="Registre quién recibió el premio. Quedará en el historial y no se podrá modificar." onCancelar={() => setEntrega(null)}
        onConfirmar={async (m) => { await rpc('registrar_entrega_premio', { p_ganador_id: entrega!.id, p_recibido_por: m }); setEntrega(null); avisar('Entrega registrada'); await cargar(); }} />
    </>
  );
}
