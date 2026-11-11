import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, FormControlLabel, Grid, IconButton, Stack, TextField, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Cargando, Confirmar, ErrorCaja, useAviso } from '../../components/comunes';
import { Leyenda } from '../../components/NumberGrid';
import { useNumeros } from '../../hooks/useNumeros';
import { useAuth } from '../../lib/auth';
import { mensajeError } from '../../lib/errores';
import { ESTADO_RIFA, ESTILO_NUMERO } from '../../lib/estados';
import { parsearListaNumeros, urlPublica } from '../../lib/formato';
import { rpc, supabase } from '../../lib/supabase';
import type { Premio, Rifa } from '../../lib/tipos';

const BASE: Partial<Rifa> = {
  nombre: '', colegio: '', centro_padres: '', descripcion: '', objetivo: '', precio_numero: 1000, numero_inicial: 1, numero_final: 300,
  fecha_sorteo: null, cierre_ventas_at: null, bases: '', info_pago: '', contacto: '', minutos_reserva: 30, max_numeros_reserva: 20,
  max_reservas_activas_telefono: 3, pedir_rut: false,
};
const CAMPOS_EDITABLES = Object.keys(BASE) as (keyof Rifa)[];

const aLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

async function subirImagen(rifaId: string, carpeta: 'afiche' | 'premios', f: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) throw new Error('Use una imagen JPG, PNG o WebP');
  if (f.size > 5 * 1024 * 1024) throw new Error('La imagen supera 5 MB');
  const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
  const ruta = `${rifaId}/${carpeta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('rifas-publico').upload(ruta, f, { contentType: f.type, upsert: false });
  if (error) throw error;
  return ruta;
}

export default function RifaEditor() {
  const { id } = useParams();
  const nueva = id === 'nueva';
  const auth = useAuth();
  const puede = auth.tiene('rifas.gestionar');
  const nav = useNavigate();
  const avisar = useAviso();
  const [r, setR] = useState<Partial<Rifa> | null>(nueva ? BASE : null);
  const [premios, setPremios] = useState<Premio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [accion, setAccion] = useState<null | { estado: string; titulo: string; msg: string }>(null);

  const cargar = async () => {
    if (nueva) return;
    const [{ data, error: e }, { data: p }] = await Promise.all([
      supabase.from('rifas').select('*').eq('id', id).single(),
      supabase.from('premios').select('*').eq('rifa_id', id).order('posicion'),
    ]);
    if (e) setError(mensajeError(e)); else { setR(data); setPremios((p ?? []) as Premio[]); }
  };
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  useEffect(() => {
    if (!nueva) return;
    supabase.from('configuraciones').select('clave, valor').in('clave', ['institucion.colegio', 'institucion.centro_padres', 'institucion.contacto']).then(({ data }) => {
      const c = Object.fromEntries((data ?? []).map((x) => [x.clave, String(x.valor)]));
      setR((v) => ({ ...v, colegio: c['institucion.colegio'] ?? '', centro_padres: c['institucion.centro_padres'] ?? '', contacto: c['institucion.contacto'] ?? '' }));
    });
  }, [nueva]);

  if (!r) return error ? <ErrorCaja error={error} /> : <Cargando />;
  const bloqueadoPorVenta = !!r.venta_iniciada;
  const sorteada = r.estado === 'sorteada';
  const set = (k: keyof Rifa, num = false) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setR((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : num ? Number(e.target.value) : e.target.value }));

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      const datos: Record<string, unknown> = {};
      for (const k of CAMPOS_EDITABLES) datos[k] = (r as Record<string, unknown>)[k] ?? null;
      for (const k of ['fecha_sorteo', 'cierre_ventas_at']) datos[k] = datos[k] ? new Date(String(datos[k])).toISOString() : null;
      if (nueva) {
        const { data, error: e } = await supabase.from('rifas').insert(datos).select('id').single();
        if (e) throw e;
        avisar('Rifa creada como borrador');
        nav(`/admin/rifas/${data.id}`, { replace: true });
      } else {
        const { error: e } = await supabase.from('rifas').update(datos).eq('id', id);
        if (e) throw e;
        avisar('Cambios guardados');
        await cargar();
      }
    } catch (e) { setError(mensajeError(e)); } finally { setGuardando(false); }
  };

  const cambiarEstado = async (estado: string) => {
    if (estado === 'cerrada') await rpc('cerrar_ventas', { p_rifa_id: id });
    else { const { error: e } = await supabase.from('rifas').update({ estado }).eq('id', id); if (e) throw new Error(mensajeError(e)); }
    setAccion(null); avisar('Estado actualizado'); await cargar();
  };

  const subirAfiche = async (f?: File) => {
    if (!f || nueva) return;
    try {
      const ruta = await subirImagen(id!, 'afiche', f);
      const { error: e } = await supabase.from('rifas').update({ afiche_path: ruta }).eq('id', id);
      if (e) throw e;
      setR((v) => ({ ...v, afiche_path: ruta })); avisar('Afiche actualizado');
    } catch (e) { avisar(mensajeError(e), 'error'); }
  };

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h1">{nueva ? 'Nueva rifa' : `${r.codigo} — ${r.nombre}`}</Typography>
          {!nueva && <Chip label={ESTADO_RIFA[r.estado!].etiqueta} color={ESTADO_RIFA[r.estado!].color} sx={{ mt: 1 }} />}
        </Box>
        {!nueva && (
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button component={Link} to={`/rifa/${id}`} target="_blank" startIcon={<OpenInNewIcon />}>Ver página pública</Button>
            {puede && r.estado === 'borrador' && <Button variant="contained" color="secondary" onClick={() => setAccion({ estado: 'activa', titulo: 'Publicar y abrir la venta', msg: 'La rifa será visible para todos y se podrán reservar números. Después de la primera venta no se podrá cambiar el precio ni reducir el rango.' })}>Publicar</Button>}
            {puede && r.estado === 'activa' && <Button variant="outlined" onClick={() => setAccion({ estado: 'pausada', titulo: 'Pausar la venta', msg: 'Nadie podrá reservar mientras esté pausada. Las reservas existentes siguen vigentes.' })}>Pausar</Button>}
            {puede && (r.estado === 'pausada' || r.estado === 'cerrada') && <Button variant="outlined" onClick={() => setAccion({ estado: 'activa', titulo: 'Reanudar la venta', msg: 'Se podrá volver a reservar números.' })}>Reanudar venta</Button>}
            {puede && (r.estado === 'activa' || r.estado === 'pausada') && <Button variant="contained" color="error" onClick={() => setAccion({ estado: 'cerrada', titulo: 'Cerrar ventas', msg: 'No se aceptarán nuevas reservas. Luego podrá generar el padrón del sorteo.' })}>Cerrar ventas</Button>}
          </Stack>
        )}
      </Stack>
      {bloqueadoPorVenta && !sorteada && <Alert severity="info" sx={{ mb: 2 }}>La venta ya comenzó: el precio y el número inicial quedan bloqueados; el número final sólo puede ampliarse.</Alert>}
      {sorteada && <Alert severity="info" sx={{ mb: 2 }}>Rifa sorteada: sólo se pueden editar descripción, afiche y contacto.</Alert>}
      <ErrorCaja error={error} />

      <Card><CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><TextField label="Nombre de la rifa" value={r.nombre} onChange={set('nombre')} disabled={!puede || sorteada} required /></Grid>
          <Grid item xs={12} md={3}><TextField label="Colegio" value={r.colegio} onChange={set('colegio')} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={12} md={3}><TextField label="Centro de Padres" value={r.centro_padres} onChange={set('centro_padres')} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={12} md={6}><TextField label="Descripción" value={r.descripcion ?? ''} onChange={set('descripcion')} multiline minRows={3} disabled={!puede} /></Grid>
          <Grid item xs={12} md={6}><TextField label="Objetivo de la campaña" value={r.objetivo ?? ''} onChange={set('objetivo')} multiline minRows={3} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={6} md={3}><TextField label="Valor por número (CLP)" type="number" value={r.precio_numero} onChange={set('precio_numero', true)} disabled={!puede || bloqueadoPorVenta} inputProps={{ min: 100, step: 100 }} /></Grid>
          <Grid item xs={6} md={3}><TextField label="Número inicial" type="number" value={r.numero_inicial} onChange={set('numero_inicial', true)} disabled={!puede || bloqueadoPorVenta} /></Grid>
          <Grid item xs={6} md={3}><TextField label="Número final" type="number" value={r.numero_final} onChange={set('numero_final', true)} disabled={!puede || sorteada} helperText="Máximo 10.000 números" /></Grid>
          <Grid item xs={6} md={3}><TextField label="Minutos para pagar" type="number" value={r.minutos_reserva} onChange={set('minutos_reserva', true)} disabled={!puede || sorteada} helperText="Sugerido: 30" /></Grid>
          <Grid item xs={12} md={4}><TextField label="Fecha y hora del sorteo" type="datetime-local" value={aLocal(r.fecha_sorteo)} onChange={set('fecha_sorteo')} InputLabelProps={{ shrink: true }} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={12} md={4}><TextField label="Cierre automático de ventas (opcional)" type="datetime-local" value={aLocal(r.cierre_ventas_at)} onChange={set('cierre_ventas_at')} InputLabelProps={{ shrink: true }} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={6} md={2}><TextField label="Máx. números por reserva" type="number" value={r.max_numeros_reserva} onChange={set('max_numeros_reserva', true)} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={6} md={2}><TextField label="Máx. reservas sin pagar por teléfono" type="number" value={r.max_reservas_activas_telefono} onChange={set('max_reservas_activas_telefono', true)} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={12}><TextField label="Bases y condiciones" value={r.bases ?? ''} onChange={set('bases')} multiline minRows={5} disabled={!puede || sorteada} /></Grid>
          <Grid item xs={12} md={6}><TextField label="Instrucciones de pago (banco, tipo y número de cuenta, RUT, correo)" value={r.info_pago ?? ''} onChange={set('info_pago')} multiline minRows={4} disabled={!puede || sorteada}
            helperText="Sólo datos para recibir transferencias. Nunca claves ni coordenadas." /></Grid>
          <Grid item xs={12} md={6}><TextField label="Contacto" value={r.contacto ?? ''} onChange={set('contacto')} multiline minRows={4} disabled={!puede} /></Grid>
          <Grid item xs={12}><FormControlLabel control={<Checkbox checked={!!r.pedir_rut} onChange={set('pedir_rut')} disabled={!puede || sorteada} />}
            label="Solicitar RUT al comprador (sólo si las bases lo justifican, p. ej. para entregar premios de alto valor)" /></Grid>
        </Grid>
        {puede && <Button variant="contained" size="large" onClick={guardar} disabled={guardando} sx={{ mt: 2 }}>{guardando ? 'Guardando…' : nueva ? 'Crear borrador' : 'Guardar cambios'}</Button>}
      </CardContent></Card>

      {!nueva && (
        <>
          <Card sx={{ mt: 2 }}><CardContent>
            <Typography variant="h3" gutterBottom>Afiche</Typography>
            {r.afiche_path && <img src={urlPublica(r.afiche_path)} alt="Afiche" style={{ maxWidth: 320, borderRadius: 12, display: 'block', marginBottom: 12 }} />}
            {puede && <Button variant="outlined" component="label">Subir afiche<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => subirAfiche(e.target.files?.[0])} /></Button>}
          </CardContent></Card>
          <Premios rifaId={id!} premios={premios} puede={puede} onCambio={cargar} />
          <NumerosAdmin rifaId={id!} puede={auth.tiene('numeros.bloquear')} />
        </>
      )}

      {accion && (
        <Confirmar abierto titulo={accion.titulo} mensaje={accion.msg} onCancelar={() => setAccion(null)} onConfirmar={() => cambiarEstado(accion.estado)} />
      )}
    </>
  );
}

function Premios({ rifaId, premios, puede, onCambio }: { rifaId: string; premios: Premio[]; puede: boolean; onCambio: () => void }) {
  const avisar = useAviso();
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '' });
  const agregar = async () => {
    const posicion = (premios.at(-1)?.posicion ?? 0) + 1;
    const { error } = await supabase.from('premios').insert({ rifa_id: rifaId, posicion, nombre: nuevo.nombre.trim(), descripcion: nuevo.descripcion.trim() || null });
    if (error) avisar(mensajeError(error), 'error'); else { setNuevo({ nombre: '', descripcion: '' }); onCambio(); }
  };
  const eliminar = async (p: Premio) => {
    const { error } = await supabase.from('premios').delete().eq('id', p.id);
    if (error) avisar(mensajeError(error), 'error'); else onCambio();
  };
  const foto = async (p: Premio, f?: File) => {
    if (!f) return;
    try {
      const ruta = await subirImagen(rifaId, 'premios', f);
      const { error } = await supabase.from('premios').update({ foto_path: ruta }).eq('id', p.id);
      if (error) throw error;
      onCambio();
    } catch (e) { avisar(mensajeError(e), 'error'); }
  };
  return (
    <Card sx={{ mt: 2 }}><CardContent>
      <Typography variant="h3" gutterBottom>Premios</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>El orden define a qué lugar corresponde cada premio en el sorteo. Recuerde: la ley sólo permite rifar bienes muebles.</Typography>
      {premios.map((p) => (
        <Stack key={p.id} direction="row" alignItems="center" gap={2} sx={{ py: 1, borderBottom: '1px solid #eee' }}>
          <Typography fontWeight={800} sx={{ width: 40 }}>{p.posicion}°</Typography>
          {p.foto_path ? <img src={urlPublica(p.foto_path)} alt="" width={56} height={56} style={{ objectFit: 'cover', borderRadius: 8 }} /> : <Box sx={{ width: 56, height: 56, bgcolor: '#eee', borderRadius: 2 }} />}
          <Box sx={{ flex: 1 }}><Typography fontWeight={700}>{p.nombre}</Typography><Typography variant="body2" color="text.secondary">{p.descripcion}</Typography></Box>
          {puede && <Button size="small" component="label">Foto<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => foto(p, e.target.files?.[0])} /></Button>}
          {puede && <IconButton aria-label={`Eliminar ${p.nombre}`} onClick={() => eliminar(p)}><DeleteIcon /></IconButton>}
        </Stack>
      ))}
      {puede && (
        <Stack direction={{ xs: 'column', md: 'row' }} gap={1} sx={{ mt: 2 }}>
          <TextField size="small" label="Nombre del premio" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <TextField size="small" label="Descripción" value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
          <Button variant="outlined" onClick={agregar} disabled={nuevo.nombre.trim().length < 2}>Agregar premio</Button>
        </Stack>
      )}
    </CardContent></Card>
  );
}

function NumerosAdmin({ rifaId, puede }: { rifaId: string; puede: boolean }) {
  const { numeros, recargar } = useNumeros(rifaId);
  const avisar = useAviso();
  const [lista, setLista] = useState('');
  const [motivo, setMotivo] = useState('');
  const conteo = { disponible: 0, reservado: 0, pendiente_pago: 0, vendido: 0, bloqueado: 0 } as Record<string, number>;
  numeros.forEach((e) => { conteo[e]++; });
  const aplicar = async (bloquear: boolean) => {
    try {
      const nums = parsearListaNumeros(lista);
      const n = bloquear
        ? await rpc<number>('bloquear_numeros', { p_rifa_id: rifaId, p_numeros: nums, p_motivo: motivo })
        : await rpc<number>('desbloquear_numeros', { p_rifa_id: rifaId, p_numeros: nums });
      avisar(`${n} números ${bloquear ? 'bloqueados' : 'desbloqueados'} (sólo se afectan números disponibles/bloqueados)`);
      setLista(''); void recargar();
    } catch (e) { avisar(mensajeError(e), 'error'); }
  };
  return (
    <Card sx={{ mt: 2 }}><CardContent>
      <Typography variant="h3" gutterBottom>Números</Typography>
      <Leyenda />
      <Stack direction="row" gap={1} flexWrap="wrap">
        {Object.entries(conteo).map(([k, v]) => <Chip key={k} label={`${ESTILO_NUMERO[k as keyof typeof ESTILO_NUMERO].etiqueta}: ${v}`} />)}
      </Stack>
      {puede && (
        <Stack direction={{ xs: 'column', md: 'row' }} gap={1} sx={{ mt: 2 }}>
          <TextField size="small" label="Números (ej: 1, 5, 10-20)" value={lista} onChange={(e) => setLista(e.target.value)} />
          <TextField size="small" label="Motivo del bloqueo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <Button variant="outlined" onClick={() => aplicar(true)} disabled={!lista || motivo.trim().length < 3}>Bloquear</Button>
          <Button onClick={() => aplicar(false)} disabled={!lista}>Desbloquear</Button>
        </Stack>
      )}
    </CardContent></Card>
  );
}
