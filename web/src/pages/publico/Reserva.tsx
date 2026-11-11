import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TimerIcon from '@mui/icons-material/Timer';
import {
  Alert, Box, Button, Card, CardContent, Chip, Container, Divider, List, ListItem, ListItemText, Stack, TextField, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RLink, useSearchParams } from 'react-router-dom';
import { BotonCopiar } from '../../components/comunes';
import { SubirComprobante } from '../../components/SubirComprobante';
import { useCuentaRegresiva } from '../../hooks/useNumeros';
import { mensajeError } from '../../lib/errores';
import { ESTADO_RESERVA } from '../../lib/estados';
import { clp, fechaHora, fechaLarga, normalizarTelefono, tiempoRestante } from '../../lib/formato';
import { llamarFuncion, rpc } from '../../lib/supabase';
import type { ConsultaReserva, ResultadoReserva } from '../../lib/tipos';

const webpayHabilitado = import.meta.env.VITE_WEBPAY_HABILITADO === 'true';

function Plazo({ hasta }: { hasta: string | null }) {
  const ms = useCuentaRegresiva(hasta);
  if (ms === null) return null;
  const urgente = ms < 5 * 60_000;
  return (
    <Alert icon={<TimerIcon />} severity={ms <= 0 ? 'error' : urgente ? 'warning' : 'info'} sx={{ my: 2 }} role="timer" aria-live="off">
      {ms <= 0 ? 'El plazo de pago terminó.' : <>Tiempo para enviar el comprobante: <b style={{ fontSize: 18 }}>{tiempoRestante(ms)}</b> (hasta {fechaHora(hasta)})</>}
    </Alert>
  );
}

/** Pantalla inmediatamente posterior a reservar. */
export function ConfirmacionReserva({ r, telefono, onNueva }: { r: ResultadoReserva; telefono: string; onNueva: () => void }) {
  const [enviado, setEnviado] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Card>
        <CardContent>
          <Stack alignItems="center" textAlign="center" gap={1}>
            <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
            <Typography variant="h2">¡Números reservados!</Typography>
            <Typography color="text.secondary">Guarde su código. Lo necesitará con su celular para consultar la reserva.</Typography>
          </Stack>
          <Box sx={{ my: 2, p: 2, bgcolor: '#fff8e1', borderRadius: 2, textAlign: 'center', border: '2px solid', borderColor: 'secondary.main' }}>
            <Typography variant="caption">Código de reserva</Typography>
            <Stack direction="row" justifyContent="center" alignItems="center">
              <Typography sx={{ fontSize: 28, fontWeight: 900, letterSpacing: 2, fontFamily: 'monospace' }} data-testid="codigo-reserva">{r.codigo}</Typography>
              <BotonCopiar texto={r.codigo} etiqueta="Copiar código" />
            </Stack>
          </Box>
          <Typography>Números: <b>{r.numeros.join(', ')}</b></Typography>
          <Typography sx={{ fontSize: 20 }}>Total a transferir: <b>{clp(r.monto_total)}</b></Typography>
          {!enviado && <Plazo hasta={r.expira_at} />}
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" alignItems="center"><Typography fontWeight={800} sx={{ flex: 1 }}>Datos para transferir</Typography><BotonCopiar texto={r.info_pago} etiqueta="Copiar datos" /></Stack>
          <Typography sx={{ whiteSpace: 'pre-line', bgcolor: '#f3f7f4', p: 1.5, borderRadius: 2, my: 1 }}>{r.info_pago}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Indique el código <b>{r.codigo}</b> en el comentario de la transferencia.</Typography>
          <SubirComprobante codigo={r.codigo} telefono={telefono} onListo={() => setEnviado(true)} />
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mt: 2 }}>
            <Button component={RLink} to={`/reserva?codigo=${r.codigo}`} variant="outlined">Ver estado de mi reserva</Button>
            <Button onClick={onNueva}>Reservar otros números</Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

/** Consulta pública de reserva con código + teléfono. */
export default function PaginaReserva() {
  const [params] = useSearchParams();
  const guardada = (() => { try { return JSON.parse(localStorage.getItem('ccpp_ultima_reserva') ?? 'null'); } catch { return null; } })();
  const [codigo, setCodigo] = useState(params.get('codigo') ?? guardada?.codigo ?? '');
  const [telefono, setTelefono] = useState(guardada && (!params.get('codigo') || params.get('codigo') === guardada.codigo) ? guardada.telefono : '');
  const [datos, setDatos] = useState<ConsultaReserva | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const pago = params.get('pago');

  const consultar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const tel = normalizarTelefono(telefono);
    if (!tel) { setError('Ingrese el celular con el que reservó.'); return; }
    setCargando(true); setError(null);
    try {
      setDatos(await rpc<ConsultaReserva>('consultar_reserva', { p_codigo: codigo.trim().toUpperCase(), p_telefono: tel }));
    } catch (er) { setDatos(null); setError(mensajeError(er)); } finally { setCargando(false); }
  };

  useEffect(() => { if (codigo && telefono) void consultar(); /* eslint-disable-next-line */ }, []);

  const pagarWebpay = async () => {
    try {
      const r = await llamarFuncion<{ url: string; token: string }>('webpay', { codigo: datos!.codigo, telefono: normalizarTelefono(telefono) });
      const f = document.createElement('form');
      f.method = 'POST'; f.action = r.url;
      const i = document.createElement('input'); i.type = 'hidden'; i.name = 'token_ws'; i.value = r.token;
      f.appendChild(i); document.body.appendChild(f); f.submit();
    } catch (e) { setError(mensajeError(e)); }
  };

  const est = datos ? ESTADO_RESERVA[datos.estado] : null;
  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Typography variant="h1" gutterBottom>Mi reserva</Typography>
      {pago === 'ok' && <Alert severity="success" sx={{ mb: 2 }}>Pago con Webpay aprobado.</Alert>}
      {pago === 'rechazado' && <Alert severity="error" sx={{ mb: 2 }}>El pago con Webpay no fue aprobado.</Alert>}
      {pago === 'revision' && <Alert severity="warning" sx={{ mb: 2 }}>Su pago fue autorizado pero la reserva ya no estaba vigente. Tesorería lo contactará.</Alert>}
      <Card component="form" onSubmit={consultar} sx={{ mb: 2 }}>
        <CardContent>
          <Stack gap={2}>
            <TextField label="Código de reserva" placeholder="CCPP-XXXX-XXXX" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} inputProps={{ autoCapitalize: 'characters' }} required />
            <TextField label="Celular" placeholder="9 1234 5678" value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" required />
            <Button type="submit" variant="contained" size="large" disabled={cargando}>{cargando ? 'Consultando…' : 'Consultar'}</Button>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </CardContent>
      </Card>

      {datos && est && (
        <Card>
          <CardContent>
            <Typography variant="caption" color="text.secondary">{datos.rifa}</Typography>
            <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" sx={{ mb: 1 }}>
              <Typography variant="h3" sx={{ fontFamily: 'monospace' }}>{datos.codigo}</Typography>
              <Chip label={est.etiqueta} color={est.color} data-testid="estado-reserva" />
            </Stack>
            <Typography color="text.secondary">{est.ayuda}</Typography>
            {datos.motivo && <Alert severity="warning" sx={{ mt: 1 }}>Motivo indicado por Tesorería: {datos.motivo}</Alert>}
            <Typography sx={{ mt: 2 }}>Hola {datos.nombre}. Números: <b>{datos.numeros.join(', ')}</b></Typography>
            <Typography>Total: <b>{clp(datos.monto_total)}</b></Typography>
            {datos.fecha_sorteo && <Typography variant="body2" color="text.secondary">Sorteo: {fechaLarga(datos.fecha_sorteo)}</Typography>}
            {(datos.estado === 'reservado' || datos.estado === 'pendiente_pago') && <Plazo hasta={datos.expira_at} />}
            {datos.puede_subir_comprobante && (
              <>
                {datos.info_pago && <Typography sx={{ whiteSpace: 'pre-line', bgcolor: '#f3f7f4', p: 1.5, borderRadius: 2, my: 2 }}>{datos.info_pago}</Typography>}
                <SubirComprobante codigo={datos.codigo} telefono={normalizarTelefono(telefono)!} onListo={() => void consultar()} />
                {webpayHabilitado && (datos.estado === 'reservado' || datos.estado === 'pendiente_pago') && (
                  <Button variant="outlined" size="large" fullWidth sx={{ mt: 2 }} onClick={pagarWebpay}>Pagar con Webpay</Button>
                )}
              </>
            )}
            {datos.comprobantes.length > 0 && (
              <>
                <Typography fontWeight={800} sx={{ mt: 2 }}>Comprobantes enviados</Typography>
                <List dense>
                  {datos.comprobantes.map((c, i) => (
                    <ListItem key={i} disableGutters>
                      <ListItemText primary={`${fechaHora(c.fecha)} — ${({ pendiente: 'En revisión', aprobado: 'Aprobado', rechazado: 'Rechazado', reemplazado: 'Reemplazado' } as Record<string, string>)[c.estado] ?? c.estado}`} secondary={c.motivo} />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
            <Button component={RLink} to={`/rifa/${datos.rifa_id}`} sx={{ mt: 1 }}>Ir a la rifa</Button>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
