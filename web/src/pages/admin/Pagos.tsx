import {
  Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, MenuItem, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Cargando, Confirmar, ErrorCaja, useAviso } from '../../components/comunes';
import { useAuth } from '../../lib/auth';
import { mensajeError } from '../../lib/errores';
import { ESTADO_RESERVA, type EstadoReserva } from '../../lib/estados';
import { clp, fechaHora, formatoTelefono } from '../../lib/formato';
import { rpc, supabase } from '../../lib/supabase';
import type { ReservaAdmin } from '../../lib/tipos';
import { SelectorRifa } from './Dashboard';

const PESTANAS: { t: string; estados: EstadoReserva[] }[] = [
  { t: 'Por revisar', estados: ['comprobante_enviado', 'en_revision'] },
  { t: 'Esperando pago', estados: ['reservado', 'pendiente_pago'] },
  { t: 'Aprobados', estados: ['pagado'] },
  { t: 'Rechazados', estados: ['rechazado'] },
  { t: 'Cancelados / vencidos', estados: ['cancelado', 'expirado'] },
];

export default function Pagos() {
  const [tab, setTab] = useState(0);
  const [rifa, setRifa] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filas, setFilas] = useState<ReservaAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<ReservaAdmin | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    let q = supabase.from('v_reservas_admin').select('*').in('estado', PESTANAS[tab].estados).order('updated_at', { ascending: tab === 0 }).limit(300);
    if (rifa) q = q.eq('rifa_id', rifa);
    if (desde) q = q.gte('created_at', new Date(`${desde}T00:00:00`).toISOString());
    if (hasta) q = q.lt('created_at', new Date(new Date(`${hasta}T00:00:00`).getTime() + 86400000).toISOString());
    const { data, error: e } = await q;
    if (e) setError(mensajeError(e)); else setFilas(data as ReservaAdmin[]);
  }, [tab, rifa, desde, hasta]);
  useEffect(() => { void cargar(); }, [cargar]);

  // refresco periódico de la bandeja (llegada de nuevos comprobantes)
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) void cargar(); }, 30_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  return (
    <>
      <Typography variant="h1" gutterBottom>Pagos y comprobantes</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} sx={{ mb: 2 }}>
        <SelectorRifa valor={rifa} onCambio={setRifa} />
        <TextField size="small" type="date" label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ maxWidth: 180 }} />
        <TextField size="small" type="date" label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ maxWidth: 180 }} />
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        {PESTANAS.map((p) => <Tab key={p.t} label={p.t} />)}
      </Tabs>
      <ErrorCaja error={error} onReintentar={cargar} />
      {!filas ? <Cargando /> : (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Código</TableCell><TableCell>Comprador</TableCell><TableCell>Curso</TableCell><TableCell>Números</TableCell><TableCell>Monto</TableCell><TableCell>Estado</TableCell><TableCell>Actualizado</TableCell></TableRow></TableHead>
            <TableBody>
              {filas.map((f) => (
                <TableRow key={f.id} hover sx={{ cursor: 'pointer' }} onClick={() => setAbierta(f)}>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{f.codigo}</TableCell>
                  <TableCell>{f.comprador_nombre}</TableCell><TableCell>{f.curso}</TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>{f.numeros?.join(', ')}</TableCell>
                  <TableCell>{clp(f.monto_total)}</TableCell>
                  <TableCell><Chip size="small" label={ESTADO_RESERVA[f.estado].etiqueta} color={ESTADO_RESERVA[f.estado].color} /></TableCell>
                  <TableCell>{fechaHora(f.updated_at)}</TableCell>
                </TableRow>
              ))}
              {filas.length === 0 && <TableRow><TableCell colSpan={7}>No hay reservas en esta bandeja.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {abierta && <DetalleReserva reserva={abierta} onCerrar={() => { setAbierta(null); void cargar(); }} />}
    </>
  );
}

interface Comprobante { id: string; storage_path: string; nombre_original: string; mime: string; tamano_bytes: number; estado_revision: string; created_at: string; motivo_rechazo: string | null; sha256: string }
interface Pago { id: string; metodo: string; monto: number; estado: string; validado_at: string | null; motivo: string | null; observacion: string | null; referencia_externa: string | null; validador: { nombre: string } | null; revertidor: { nombre: string } | null; revertido_at: string | null }
interface Hist { id: number; estado_anterior: string | null; estado_nuevo: string; actor: string; detalle: string | null; created_at: string; usuario: { nombre: string } | null }

export function DetalleReserva({ reserva, onCerrar }: { reserva: ReservaAdmin; onCerrar: () => void }) {
  const auth = useAuth();
  const avisar = useAviso();
  const puedeValidar = auth.tiene('pagos.validar');
  const puedeVerPagos = auth.tiene('pagos.ver');
  const [estado, setEstado] = useState(reserva.estado);
  const [comps, setComps] = useState<Comprobante[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [url, setUrl] = useState<{ id: string; url: string; mime: string } | null>(null);
  const [dialogo, setDialogo] = useState<null | 'aprobar' | 'rechazar' | 'manual' | 'cancelar' | 'revertir'>(null);
  const [solicitarNuevo, setSolicitarNuevo] = useState(false);
  const [liberar, setLiberar] = useState(true);
  const [manual, setManual] = useState({ metodo: 'transferencia', referencia: '' });
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [c, p, h, r] = await Promise.all([
      puedeVerPagos ? supabase.from('comprobantes').select('*').eq('reserva_id', reserva.id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
      puedeVerPagos ? supabase.from('pagos').select('*, validador:usuarios!pagos_validado_por_fkey(nombre), revertidor:usuarios!pagos_revertido_por_fkey(nombre)').eq('reserva_id', reserva.id).order('created_at') : Promise.resolve({ data: [] }),
      supabase.from('historial_reservas').select('*, usuario:usuarios(nombre)').eq('reserva_id', reserva.id).order('id'),
      supabase.from('reservas').select('estado').eq('id', reserva.id).single(),
    ]);
    setComps((c.data ?? []) as Comprobante[]);
    setPagos((p.data ?? []) as unknown as Pago[]);
    setHist((h.data ?? []) as unknown as Hist[]);
    if (r.data) setEstado(r.data.estado);
  }, [reserva.id, puedeVerPagos]);

  useEffect(() => {
    (async () => {
      if (puedeValidar && reserva.estado === 'comprobante_enviado') {
        try { await rpc('iniciar_revision', { p_reserva_id: reserva.id }); } catch { /* sin efecto */ }
      }
      await cargar();
    })();
  }, [reserva.id, reserva.estado, puedeValidar, cargar]);

  const ver = async (c: Comprobante) => {
    setError(null);
    // URL firmada de 5 minutos: el archivo nunca queda público
    const { data, error: e } = await supabase.storage.from('comprobantes').createSignedUrl(c.storage_path, 300);
    if (e || !data) { setError(mensajeError(e)); return; }
    setUrl({ id: c.id, url: data.signedUrl, mime: c.mime });
  };

  const ejecutar = async (fn: string, args: Record<string, unknown>, ok: string) => {
    await rpc(fn, { p_reserva_id: reserva.id, ...args });
    setDialogo(null); avisar(ok); await cargar();
  };

  const conComprobante = estado === 'comprobante_enviado' || estado === 'en_revision';
  const abiertaSinPago = ['reservado', 'pendiente_pago', 'comprobante_enviado', 'en_revision'].includes(estado);

  return (
    <Dialog open onClose={onCerrar} fullWidth maxWidth="lg" scroll="paper">
      <DialogTitle>
        Reserva <span style={{ fontFamily: 'monospace' }}>{reserva.codigo}</span> <Chip size="small" label={ESTADO_RESERVA[estado].etiqueta} color={ESTADO_RESERVA[estado].color} sx={{ ml: 1 }} />
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12} md={5}>
            <Typography><b>{reserva.comprador_nombre}</b> · {reserva.curso}</Typography>
            <Typography>{formatoTelefono(reserva.telefono)} {reserva.email && `· ${reserva.email}`}</Typography>
            {reserva.rut && <Typography>RUT: {reserva.rut}</Typography>}
            <Typography sx={{ mt: 1 }}>{reserva.rifa_codigo} — {reserva.rifa_nombre}</Typography>
            <Typography>Números: <b>{reserva.numeros?.join(', ')}</b></Typography>
            <Typography sx={{ fontSize: 22 }}>Monto esperado: <b>{clp(reserva.monto_total)}</b></Typography>
            {reserva.expira_at && <Typography color="text.secondary">Vence: {fechaHora(reserva.expira_at)}</Typography>}

            <Typography variant="h3" sx={{ mt: 2 }}>Comprobantes</Typography>
            {comps.length === 0 && <Typography color="text.secondary">Sin comprobantes.</Typography>}
            {comps.map((c) => (
              <Stack key={c.id} direction="row" alignItems="center" gap={1} sx={{ py: 0.5 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2">{fechaHora(c.created_at)} · {c.nombre_original} ({Math.round(c.tamano_bytes / 1024)} KB)</Typography>
                  <Typography variant="caption" color="text.secondary">{c.estado_revision}{c.motivo_rechazo && ` — ${c.motivo_rechazo}`}</Typography>
                </Box>
                <Button size="small" variant={url?.id === c.id ? 'contained' : 'outlined'} onClick={() => ver(c)}>Ver</Button>
              </Stack>
            ))}

            <Typography variant="h3" sx={{ mt: 2 }}>Pagos</Typography>
            {pagos.map((p) => (
              <Typography key={p.id} variant="body2" sx={{ py: 0.5 }}>
                {p.metodo} · {clp(p.monto)} · <b>{p.estado}</b>
                {p.validado_at && ` · ${p.validador?.nombre ?? 'Webpay'} ${fechaHora(p.validado_at)}`}
                {p.revertido_at && ` · revertido por ${p.revertidor?.nombre} ${fechaHora(p.revertido_at)}`}
                {(p.motivo || p.observacion) && <><br /><i>{p.motivo ?? p.observacion}</i></>}
              </Typography>
            ))}

            <Typography variant="h3" sx={{ mt: 2 }}>Historial</Typography>
            {hist.map((h) => (
              <Typography key={h.id} variant="body2" sx={{ py: 0.25 }}>
                {fechaHora(h.created_at)} · {h.estado_anterior ?? '—'} → <b>{h.estado_nuevo}</b> · {h.usuario?.nombre ?? h.actor}{h.detalle && ` · ${h.detalle}`}
              </Typography>
            ))}
          </Grid>
          <Grid item xs={12} md={7}>
            <ErrorCaja error={error} />
            {url ? (
              <>
                <Button href={url.url} target="_blank" rel="noopener noreferrer" size="small" sx={{ mb: 1 }}>Abrir en otra pestaña (enlace válido 5 min)</Button>
                {url.mime === 'application/pdf'
                  ? <iframe title="Comprobante PDF" src={url.url} style={{ width: '100%', height: 560, border: 0 }} referrerPolicy="no-referrer" />
                  : <img src={url.url} alt="Comprobante" style={{ width: '100%', maxHeight: 640, objectFit: 'contain', background: '#f3f3f3', borderRadius: 8 }} />}
              </>
            ) : (
              <Alert severity="info">Seleccione "Ver" para revisar el comprobante. Compare el monto, la fecha, la cuenta de destino y el código en el comentario con la cartola bancaria.</Alert>
            )}
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>
        {puedeValidar && conComprobante && <Button variant="contained" color="success" onClick={() => setDialogo('aprobar')}>Aprobar pago</Button>}
        {puedeValidar && conComprobante && <Button variant="outlined" color="error" onClick={() => setDialogo('rechazar')}>Rechazar / pedir otro</Button>}
        {puedeValidar && abiertaSinPago && <Button variant="outlined" onClick={() => setDialogo('manual')}>Confirmar pago manual</Button>}
        {puedeValidar && abiertaSinPago && <Button color="error" onClick={() => setDialogo('cancelar')}>Cancelar reserva</Button>}
        {puedeValidar && estado === 'pagado' && <Button color="error" onClick={() => setDialogo('revertir')}>Revertir pago (ajuste)</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onCerrar}>Cerrar</Button>
      </DialogActions>

      <Confirmar abierto={dialogo === 'aprobar'} titulo="Aprobar pago" textoConfirmar="Aprobar"
        mensaje={<>¿Verificó en la cartola un abono de <b>{clp(reserva.monto_total)}</b>? Los números <b>{reserva.numeros?.join(', ')}</b> quedarán vendidos y se registrará que usted aprobó.</>}
        onCancelar={() => setDialogo(null)} onConfirmar={() => ejecutar('aprobar_pago', { p_observacion: null }, 'Pago aprobado')} />
      <Confirmar abierto={dialogo === 'rechazar'} titulo="Rechazar comprobante" peligro textoConfirmar="Rechazar" pedirMotivo="Motivo (se informa al comprador)"
        mensaje="Elija si se pide un nuevo comprobante (los números siguen reservados con un nuevo plazo) o si se rechaza definitivamente (los números se liberan)."
        extra={<FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={solicitarNuevo} onChange={(e) => setSolicitarNuevo(e.target.checked)} />} label="Solicitar un nuevo comprobante en vez de liberar los números" />}
        onCancelar={() => setDialogo(null)} onConfirmar={(m) => ejecutar('rechazar_pago', { p_motivo: m, p_solicitar_nuevo: solicitarNuevo }, solicitarNuevo ? 'Se solicitó un nuevo comprobante' : 'Pago rechazado y números liberados')} />
      <Confirmar abierto={dialogo === 'manual'} titulo="Confirmar pago manualmente" minMotivo={10} pedirMotivo="Justificación (obligatoria, queda en la bitácora)"
        mensaje="Úselo para pagos en efectivo o transferencias verificadas en la cartola sin comprobante del apoderado."
        extra={<Stack direction="row" gap={1} sx={{ mt: 2 }}>
          <TextField select size="small" label="Método" value={manual.metodo} onChange={(e) => setManual({ ...manual, metodo: e.target.value })} sx={{ width: 180 }}>
            <MenuItem value="transferencia">Transferencia</MenuItem><MenuItem value="efectivo">Efectivo</MenuItem>
          </TextField>
          <TextField size="small" label="N° de operación / recibo" value={manual.referencia} onChange={(e) => setManual({ ...manual, referencia: e.target.value })} />
        </Stack>}
        onCancelar={() => setDialogo(null)} onConfirmar={(m) => ejecutar('confirmar_pago_manual', { p_metodo: manual.metodo, p_referencia: manual.referencia, p_observacion: m }, 'Pago confirmado')} />
      <Confirmar abierto={dialogo === 'cancelar'} titulo="Cancelar reserva" peligro pedirMotivo="Motivo de la cancelación"
        mensaje="Los números se liberarán y el comprador será notificado." onCancelar={() => setDialogo(null)}
        onConfirmar={(m) => ejecutar('cancelar_reserva', { p_motivo: m }, 'Reserva cancelada')} />
      <Confirmar abierto={dialogo === 'revertir'} titulo="Revertir un pago aprobado" peligro minMotivo={10} pedirMotivo="Justificación del ajuste"
        mensaje="Sólo para corregir aprobaciones erróneas y antes de congelar el padrón del sorteo. Quedará registrado como ajuste en los reportes."
        extra={<FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={liberar} onChange={(e) => setLiberar(e.target.checked)} />} label="Liberar los números (si no, se da un nuevo plazo de pago)" />}
        onCancelar={() => setDialogo(null)} onConfirmar={(m) => ejecutar('revertir_pago', { p_motivo: m, p_liberar: liberar }, 'Pago revertido')} />
    </Dialog>
  );
}
