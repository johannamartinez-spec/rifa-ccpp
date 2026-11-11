import { Alert, Button, Card, CardContent, Chip, FormControlLabel, Grid, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Cargando, useAviso } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { fechaHora } from '../../lib/formato';
import { llamarFuncion, rpc, supabase } from '../../lib/supabase';

const TIPOS: Record<string, string> = {
  reserva_confirmada: 'Confirmación de reserva', recordatorio_pago: 'Recordatorio de pago', reserva_expirada: 'Aviso de vencimiento',
  pago_confirmado: 'Confirmación de pago', pago_rechazado: 'Aviso de rechazo', nuevo_comprobante_solicitado: 'Solicitud de nuevo comprobante',
  reserva_cancelada: 'Aviso de cancelación', resultado_sorteo: 'Resultado del sorteo',
};
interface Notif { id: number; tipo: string; canal: string; destinatario: string; estado: string; intentos: number; error: string | null; created_at: string; enviado_at: string | null }

export default function Notificaciones() {
  const avisar = useAviso();
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [filas, setFilas] = useState<Notif[]>([]);

  const cargar = useCallback(async () => {
    const [c, n] = await Promise.all([
      supabase.from('configuraciones').select('clave, valor').like('clave', 'notificaciones.%'),
      supabase.from('notificaciones').select('id, tipo, canal, destinatario, estado, intentos, error, created_at, enviado_at').order('id', { ascending: false }).limit(200),
    ]);
    setCfg(Object.fromEntries((c.data ?? []).map((x) => [x.clave, x.valor])));
    setFilas((n.data ?? []) as Notif[]);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = async (clave: string, valor: unknown) => {
    const { error } = await supabase.from('configuraciones').update({ valor }).eq('clave', clave);
    if (error) avisar(mensajeError(error), 'error'); else void cargar();
  };
  const procesar = async () => {
    try {
      const r = await llamarFuncion<{ configurado: boolean; enviados?: number; errores?: number; mensaje?: string }>('procesar-notificaciones', {});
      avisar(r.configurado ? `Enviados: ${r.enviados}, errores: ${r.errores}` : r.mensaje!, r.configurado ? 'success' : 'info');
      void cargar();
    } catch (e) { avisar(mensajeError(e), 'error'); }
  };

  if (!cfg) return <Cargando />;
  const tipos = cfg['notificaciones.tipos'] ?? {};
  return (
    <>
      <Typography variant="h1" gutterBottom>Notificaciones</Typography>
      <Card><CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControlLabel control={<Switch checked={!!cfg['notificaciones.email_activo']} onChange={(e) => guardar('notificaciones.email_activo', e.target.checked)} />} label="Correo electrónico" />
            <FormControlLabel control={<Switch checked={!!cfg['notificaciones.whatsapp_activo']} onChange={(e) => guardar('notificaciones.whatsapp_activo', e.target.checked)} />} label="WhatsApp (proveedor oficial)" />
            <Alert severity="info" sx={{ mt: 1 }}>WhatsApp sólo envía si se configura la API oficial de WhatsApp Business (Meta) con plantillas aprobadas. Sin eso, los avisos quedan "omitidos".</Alert>
          </Grid>
          <Grid item xs={12} md={8}>
            <Typography fontWeight={800}>Tipos de aviso</Typography>
            <Grid container>
              {Object.entries(TIPOS).map(([k, t]) => (
                <Grid item xs={12} sm={6} key={k}>
                  <FormControlLabel control={<Switch size="small" checked={tipos[k] !== false} onChange={(e) => guardar('notificaciones.tipos', { ...tipos, [k]: e.target.checked })} />} label={t} />
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
        <Stack direction="row" gap={1} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={procesar}>Enviar pendientes ahora</Button>
          <Button onClick={async () => { await rpc('reintentar_notificaciones'); void cargar(); }}>Reintentar con error</Button>
        </Stack>
      </CardContent></Card>
      <Typography variant="h3" sx={{ mt: 3, mb: 1 }}>Historial de envíos</Typography>
      <TableContainer component={Card}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Fecha</TableCell><TableCell>Tipo</TableCell><TableCell>Canal</TableCell><TableCell>Destinatario</TableCell><TableCell>Estado</TableCell><TableCell>Intentos</TableCell></TableRow></TableHead>
          <TableBody>
            {filas.map((f) => (
              <TableRow key={f.id}>
                <TableCell>{fechaHora(f.created_at)}</TableCell><TableCell>{TIPOS[f.tipo] ?? f.tipo}</TableCell><TableCell>{f.canal}</TableCell><TableCell>{f.destinatario}</TableCell>
                <TableCell><Chip size="small" label={f.estado} color={f.estado === 'enviado' ? 'success' : f.estado === 'error' ? 'error' : 'default'} />{f.error && <Typography variant="caption" display="block" color="error">{f.error}</Typography>}</TableCell>
                <TableCell>{f.intentos}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
