import EventIcon from '@mui/icons-material/Event';
import { Box, Button, Card, CardActionArea, CardContent, CardMedia, Chip, Container, Grid, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cargando, ErrorCaja } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { ESTADO_RIFA } from '../../lib/estados';
import { clp, fechaLarga, urlPublica } from '../../lib/formato';
import { supabase } from '../../lib/supabase';
import type { Rifa } from '../../lib/tipos';

export default function Inicio() {
  const [rifas, setRifas] = useState<Rifa[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    setError(null);
    const { data, error: e } = await supabase.from('rifas').select('*').neq('estado', 'borrador').order('fecha_sorteo', { ascending: false });
    if (e) setError(mensajeError(e));
    else setRifas(data as Rifa[]);
  };
  useEffect(() => { void cargar(); }, []);

  const activas = rifas?.filter((r) => r.estado === 'activa') ?? [];
  const otras = rifas?.filter((r) => r.estado !== 'activa') ?? [];

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h1" gutterBottom>Rifas solidarias</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Elige tus números desde el celular, transfiere y envía tu comprobante. No necesitas crear una cuenta.
      </Typography>
      <ErrorCaja error={error} onReintentar={cargar} />
      {!rifas && !error && <Cargando />}
      {rifas && activas.length === 0 && <Typography sx={{ mb: 3 }}>En este momento no hay rifas con venta abierta.</Typography>}
      <Grid container spacing={2}>
        {activas.map((r) => <Grid item xs={12} key={r.id}><TarjetaRifa r={r} destacada /></Grid>)}
      </Grid>
      {otras.length > 0 && (
        <>
          <Typography variant="h3" sx={{ mt: 4, mb: 2 }}>Rifas anteriores y cerradas</Typography>
          <Grid container spacing={2}>
            {otras.map((r) => <Grid item xs={12} sm={6} key={r.id}><TarjetaRifa r={r} /></Grid>)}
          </Grid>
        </>
      )}
    </Container>
  );
}

function TarjetaRifa({ r, destacada = false }: { r: Rifa; destacada?: boolean }) {
  const e = ESTADO_RIFA[r.estado];
  return (
    <Card>
      <CardActionArea component={Link} to={`/rifa/${r.id}`}>
        {r.afiche_path && <CardMedia component="img" image={urlPublica(r.afiche_path)} alt={`Afiche de ${r.nombre}`} sx={{ maxHeight: destacada ? 280 : 160, objectFit: 'cover' }} loading="lazy" />}
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
            <Typography variant={destacada ? 'h2' : 'h3'}>{r.nombre}</Typography>
            <Chip label={e.etiqueta} color={e.color} size="small" />
          </Stack>
          <Stack direction="row" gap={1} alignItems="center" sx={{ mt: 1, color: 'text.secondary' }}>
            <EventIcon fontSize="small" /> <Typography variant="body2">Sorteo: {fechaLarga(r.fecha_sorteo)}</Typography>
          </Stack>
          <Typography sx={{ mt: 1 }}><b>{clp(r.precio_numero)}</b> por número</Typography>
          {destacada && (
            <Box sx={{ mt: 2 }}>
              <Button variant="contained" color="secondary" size="large" component="span">Elegir mis números</Button>
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
