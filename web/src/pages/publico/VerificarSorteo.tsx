import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Alert, Button, Card, CardContent, Container, List, ListItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Cargando, ErrorCaja } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { fechaHora } from '../../lib/formato';
import { descargar } from '../../lib/reportes';
import { verificarSorteo, type ResultadoVerificacion } from '../../lib/sorteo';
import { rpc } from '../../lib/supabase';
import type { SorteoPublico } from '../../lib/tipos';

export default function VerificarSorteo() {
  const { id } = useParams();
  const [s, setS] = useState<SorteoPublico | null>(null);
  const [v, setV] = useState<ResultadoVerificacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await rpc<SorteoPublico>('sorteo_publico', { p_rifa_id: id });
        setS(d);
        const so = d?.sorteo;
        if (so?.estado === 'ejecutado' && so.semilla) {
          setV(await verificarSorteo({
            padron: so.participantes, padronHash: so.padron_hash, semilla: so.semilla, semillaCompromiso: so.semilla_compromiso,
            entropia: so.entropia_externa ?? '', cantidad: so.cantidad_ganadores, permitirRepetidos: so.permitir_repetidos, ganadores: so.ganadores ?? [],
          }));
        }
      } catch (e) { setError(mensajeError(e)); }
    })();
  }, [id]);

  if (error) return <Container sx={{ py: 3 }}><ErrorCaja error={error} /></Container>;
  if (!s) return <Cargando />;
  const so = s.sorteo;
  const Item = ({ ok, t, d }: { ok: boolean; t: string; d: string }) => (
    <ListItem><ListItemIcon>{ok ? <CheckCircleIcon color="success" /> : <CancelIcon color="error" />}</ListItemIcon><ListItemText primary={t} secondary={d} /></ListItem>
  );

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h1" gutterBottom>Verificación del sorteo</Typography>
      <Typography color="text.secondary" gutterBottom>{s.rifa.nombre}</Typography>
      {!so && <Alert severity="info">El padrón aún no se ha congelado.</Alert>}
      {so && so.estado !== 'ejecutado' && (
        <Alert severity="info">
          Padrón congelado el {fechaHora(so.padron_congelado_at)} con {so.total_participantes} números. Compromiso de semilla publicado:
          <code style={{ wordBreak: 'break-all', display: 'block' }}>{so.semilla_compromiso}</code>
          Anote este valor: después del sorteo podrá comprobar que la semilla revelada corresponde a él.
        </Alert>
      )}
      {so && v && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Alert severity={v.padronOk && v.compromisoOk && v.ganadoresOk ? 'success' : 'error'} sx={{ mb: 2 }}>
              {v.padronOk && v.compromisoOk && v.ganadoresOk
                ? 'Su navegador recalculó el sorteo y obtuvo exactamente los mismos ganadores.'
                : 'La verificación no coincide. Informe a la directiva.'}
            </Alert>
            <List>
              <Item ok={v.padronOk} t="El padrón publicado corresponde a su huella SHA-256" d={so.padron_hash} />
              <Item ok={v.compromisoOk} t="La semilla revelada corresponde al compromiso publicado antes del sorteo" d={so.semilla_compromiso} />
              <Item ok={v.ganadoresOk} t="Los ganadores se reproducen con el algoritmo público" d={v.calculados.map((g) => `${g.posicion}°: N° ${g.numero}`).join(' · ')} />
            </List>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
              Algoritmo {so.algoritmo} v{so.version}. Semilla: {so.semilla}. Entropía externa: {so.entropia_externa || '(ninguna)'}.
            </Typography>
            <Button sx={{ mt: 2 }} variant="outlined"
              onClick={() => descargar(new Blob([JSON.stringify({ rifa: s.rifa, sorteo: so }, null, 2)], { type: 'application/json' }), `sorteo-${s.rifa.codigo}.json`)}>
              Descargar datos del sorteo (JSON)
            </Button>
          </CardContent>
        </Card>
      )}
      <Typography variant="h3" sx={{ mt: 4 }}>¿Cómo funciona?</Typography>
      <Typography sx={{ mt: 1 }}>
        1) Al cerrar las ventas se congela el padrón con los números pagados y se publica su huella. 2) El servidor genera una semilla secreta y publica
        sólo su huella (compromiso), para que nadie pueda cambiarla después. 3) En el sorteo se agrega un valor externo anunciado en vivo. 4) Los ganadores se
        calculan con SHA-256 a partir de esos tres datos; la animación en pantalla sólo los muestra. 5) Esta página repite el cálculo en su navegador.
      </Typography>
    </Container>
  );
}
