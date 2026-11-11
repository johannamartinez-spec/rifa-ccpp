import AddIcon from '@mui/icons-material/Add';
import { Button, Card, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cargando, ErrorCaja } from '../../components/comunes';
import { useAuth } from '../../lib/auth';
import { mensajeError } from '../../lib/errores';
import { ESTADO_RIFA } from '../../lib/estados';
import { clp, fecha, numeroCL } from '../../lib/formato';
import { supabase } from '../../lib/supabase';
import type { Rifa } from '../../lib/tipos';

export default function Rifas() {
  const auth = useAuth();
  const nav = useNavigate();
  const [rifas, setRifas] = useState<Rifa[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    supabase.from('rifas').select('*').order('created_at', { ascending: false }).then(({ data, error: e }) => {
      if (e) setError(mensajeError(e)); else setRifas(data as Rifa[]);
    });
  }, []);
  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h1">Rifas</Typography>
        {auth.tiene('rifas.gestionar') && <Button variant="contained" startIcon={<AddIcon />} component={Link} to="/admin/rifas/nueva">Nueva rifa</Button>}
      </Stack>
      <ErrorCaja error={error} />
      {!rifas ? <Cargando /> : (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Código</TableCell><TableCell>Nombre</TableCell><TableCell>Estado</TableCell><TableCell>Precio</TableCell><TableCell>Números</TableCell><TableCell>Sorteo</TableCell></TableRow></TableHead>
            <TableBody>
              {rifas.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => nav(`/admin/rifas/${r.id}`)}>
                  <TableCell>{r.codigo}</TableCell><TableCell>{r.nombre}</TableCell>
                  <TableCell><Chip size="small" label={ESTADO_RIFA[r.estado].etiqueta} color={ESTADO_RIFA[r.estado].color} /></TableCell>
                  <TableCell>{clp(r.precio_numero)}</TableCell>
                  <TableCell>{numeroCL(r.numero_inicial)}–{numeroCL(r.numero_final)}</TableCell>
                  <TableCell>{fecha(r.fecha_sorteo)}</TableCell>
                </TableRow>
              ))}
              {rifas.length === 0 && <TableRow><TableCell colSpan={6}>Aún no hay rifas.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
