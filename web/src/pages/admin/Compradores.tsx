import { Button, Card, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Cargando, Confirmar, ErrorCaja, useAviso } from '../../components/comunes';
import { useAuth } from '../../lib/auth';
import { mensajeError } from '../../lib/errores';
import { ESTADO_RESERVA } from '../../lib/estados';
import { clp, fechaHora, formatoTelefono, normalizarTelefono } from '../../lib/formato';
import { rpc, supabase } from '../../lib/supabase';
import type { ReservaAdmin } from '../../lib/tipos';
import { SelectorRifa } from './Dashboard';
import { DetalleReserva } from './Pagos';

/** Búsqueda por nombre, teléfono, curso o código de reserva. */
export default function Compradores() {
  const auth = useAuth();
  const avisar = useAviso();
  const [q, setQ] = useState('');
  const [curso, setCurso] = useState('');
  const [rifa, setRifa] = useState('');
  const [filas, setFilas] = useState<ReservaAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<ReservaAdmin | null>(null);
  const [anonimizar, setAnonimizar] = useState<ReservaAdmin | null>(null);

  const buscar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    let consulta = supabase.from('v_reservas_admin').select('*').order('created_at', { ascending: false }).limit(200);
    const t = q.trim();
    if (t) {
      const tel = normalizarTelefono(t);
      if (/^CCPP-/i.test(t)) consulta = consulta.ilike('codigo', `${t.toUpperCase()}%`);
      else if (tel) consulta = consulta.eq('telefono', tel);
      else consulta = consulta.ilike('comprador_nombre', `%${t.replace(/[%_,()]/g, '')}%`);
    }
    if (curso.trim()) consulta = consulta.ilike('curso', curso.trim().replace(/[%_,()]/g, ''));
    if (rifa) consulta = consulta.eq('rifa_id', rifa);
    const { data, error: er } = await consulta;
    if (er) setError(mensajeError(er)); else setFilas(data as ReservaAdmin[]);
  };
  useEffect(() => { void buscar(); /* eslint-disable-next-line */ }, [rifa]);

  return (
    <>
      <Typography variant="h1" gutterBottom>Compradores</Typography>
      <Stack component="form" onSubmit={buscar} direction={{ xs: 'column', md: 'row' }} gap={1.5} sx={{ mb: 2 }}>
        <TextField size="small" label="Nombre, teléfono o código de reserva" value={q} onChange={(e) => setQ(e.target.value)} />
        <TextField size="small" label="Curso" value={curso} onChange={(e) => setCurso(e.target.value)} sx={{ maxWidth: 160 }} />
        <SelectorRifa valor={rifa} onCambio={setRifa} />
        <Button type="submit" variant="contained">Buscar</Button>
      </Stack>
      <ErrorCaja error={error} />
      {!filas ? <Cargando /> : (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Comprador</TableCell><TableCell>Curso</TableCell><TableCell>Teléfono</TableCell><TableCell>Reserva</TableCell><TableCell>Números</TableCell><TableCell>Monto</TableCell><TableCell>Estado</TableCell><TableCell>Fecha</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {filas.map((f) => (
                <TableRow key={f.id} hover>
                  <TableCell>{f.comprador_nombre}</TableCell><TableCell>{f.curso}</TableCell><TableCell>{formatoTelefono(f.telefono)}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}><Button size="small" onClick={() => setAbierta(f)}>{f.codigo}</Button></TableCell>
                  <TableCell>{f.numeros?.join(', ')}</TableCell><TableCell>{clp(f.monto_total)}</TableCell>
                  <TableCell><Chip size="small" label={ESTADO_RESERVA[f.estado].etiqueta} color={ESTADO_RESERVA[f.estado].color} /></TableCell>
                  <TableCell>{fechaHora(f.created_at)}</TableCell>
                  <TableCell>{auth.tiene('configuracion.gestionar') && f.telefono && <Button size="small" color="error" onClick={() => setAnonimizar(f)}>Suprimir datos</Button>}</TableCell>
                </TableRow>
              ))}
              {filas.length === 0 && <TableRow><TableCell colSpan={9}>Sin resultados.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {abierta && <DetalleReserva reserva={abierta} onCerrar={() => { setAbierta(null); void buscar(); }} />}
      <Confirmar abierto={!!anonimizar} titulo="Suprimir datos personales" peligro pedirMotivo="Motivo (p. ej. solicitud del titular)"
        mensaje={<>Se anonimizarán nombre, teléfono, correo y RUT de <b>{anonimizar?.comprador_nombre}</b> en todas sus reservas. Las cifras y la trazabilidad se conservan. Esta acción no se puede deshacer.</>}
        onCancelar={() => setAnonimizar(null)}
        onConfirmar={async (m) => { await rpc('anonimizar_comprador', { p_comprador_id: anonimizar!.comprador_id, p_motivo: m }); setAnonimizar(null); avisar('Datos anonimizados'); void buscar(); }} />
    </>
  );
}
