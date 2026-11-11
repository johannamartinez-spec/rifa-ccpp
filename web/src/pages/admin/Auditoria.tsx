import { Box, Button, Card, Collapse, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Cargando, ErrorCaja } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { fechaHora } from '../../lib/formato';
import { supabase } from '../../lib/supabase';

interface Registro { id: number; fecha: string; usuario_email: string | null; actor: string; tabla: string; registro_id: string | null; operacion: string; datos_anteriores: any; datos_nuevos: any }
const TABLAS = ['', 'rifas', 'premios', 'reservas', 'pagos', 'comprobantes', 'compradores', 'sorteos', 'ganadores', 'entrega_premios', 'usuarios', 'rol_permisos', 'configuraciones', 'reportes', 'documentos', 'integraciones'];

function diferencias(a: any, b: any): string[] {
  if (!a || !b) return [];
  return Object.keys(b).filter((k) => k !== 'updated_at' && JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
}

/** Bitácora inmutable: sólo lectura. */
export default function Auditoria() {
  const [tabla, setTabla] = useState('');
  const [registro, setRegistro] = useState('');
  const [desde, setDesde] = useState('');
  const [filas, setFilas] = useState<Registro[] | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);

  const cargar = useCallback(async () => {
    let q = supabase.from('auditoria').select('*').order('id', { ascending: false }).range(pagina * 100, pagina * 100 + 99);
    if (tabla) q = q.eq('tabla', tabla);
    if (registro.trim()) q = q.eq('registro_id', registro.trim());
    if (desde) q = q.gte('fecha', new Date(`${desde}T00:00:00`).toISOString());
    const { data, error: e } = await q;
    if (e) setError(mensajeError(e)); else setFilas(data as Registro[]);
  }, [tabla, registro, desde, pagina]);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <>
      <Typography variant="h1" gutterBottom>Bitácora de auditoría</Typography>
      <Typography color="text.secondary" gutterBottom>Registro inmutable de toda operación: quién, qué, cuándo, valores anteriores y nuevos. Nadie puede modificarlo ni borrarlo desde la aplicación.</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} sx={{ my: 2 }}>
        <TextField select size="small" label="Tabla" value={tabla} onChange={(e) => { setTabla(e.target.value); setPagina(0); }} sx={{ minWidth: 200 }}>
          {TABLAS.map((t) => <MenuItem key={t} value={t}>{t || 'Todas'}</MenuItem>)}
        </TextField>
        <TextField size="small" label="ID de registro" value={registro} onChange={(e) => setRegistro(e.target.value)} />
        <TextField size="small" type="date" label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} InputLabelProps={{ shrink: true }} />
      </Stack>
      <ErrorCaja error={error} />
      {!filas ? <Cargando /> : (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Fecha</TableCell><TableCell>Usuario</TableCell><TableCell>Operación</TableCell><TableCell>Tabla</TableCell><TableCell>Registro</TableCell><TableCell>Cambios</TableCell></TableRow></TableHead>
            <TableBody>
              {filas.map((f) => {
                const dif = diferencias(f.datos_anteriores, f.datos_nuevos);
                return (
                  <Fragment key={f.id}>
                    <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setAbierto(abierto === f.id ? null : f.id)}>
                      <TableCell>{fechaHora(f.fecha)}</TableCell><TableCell>{f.usuario_email ?? f.actor}</TableCell><TableCell>{f.operacion}</TableCell>
                      <TableCell>{f.tabla}</TableCell><TableCell sx={{ fontSize: 12 }}>{f.registro_id}</TableCell>
                      <TableCell sx={{ fontSize: 12, maxWidth: 360 }}>{dif.slice(0, 2).join(' · ')}{dif.length > 2 && ' …'}</TableCell>
                    </TableRow>
                    <TableRow><TableCell colSpan={6} sx={{ p: 0, border: 0 }}>
                      <Collapse in={abierto === f.id} unmountOnExit>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { md: '1fr 1fr' }, gap: 2, p: 2, bgcolor: '#fafafa', fontSize: 12 }}>
                          <div><b>Anterior</b><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(f.datos_anteriores, null, 2)}</pre></div>
                          <div><b>Nuevo</b><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(f.datos_nuevos, null, 2)}</pre></div>
                        </Box>
                      </Collapse>
                    </TableCell></TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Stack direction="row" gap={1} sx={{ mt: 2 }}>
        <Button disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anteriores</Button>
        <Button disabled={(filas?.length ?? 0) < 100} onClick={() => setPagina(pagina + 1)}>Siguientes</Button>
      </Stack>
    </>
  );
}
