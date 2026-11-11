import { Card, CardContent, Grid, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Cargando, ErrorCaja } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { ESTILO_NUMERO } from '../../lib/estados';
import { clp, numeroCL } from '../../lib/formato';
import { rpc, supabase } from '../../lib/supabase';

interface Resumen {
  total_rifas: number; rifas_activas: number;
  numeros: { total: number; disponibles: number; reservados: number; pendientes: number; vendidos: number; bloqueados: number };
  pagos_pendientes: number; comprobantes_por_revisar: number; recaudacion_confirmada: number; recaudacion_pendiente: number;
  ventas_por_dia: { dia: string; monto: number; numeros: number }[];
  ventas_por_curso: { curso: string; monto: number; numeros: number }[];
}

export function useRifasLista() {
  const [rifas, setRifas] = useState<{ id: string; codigo: string; nombre: string; estado: string }[]>([]);
  useEffect(() => { supabase.from('rifas').select('id, codigo, nombre, estado').order('created_at', { ascending: false }).then(({ data }) => setRifas(data ?? [])); }, []);
  return rifas;
}

export function SelectorRifa({ valor, onCambio, todas = true }: { valor: string; onCambio: (v: string) => void; todas?: boolean }) {
  const rifas = useRifasLista();
  return (
    <TextField select label="Rifa" value={valor} onChange={(e) => onCambio(e.target.value)} sx={{ minWidth: 240 }} size="small">
      {todas && <MenuItem value="">Todas las rifas</MenuItem>}
      {rifas.map((r) => <MenuItem key={r.id} value={r.id}>{r.codigo} — {r.nombre}</MenuItem>)}
    </TextField>
  );
}

function Indicador({ t, v, s }: { t: string; v: string; s?: string }) {
  return (
    <Grid item xs={6} md={3}>
      <Card sx={{ height: '100%' }}><CardContent>
        <Typography variant="body2" color="text.secondary">{t}</Typography>
        <Typography variant="h2">{v}</Typography>
        {s && <Typography variant="caption" color="text.secondary">{s}</Typography>}
      </CardContent></Card>
    </Grid>
  );
}

export default function Dashboard() {
  const [rifa, setRifa] = useState('');
  const [d, setD] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = async () => {
    setError(null);
    try { setD(await rpc<Resumen>('dashboard_resumen', { p_rifa_id: rifa || null })); } catch (e) { setError(mensajeError(e)); }
  };
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [rifa]);

  const n = d?.numeros;
  const torta = n ? [
    { k: 'disponible', v: n.disponibles }, { k: 'reservado', v: n.reservados }, { k: 'pendiente_pago', v: n.pendientes },
    { k: 'vendido', v: n.vendidos }, { k: 'bloqueado', v: n.bloqueados },
  ].filter((x) => x.v > 0) : [];
  const avance = n && n.total ? (100 * n.vendidos) / n.total : 0;

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} sx={{ mb: 2 }}>
        <Typography variant="h1">Resumen</Typography>
        <SelectorRifa valor={rifa} onCambio={setRifa} />
      </Stack>
      <ErrorCaja error={error} onReintentar={cargar} />
      {!d ? <Cargando /> : (
        <>
          <Grid container spacing={2}>
            <Indicador t="Recaudación confirmada" v={clp(d.recaudacion_confirmada)} s="Sólo pagos aprobados" />
            <Indicador t="Recaudación pendiente" v={clp(d.recaudacion_pendiente)} s="Reservas sin validar" />
            <Indicador t="Comprobantes por revisar" v={numeroCL(d.comprobantes_por_revisar)} />
            <Indicador t="Pagos pendientes" v={numeroCL(d.pagos_pendientes)} s="Reservas esperando transferencia" />
            <Indicador t="Rifas" v={`${d.rifas_activas} / ${d.total_rifas}`} s="activas / total" />
            <Indicador t="Números vendidos" v={numeroCL(n!.vendidos)} s={`de ${numeroCL(n!.total)}`} />
            <Indicador t="Números disponibles" v={numeroCL(n!.disponibles)} />
            <Indicador t="Reservados / en revisión" v={`${numeroCL(n!.reservados)} / ${numeroCL(n!.pendientes)}`} />
          </Grid>
          <Card sx={{ mt: 2 }}><CardContent>
            <Typography fontWeight={800}>Avance de venta: {avance.toFixed(1)}%</Typography>
            <LinearProgress variant="determinate" value={avance} color="secondary" sx={{ height: 12, borderRadius: 6, mt: 1 }} />
          </CardContent></Card>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12} md={4}>
              <Card sx={{ height: 320 }}><CardContent sx={{ height: '100%' }}>
                <Typography fontWeight={800}>Estado de los números</Typography>
                <ResponsiveContainer width="100%" height="85%">
                  <PieChart>
                    <Pie data={torta} dataKey="v" nameKey="k" innerRadius={50} outerRadius={90} label={(x) => ESTILO_NUMERO[x.k as keyof typeof ESTILO_NUMERO].etiqueta}>
                      {torta.map((x) => <Cell key={x.k} fill={x.k === 'disponible' ? '#cfe3d6' : ESTILO_NUMERO[x.k as keyof typeof ESTILO_NUMERO].fondo} stroke="#7fa08a" />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => numeroCL(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent></Card>
            </Grid>
            <Grid item xs={12} md={8}>
              <Card sx={{ height: 320 }}><CardContent sx={{ height: '100%' }}>
                <Typography fontWeight={800}>Recaudación confirmada por día (últimos 60 días)</Typography>
                <ResponsiveContainer width="100%" height="85%">
                  <BarChart data={d.ventas_por_dia}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="dia" fontSize={11} /><YAxis tickFormatter={(v) => clp(v)} width={90} fontSize={11} />
                    <Tooltip formatter={(v: number) => clp(v)} /><Bar dataKey="monto" fill="#1b5e3b" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent></Card>
            </Grid>
            <Grid item xs={12}>
              <Card sx={{ height: 340 }}><CardContent sx={{ height: '100%' }}>
                <Typography fontWeight={800}>Recaudación confirmada por curso</Typography>
                <ResponsiveContainer width="100%" height="85%">
                  <BarChart data={d.ventas_por_curso}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="curso" fontSize={11} /><YAxis tickFormatter={(v) => clp(v)} width={90} fontSize={11} />
                    <Tooltip formatter={(v: number) => clp(v)} /><Bar dataKey="monto" fill="#c9a227" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent></Card>
            </Grid>
          </Grid>
        </>
      )}
    </>
  );
}
