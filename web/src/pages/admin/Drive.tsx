import { Alert, Button, Card, CardContent, Chip, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Cargando, Confirmar, ErrorCaja, useAviso } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { fechaHora } from '../../lib/formato';
import { llamarFuncion, rpc, supabase } from '../../lib/supabase';

interface EstadoDrive { conectado: boolean; cuenta_email: string | null; conectado_at: string | null; cuenta_institucional_esperada: string | null; pendientes: number; errores: number; subidos: number; ultimo_respaldo_at: string | null }
interface Respaldo { id: number; tipo_evidencia: string; codigo_reserva: string | null; nombre_archivo: string; carpeta_drive: string; estado: string; intentos: number; error: string | null; created_at: string; subido_at: string | null }

export default function Drive() {
  const avisar = useAviso();
  const [params] = useSearchParams();
  const [e, setE] = useState<EstadoDrive | null>(null);
  const [filas, setFilas] = useState<Respaldo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [desconectar, setDesconectar] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setE(await rpc<EstadoDrive>('estado_drive'));
      const { data } = await supabase.from('respaldos_drive').select('*').order('id', { ascending: false }).limit(100);
      setFilas((data ?? []) as Respaldo[]);
    } catch (er) { setError(mensajeError(er)); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const conectar = async () => {
    try { const r = await llamarFuncion<{ url: string }>('drive-oauth', { accion: 'iniciar' }); window.location.href = r.url; }
    catch (er) { avisar(mensajeError(er), 'error'); }
  };
  const sincronizar = async () => {
    setTrabajando(true);
    try {
      const r = await llamarFuncion<{ conectado: boolean; subidos?: number; errores?: number; mensaje?: string }>('drive-sync', {});
      avisar(r.conectado ? `Respaldo ejecutado: ${r.subidos ?? 0} subidos, ${r.errores ?? 0} con error` : r.mensaje ?? 'Drive no conectado', r.conectado ? 'success' : 'info');
      void cargar();
    } catch (er) { avisar(mensajeError(er), 'error'); } finally { setTrabajando(false); }
  };

  if (!e) return error ? <ErrorCaja error={error} /> : <Cargando />;
  const resultado = params.get('drive');
  return (
    <>
      <Typography variant="h1" gutterBottom>Respaldo en Google Drive</Typography>
      {resultado === 'ok' && <Alert severity="success" sx={{ mb: 2 }}>Drive conectado correctamente con {params.get('detalle')}.</Alert>}
      {resultado === 'error' && <Alert severity="error" sx={{ mb: 2 }}>{params.get('detalle')}</Alert>}
      {resultado === 'cancelado' && <Alert severity="info" sx={{ mb: 2 }}>Conexión cancelada.</Alert>}
      <Card><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
          <div>
            <Typography>Estado: <Chip label={e.conectado ? 'Conectado' : 'No conectado'} color={e.conectado ? 'success' : 'warning'} size="small" /></Typography>
            <Typography sx={{ mt: 1 }}>Cuenta conectada: <b>{e.cuenta_email ?? '—'}</b> {e.conectado_at && `(desde ${fechaHora(e.conectado_at)})`}</Typography>
            <Typography>Cuenta institucional configurada: <b>{e.cuenta_institucional_esperada ?? 'sin configurar (vea Configuración)'}</b></Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Sólo se acepta la cuenta institucional de Tesorería, para que los respaldos no queden en la cuenta personal de una integrante. La app sólo puede ver los archivos que ella misma crea (permiso drive.file).
            </Typography>
          </div>
          <Stack gap={1} sx={{ minWidth: 220 }}>
            {!e.conectado && <Button variant="contained" onClick={conectar} disabled={!e.cuenta_institucional_esperada}>Conectar Google Drive</Button>}
            {e.conectado && <Button variant="contained" onClick={sincronizar} disabled={trabajando}>{trabajando ? 'Respaldando…' : 'Respaldar ahora'}</Button>}
            {e.errores > 0 && <Button onClick={async () => { await rpc('reintentar_respaldos'); void cargar(); }}>Reintentar con error ({e.errores})</Button>}
            {e.conectado && <Button color="error" onClick={() => setDesconectar(true)}>Desconectar</Button>}
          </Stack>
        </Stack>
      </CardContent></Card>
      <Grid container spacing={2} sx={{ my: 1 }}>
        {[['Pendientes', e.pendientes], ['Respaldados', e.subidos], ['Con error', e.errores]].map(([t, v]) => (
          <Grid item xs={4} key={t}><Card><CardContent><Typography variant="body2">{t}</Typography><Typography variant="h2">{v}</Typography></CardContent></Card></Grid>
        ))}
      </Grid>
      {!e.conectado && <Alert severity="info" sx={{ mb: 2 }}>Mientras Drive no esté conectado, la aplicación funciona normalmente y los archivos quedan pendientes de respaldo.</Alert>}
      <Typography variant="body2" color="text.secondary" gutterBottom>Último respaldo: {fechaHora(e.ultimo_respaldo_at)}</Typography>
      <TableContainer component={Card}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Tipo</TableCell><TableCell>Archivo</TableCell><TableCell>Carpeta</TableCell><TableCell>Estado</TableCell><TableCell>Intentos</TableCell><TableCell>Fecha</TableCell></TableRow></TableHead>
          <TableBody>
            {filas.map((f) => (
              <TableRow key={f.id}>
                <TableCell>{f.tipo_evidencia}</TableCell><TableCell sx={{ wordBreak: 'break-all' }}>{f.nombre_archivo}</TableCell><TableCell sx={{ fontSize: 12 }}>{f.carpeta_drive}</TableCell>
                <TableCell><Chip size="small" label={f.estado} color={f.estado === 'enviado' ? 'success' : f.estado === 'error' ? 'error' : 'default'} />{f.error && <Typography variant="caption" display="block" color="error">{f.error}</Typography>}</TableCell>
                <TableCell>{f.intentos}</TableCell><TableCell>{fechaHora(f.subido_at ?? f.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Confirmar abierto={desconectar} titulo="Desconectar Google Drive" peligro mensaje="Se revocará el acceso. Los nuevos archivos quedarán pendientes hasta volver a conectar."
        onCancelar={() => setDesconectar(false)} onConfirmar={async () => { await llamarFuncion('drive-oauth', { accion: 'desconectar' }); setDesconectar(false); void cargar(); }} />
    </>
  );
}
