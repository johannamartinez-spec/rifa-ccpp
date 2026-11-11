import CasinoIcon from '@mui/icons-material/Casino';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SyncIcon from '@mui/icons-material/Sync';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, CardMedia, Checkbox, Chip, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControlLabel, Grid, LinearProgress, Link, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Link as RLink, useParams } from 'react-router-dom';
import { Cargando, ErrorCaja } from '../../components/comunes';
import { Leyenda, NumberGrid } from '../../components/NumberGrid';
import { useNumeros } from '../../hooks/useNumeros';
import { mensajeError } from '../../lib/errores';
import { ESTADO_RIFA } from '../../lib/estados';
import { clp, fechaLarga, normalizarRut, normalizarTelefono, numeroCL, urlPublica } from '../../lib/formato';
import { rpc, supabase } from '../../lib/supabase';
import type { Premio, ResultadoReserva, Rifa } from '../../lib/tipos';
import { erroresPorCampo, esquemaComprador } from '../../lib/validacion';
import { ConfirmacionReserva } from './Reserva';

const VACIO = { nombre: '', curso: '', telefono: '', email: '', rut: '', acepta: false };

export default function PaginaRifa() {
  const { id } = useParams();
  const [rifa, setRifa] = useState<Rifa | null>(null);
  const [premios, setPremios] = useState<Premio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { numeros, cargando, enVivo, recargar } = useNumeros(id);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [formAbierto, setFormAbierto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<(ResultadoReserva & { telefono: string }) | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: r, error: e }, { data: p }] = await Promise.all([
        supabase.from('rifas').select('*').eq('id', id).maybeSingle(),
        supabase.from('premios').select('*').eq('rifa_id', id).order('posicion'),
      ]);
      if (e) setError(mensajeError(e));
      else if (!r) setError('Rifa no encontrada.');
      else { setRifa(r as Rifa); setPremios((p ?? []) as Premio[]); document.title = `${r.nombre} — Rifa Online CCPP`; }
    })();
  }, [id]);

  // Si un número seleccionado deja de estar disponible (otro comprador), se quita de la selección
  useEffect(() => {
    setSeleccion((s) => {
      const quitados = [...s].filter((n) => numeros.get(n) !== 'disponible');
      if (quitados.length === 0) return s;
      const nuevo = new Set(s);
      quitados.forEach((n) => nuevo.delete(n));
      return nuevo;
    });
  }, [numeros]);

  const resumen = useMemo(() => {
    const c = { total: numeros.size, vendidos: 0, disponibles: 0 };
    numeros.forEach((e) => { if (e === 'vendido') c.vendidos++; if (e === 'disponible') c.disponibles++; });
    return c;
  }, [numeros]);

  if (error) return <Container sx={{ py: 3 }}><ErrorCaja error={error} /></Container>;
  if (!rifa) return <Cargando />;
  if (resultado) {
    return <ConfirmacionReserva r={resultado} telefono={resultado.telefono} onNueva={() => { setResultado(null); setSeleccion(new Set()); void recargar(); }} />;
  }

  const ventaAbierta = rifa.estado === 'activa' && (!rifa.cierre_ventas_at || new Date(rifa.cierre_ventas_at) > new Date());
  const total = seleccion.size * rifa.precio_numero;
  const listaSel = [...seleccion].sort((a, b) => a - b);
  const set = (k: keyof typeof VACIO) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const validar = () => {
    const r = esquemaComprador(rifa.pedir_rut).safeParse(form);
    if (!r.success) { setErrores(erroresPorCampo(r.error)); return false; }
    setErrores({});
    return true;
  };

  const reservar = async () => {
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const tel = normalizarTelefono(form.telefono)!;
      const r = await rpc<ResultadoReserva>('reservar_numeros', {
        p_rifa_id: rifa.id, p_numeros: listaSel, p_nombre: form.nombre.trim(), p_curso: form.curso.trim(), p_telefono: tel,
        p_email: form.email.trim() || null, p_rut: form.rut ? normalizarRut(form.rut) : null,
      });
      try { localStorage.setItem('ccpp_ultima_reserva', JSON.stringify({ codigo: r.codigo, telefono: tel })); } catch { /* modo privado */ }
      setResultado({ ...r, telefono: tel });
      setFormAbierto(false);
      setConfirmando(false);
      setForm(VACIO);
    } catch (e) {
      setErrorEnvio(mensajeError(e));
      setConfirmando(false);
      void recargar();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 2, pb: seleccion.size ? 14 : 4 }}>
      <Card sx={{ mb: 2 }}>
        {rifa.afiche_path && <CardMedia component="img" image={urlPublica(rifa.afiche_path)} alt={`Afiche de ${rifa.nombre}`} sx={{ maxHeight: 420, objectFit: 'contain', bgcolor: '#eef3ef' }} />}
        <CardContent>
          <Typography variant="caption" color="text.secondary">{rifa.centro_padres} · {rifa.colegio}</Typography>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography variant="h1" sx={{ flex: 1 }}>{rifa.nombre}</Typography>
            <Chip label={ESTADO_RIFA[rifa.estado].etiqueta} color={ESTADO_RIFA[rifa.estado].color} />
          </Stack>
          {rifa.descripcion && <Typography sx={{ mt: 1, whiteSpace: 'pre-line' }}>{rifa.descripcion}</Typography>}
          {rifa.objetivo && <Alert icon={false} severity="success" sx={{ mt: 2 }}><b>Objetivo:</b> {rifa.objetivo}</Alert>}
          <Grid container spacing={1.5} sx={{ mt: 1 }}>
            <Dato t="Valor por número" v={clp(rifa.precio_numero)} />
            <Dato t="Números" v={`${numeroCL(rifa.numero_inicial)} al ${numeroCL(rifa.numero_final)} (${numeroCL(resumen.total)})`} />
            <Dato t="Sorteo" v={fechaLarga(rifa.fecha_sorteo)} ancho />
          </Grid>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">Avance: {numeroCL(resumen.vendidos)} vendidos · {numeroCL(resumen.disponibles)} disponibles</Typography>
            <LinearProgress variant="determinate" value={resumen.total ? (100 * resumen.vendidos) / resumen.total : 0} color="secondary" sx={{ height: 10, borderRadius: 5, mt: 0.5 }} />
          </Box>
          {(rifa.estado === 'cerrada' || rifa.estado === 'sorteada') && (
            <Button component={RLink} to={`/sorteo/${rifa.id}`} startIcon={<CasinoIcon />} variant="outlined" sx={{ mt: 2 }}>
              {rifa.estado === 'sorteada' ? 'Ver resultado del sorteo' : 'Ver sorteo en vivo'}
            </Button>
          )}
        </CardContent>
      </Card>

      {premios.length > 0 && (
        <>
          <Typography variant="h2" sx={{ my: 2 }}>Premios</Typography>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            {premios.map((p) => (
              <Grid item xs={12} sm={6} key={p.id}>
                <Card sx={{ display: 'flex', height: '100%' }}>
                  {p.foto_path && <CardMedia component="img" image={urlPublica(p.foto_path)} alt={p.nombre} sx={{ width: 110, objectFit: 'cover' }} loading="lazy" />}
                  <CardContent>
                    <Typography variant="overline" color="secondary.dark" fontWeight={800}>{p.posicion}° premio</Typography>
                    <Typography fontWeight={800}>{p.nombre}</Typography>
                    {p.descripcion && <Typography variant="body2" color="text.secondary">{p.descripcion}</Typography>}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 3 }}>
        <Typography variant="h2">Elige tus números</Typography>
        <Chip size="small" icon={<SyncIcon />} label={enVivo ? 'En vivo' : 'Actualizando'} color={enVivo ? 'success' : 'default'} variant="outlined" />
      </Stack>
      {!ventaAbierta && <Alert severity="info" sx={{ my: 1 }}>La venta no está abierta. Puede ver el estado de los números.</Alert>}
      <Leyenda />
      {errorEnvio && !formAbierto && <Alert severity="warning" sx={{ my: 1 }}>{errorEnvio}</Alert>}
      {cargando ? <Cargando texto="Cargando números…" /> : (
        <NumberGrid
          numeros={numeros} seleccion={seleccion} deshabilitado={!ventaAbierta} maxSeleccion={rifa.max_numeros_reserva}
          onAlternar={(n) => setSeleccion((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; })}
        />
      )}

      <Stack gap={1} sx={{ mt: 3 }}>
        <Seccion t="Bases y condiciones" c={rifa.bases} />
        <Seccion t="Cómo pagar" c={rifa.info_pago} abierta />
        <Seccion t="Contacto" c={rifa.contacto} />
      </Stack>

      {seleccion.size > 0 && ventaAbierta && (
        <Paper elevation={8} sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, p: 1.5, zIndex: 10, borderRadius: '16px 16px 0 0', pb: 'calc(12px + env(safe-area-inset-bottom))' }}>
          <Container maxWidth="md">
            <Stack direction="row" alignItems="center" gap={2}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={800}>{seleccion.size} {seleccion.size === 1 ? 'número' : 'números'} · {clp(total)}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>{listaSel.join(', ')}</Typography>
              </Box>
              <Button variant="text" onClick={() => setSeleccion(new Set())}>Limpiar</Button>
              <Button variant="contained" color="secondary" size="large" onClick={() => { setErrorEnvio(null); setFormAbierto(true); }}>Continuar</Button>
            </Stack>
          </Container>
        </Paper>
      )}

      <Dialog open={formAbierto} onClose={() => !enviando && setFormAbierto(false)} fullWidth maxWidth="sm" scroll="body">
        <DialogTitle>Tus datos</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Números: <b>{listaSel.join(', ')}</b> · Total <b>{clp(total)}</b>. Pedimos sólo lo necesario para identificar tu compra.
          </Typography>
          <Stack gap={2}>
            <TextField label="Nombre y apellido" value={form.nombre} onChange={set('nombre')} error={!!errores.nombre} helperText={errores.nombre} autoComplete="name" required />
            <TextField label="Curso del estudiante" placeholder="Ej: 4°B" value={form.curso} onChange={set('curso')} error={!!errores.curso} helperText={errores.curso} required />
            <TextField label="Celular" placeholder="9 1234 5678" value={form.telefono} onChange={set('telefono')} error={!!errores.telefono}
              helperText={errores.telefono ?? 'Lo usarás junto al código para consultar tu reserva'} inputMode="tel" autoComplete="tel" required />
            <TextField label="Correo electrónico (opcional)" value={form.email} onChange={set('email')} error={!!errores.email}
              helperText={errores.email ?? 'Para recibir la confirmación y avisos'} inputMode="email" autoComplete="email" />
            {rifa.pedir_rut && (
              <TextField label="RUT" placeholder="12.345.678-5" value={form.rut} onChange={set('rut')} error={!!errores.rut}
                helperText={errores.rut ?? 'Requerido por las bases de esta rifa'} required />
            )}
            <FormControlLabel
              control={<Checkbox checked={form.acepta} onChange={set('acepta')} />}
              label={<span>Acepto las bases y la <Link component={RLink} to="/privacidad" target="_blank">política de privacidad</Link></span>}
            />
            {errores.acepta && <Typography color="error" variant="body2">{errores.acepta}</Typography>}
            {errorEnvio && <Alert severity="error">{errorEnvio}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setFormAbierto(false)} disabled={enviando}>Volver</Button>
          <Button variant="contained" size="large" onClick={() => validar() && setConfirmando(true)} disabled={enviando}>Revisar y reservar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmando} onClose={() => !enviando && setConfirmando(false)} fullWidth maxWidth="xs">
        <DialogTitle>¿Confirmas tu reserva?</DialogTitle>
        <DialogContent>
          <Typography>Números: <b>{listaSel.join(', ')}</b></Typography>
          <Typography>Total a pagar: <b>{clp(total)}</b></Typography>
          <Typography sx={{ mt: 1 }} color="text.secondary">Tendrás <b>{rifa.minutos_reserva} minutos</b> para transferir y enviar el comprobante. Si no, los números se liberan.</Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirmando(false)} disabled={enviando}>Corregir</Button>
          <Button variant="contained" color="secondary" size="large" onClick={reservar} disabled={enviando}>{enviando ? 'Reservando…' : 'Sí, reservar'}</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

function Dato({ t, v, ancho }: { t: string; v: string; ancho?: boolean }) {
  return (
    <Grid item xs={ancho ? 12 : 6}>
      <Box sx={{ bgcolor: '#f3f7f4', borderRadius: 2, p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">{t}</Typography>
        <Typography fontWeight={800}>{v}</Typography>
      </Box>
    </Grid>
  );
}

function Seccion({ t, c, abierta }: { t: string; c: string | null; abierta?: boolean }) {
  if (!c) return null;
  return (
    <Accordion defaultExpanded={abierta} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography fontWeight={800}>{t}</Typography></AccordionSummary>
      <AccordionDetails><Typography sx={{ whiteSpace: 'pre-line' }}>{c}</Typography></AccordionDetails>
    </Accordion>
  );
}
