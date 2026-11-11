import { Box, Chip, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { memo, useMemo, useState } from 'react';
import { ESTILO_NUMERO, type EstadoNumero, type EstadoVisual } from '../lib/estados';

interface Props {
  numeros: Map<number, EstadoNumero>;
  seleccion: Set<number>;
  onAlternar: (n: number) => void;
  deshabilitado?: boolean;
  maxSeleccion: number;
}

const BLOQUE = 100;

const Celda = memo(function Celda({ n, estado, onClick, deshabilitado }: { n: number; estado: EstadoVisual; onClick: (n: number) => void; deshabilitado: boolean }) {
  const e = ESTILO_NUMERO[estado];
  const seleccionable = (estado === 'disponible' || estado === 'seleccionado') && !deshabilitado;
  return (
    <button
      type="button"
      data-numero={n}
      data-estado={estado}
      aria-pressed={estado === 'seleccionado'}
      aria-label={`Número ${n}: ${e.etiqueta}`}
      disabled={!seleccionable}
      onClick={() => onClick(n)}
      style={{
        minHeight: 46,
        borderRadius: 10,
        border: `2px solid ${e.borde}`,
        background: e.fondo,
        color: e.texto,
        fontWeight: 800,
        fontSize: 16,
        cursor: seleccionable ? 'pointer' : 'not-allowed',
        opacity: seleccionable || estado === 'vendido' ? 1 : 0.85,
        textDecoration: estado === 'bloqueado' ? 'line-through' : 'none',
        transition: 'transform .08s',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {n}
    </button>
  );
});

export function Leyenda() {
  return (
    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ my: 1 }} aria-label="Leyenda de colores">
      {(Object.keys(ESTILO_NUMERO) as EstadoVisual[]).map((k) => (
        <Chip
          key={k}
          size="small"
          label={ESTILO_NUMERO[k].etiqueta}
          sx={{ bgcolor: ESTILO_NUMERO[k].fondo, color: ESTILO_NUMERO[k].texto, border: `2px solid ${ESTILO_NUMERO[k].borde}` }}
        />
      ))}
    </Stack>
  );
}

export function NumberGrid({ numeros, seleccion, onAlternar, deshabilitado = false, maxSeleccion }: Props) {
  const lista = useMemo(() => [...numeros.keys()].sort((a, b) => a - b), [numeros]);
  const bloques = useMemo(() => {
    const b: { desde: number; hasta: number }[] = [];
    for (let i = 0; i < lista.length; i += BLOQUE) b.push({ desde: lista[i], hasta: lista[Math.min(i + BLOQUE, lista.length) - 1] });
    return b;
  }, [lista]);
  const [bloque, setBloque] = useState(0);
  const [soloDisponibles, setSoloDisponibles] = useState(false);
  const [buscar, setBuscar] = useState('');

  const disponibles = useMemo(() => lista.filter((n) => numeros.get(n) === 'disponible').length, [lista, numeros]);
  const visibles = useMemo(() => {
    let l = lista;
    if (buscar.trim()) {
      const q = Number(buscar);
      return Number.isFinite(q) ? l.filter((n) => String(n).includes(buscar.trim())).slice(0, 100) : [];
    }
    if (bloques.length > 2) l = l.slice(bloque * BLOQUE, (bloque + 1) * BLOQUE);
    if (soloDisponibles) l = l.filter((n) => numeros.get(n) === 'disponible' || seleccion.has(n));
    return l;
  }, [lista, bloques.length, bloque, soloDisponibles, numeros, seleccion, buscar]);

  const alternar = (n: number) => {
    if (!seleccion.has(n) && seleccion.size >= maxSeleccion) return;
    onAlternar(n);
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
        <TextField
          size="small"
          label="Buscar número"
          inputMode="numeric"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value.replace(/\D/g, ''))}
          sx={{ maxWidth: { sm: 180 } }}
        />
        <ToggleButtonGroup size="small" exclusive value={soloDisponibles ? 'd' : 't'} onChange={(_, v) => v && setSoloDisponibles(v === 'd')}>
          <ToggleButton value="t">Todos</ToggleButton>
          <ToggleButton value="d">Sólo disponibles ({disponibles})</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {bloques.length > 2 && !buscar && (
        <Stack direction="row" gap={0.75} sx={{ overflowX: 'auto', pb: 1, mb: 1 }} role="tablist" aria-label="Bloques de números">
          {bloques.map((b, i) => (
            <Chip key={i} role="tab" aria-selected={i === bloque} label={`${b.desde}–${b.hasta}`} color={i === bloque ? 'primary' : 'default'}
              onClick={() => setBloque(i)} variant={i === bloque ? 'filled' : 'outlined'} />
          ))}
        </Stack>
      )}

      <Box
        role="group"
        aria-label="Números de la rifa"
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 0.75 }}
      >
        {visibles.map((n) => (
          <Celda key={n} n={n} estado={seleccion.has(n) ? 'seleccionado' : (numeros.get(n) ?? 'bloqueado')} onClick={alternar} deshabilitado={deshabilitado} />
        ))}
      </Box>
      {visibles.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No hay números para mostrar.</Typography>}
      {seleccion.size >= maxSeleccion && (
        <Typography color="warning.main" sx={{ mt: 1 }} role="status">Alcanzó el máximo de {maxSeleccion} números por reserva.</Typography>
      )}
    </Box>
  );
}
