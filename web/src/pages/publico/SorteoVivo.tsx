import FullscreenIcon from '@mui/icons-material/Fullscreen';
import { Box, Button, Chip, Container, Grid, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { Link as RLink, useParams } from 'react-router-dom';
import { Cargando, ErrorCaja } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { fechaLarga } from '../../lib/formato';
import { rpc } from '../../lib/supabase';
import type { SorteoPublico } from '../../lib/tipos';
import { DORADO, VERDE } from '../../theme';

/**
 * Pantalla para transmitir el sorteo en vivo. La animación es SÓLO visual:
 * los ganadores ya fueron calculados por el servidor y se revelan uno a uno.
 */
export default function SorteoVivo() {
  const { id } = useParams();
  const [s, setS] = useState<SorteoPublico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revelados, setRevelados] = useState(0);
  const [girando, setGirando] = useState<number | null>(null);
  const animando = useRef(false);
  const yaVisto = useRef<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const d = await rpc<SorteoPublico>('sorteo_publico', { p_rifa_id: id });
        if (!vivo) return;
        if (!d) { setError('Sorteo no disponible.'); return; }
        setS(d);
        if (yaVisto.current === null) {
          // si al abrir la página el sorteo ya estaba ejecutado, se muestran todos sin animación
          yaVisto.current = d.sorteo?.estado === 'ejecutado';
          if (yaVisto.current) setRevelados(d.sorteo?.ganadores?.length ?? 0);
        }
      } catch (e) { if (vivo) setError(mensajeError(e)); }
    };
    void cargar();
    const t = window.setInterval(cargar, 4000);
    return () => { vivo = false; window.clearInterval(t); };
  }, [id]);

  const ganadores = s?.sorteo?.ganadores ?? [];
  const participantes = s?.sorteo?.participantes ?? [];

  useEffect(() => {
    if (animando.current || revelados >= ganadores.length || participantes.length === 0) return;
    animando.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duracion = reduce ? 300 : 4500;
    const inicio = Date.now();
    const objetivo = ganadores[revelados].numero;
    const paso = () => {
      const t = Date.now() - inicio;
      if (t >= duracion) {
        setGirando(null);
        setRevelados((r) => r + 1);
        animando.current = false;
        return;
      }
      // desacelera hacia el final; el último cuadro siempre muestra el ganador ya calculado
      const progreso = t / duracion;
      setGirando(progreso > 0.92 ? objetivo : participantes[Math.floor(Math.random() * participantes.length)]);
      window.setTimeout(paso, 40 + progreso * progreso * 260);
    };
    const espera = window.setTimeout(paso, revelados === 0 ? 1200 : 2500);
    return () => window.clearTimeout(espera);
  }, [ganadores, revelados, participantes]);

  if (error) return <Container sx={{ py: 4 }}><ErrorCaja error={error} /></Container>;
  if (!s) return <Cargando />;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: VERDE, color: '#fff', py: 3 }}>
      <Container maxWidth="lg">
        <Stack direction="row" alignItems="center" gap={2}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ opacity: 0.85 }}>{s.rifa.centro_padres} · {s.rifa.colegio}</Typography>
            <Typography variant="h1" sx={{ fontSize: { xs: '1.8rem', md: '3rem' } }}>{s.rifa.nombre}</Typography>
            <Typography sx={{ opacity: 0.85 }}>{fechaLarga(s.sorteo?.ejecutado_at ?? s.rifa.fecha_sorteo)}</Typography>
          </Box>
          <Button color="inherit" startIcon={<FullscreenIcon />} onClick={() => document.documentElement.requestFullscreen?.()} sx={{ display: { xs: 'none', md: 'inline-flex' } }}>Pantalla completa</Button>
        </Stack>

        {!s.sorteo && <Typography variant="h2" sx={{ mt: 6, textAlign: 'center' }}>El padrón de participantes aún no ha sido cerrado.</Typography>}

        {s.sorteo && (
          <>
            <Box sx={{ my: 4, textAlign: 'center' }}>
              <Typography sx={{ opacity: 0.9 }}>{s.sorteo.total_participantes} números participantes (sólo pagados y confirmados)</Typography>
              <Box aria-live="polite" sx={{ fontSize: { xs: 96, md: 180 }, fontWeight: 900, color: DORADO, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', minHeight: { xs: 110, md: 200 } }}>
                {girando ?? (revelados > 0 ? ganadores[revelados - 1].numero : '—')}
              </Box>
              {s.sorteo.estado !== 'ejecutado' && <Chip label="Esperando la ejecución del sorteo…" sx={{ bgcolor: '#fff', color: VERDE, fontSize: 18, p: 2 }} />}
            </Box>

            <Grid container spacing={2}>
              {s.premios.map((p) => {
                const g = ganadores.find((x) => x.posicion === p.posicion);
                const visible = g && g.posicion <= revelados;
                return (
                  <Grid item xs={12} sm={6} md={4} key={p.posicion}>
                    <Box sx={{ bgcolor: visible ? DORADO : 'rgba(255,255,255,.1)', color: visible ? '#1d2b22' : '#fff', borderRadius: 3, p: 2, transition: 'background .5s' }}>
                      <Typography fontWeight={800}>{p.posicion}° premio</Typography>
                      <Typography>{p.nombre}</Typography>
                      <Typography sx={{ fontSize: 40, fontWeight: 900 }}>{visible ? `N° ${g!.numero}` : '¿?'}</Typography>
                    </Box>
                  </Grid>
                );
              })}
            </Grid>

            <Box sx={{ mt: 4, fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }}>
              <div>Algoritmo {s.sorteo.algoritmo} v{s.sorteo.version} · Padrón SHA-256: {s.sorteo.padron_hash}</div>
              <div>Compromiso de semilla (publicado antes del sorteo): {s.sorteo.semilla_compromiso}</div>
              {s.sorteo.entropia_externa && <div>Entropía externa: {s.sorteo.entropia_externa}</div>}
              <Button component={RLink} to={`/sorteo/${s.rifa.id}/verificar`} color="inherit" variant="outlined" size="small" sx={{ mt: 1 }}>Verificar el sorteo</Button>
            </Box>
          </>
        )}
      </Container>
    </Box>
  );
}
