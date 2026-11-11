import { Alert, Button, Card, CardContent, FormControlLabel, Grid, Stack, Switch, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Cargando, Confirmar, useAviso } from '../../components/comunes';
import { mensajeError } from '../../lib/errores';
import { rpc, supabase } from '../../lib/supabase';

const TEXTOS: { clave: string; etiqueta: string; ayuda?: string }[] = [
  { clave: 'institucion.colegio', etiqueta: 'Nombre del colegio' },
  { clave: 'institucion.centro_padres', etiqueta: 'Nombre del Centro de Padres' },
  { clave: 'institucion.contacto', etiqueta: 'Contacto público (correo o teléfono de Tesorería)' },
  { clave: 'institucion.url_publica', etiqueta: 'URL pública de la aplicación', ayuda: 'Se usa en los enlaces de los correos. Ej: https://rifa-ccpp.vercel.app' },
  { clave: 'drive.cuenta_institucional', etiqueta: 'Correo de la cuenta Google institucional de Tesorería', ayuda: 'Sólo esta cuenta podrá conectarse para los respaldos en Drive' },
];

export default function Configuracion() {
  const avisar = useAviso();
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [meses, setMeses] = useState('24');
  const [politica, setPolitica] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('configuraciones').select('clave, valor');
    const c = Object.fromEntries((data ?? []).map((x) => [x.clave, x.valor]));
    setCfg(c);
    setBorrador(Object.fromEntries(TEXTOS.map((t) => [t.clave, c[t.clave] == null ? '' : String(c[t.clave])])));
    setMeses(String(c['privacidad.meses_conservacion'] ?? 24));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = async (clave: string, valor: unknown) => {
    const { error } = await supabase.from('configuraciones').update({ valor }).eq('clave', clave);
    if (error) throw new Error(mensajeError(error));
  };
  const guardarTodo = async () => {
    try {
      for (const t of TEXTOS) {
        const v = borrador[t.clave].trim();
        await guardar(t.clave, t.clave === 'drive.cuenta_institucional' ? v.toLowerCase() : v);
      }
      await guardar('privacidad.meses_conservacion', Math.max(1, Number(meses) || 24));
      avisar('Configuración guardada'); void cargar();
    } catch (e) { avisar((e as Error).message, 'error'); }
  };

  if (!cfg) return <Cargando />;
  return (
    <>
      <Typography variant="h1" gutterBottom>Configuración</Typography>
      <Card><CardContent>
        <Grid container spacing={2}>
          {TEXTOS.map((t) => (
            <Grid item xs={12} md={6} key={t.clave}>
              <TextField label={t.etiqueta} helperText={t.ayuda} value={borrador[t.clave] ?? ''} onChange={(e) => setBorrador({ ...borrador, [t.clave]: e.target.value })} />
            </Grid>
          ))}
          <Grid item xs={12} md={6}>
            <TextField type="number" label="Meses de conservación de datos personales tras el sorteo" value={meses} onChange={(e) => setMeses(e.target.value)} />
          </Grid>
        </Grid>
        <Button variant="contained" sx={{ mt: 2 }} onClick={guardarTodo}>Guardar</Button>
      </CardContent></Card>

      <Card sx={{ mt: 2 }}><CardContent>
        <Typography variant="h3" gutterBottom>Seguridad</Typography>
        <FormControlLabel control={<Switch checked={!!cfg['seguridad.mfa_obligatorio']} onChange={async (e) => { try { await guardar('seguridad.mfa_obligatorio', e.target.checked); void cargar(); } catch (er) { avisar((er as Error).message, 'error'); } }} />}
          label="Exigir verificación en dos pasos (TOTP) a todos los administradores" />
        <Alert severity="warning" sx={{ mt: 1 }}>Recomendado mantenerlo activo. Si lo desactiva, una contraseña filtrada bastaría para acceder al panel.</Alert>
      </CardContent></Card>

      <Card sx={{ mt: 2 }}><CardContent>
        <Typography variant="h3" gutterBottom>Protección de datos personales</Typography>
        <Typography gutterBottom>Aplica la política de conservación: anonimiza a los compradores cuyas rifas fueron sorteadas hace más de {meses} meses, sin reservas en curso ni premios pendientes. Se ejecuta también automáticamente cada mes si se configuraron las tareas programadas.</Typography>
        <Stack direction="row" gap={1}><Button variant="outlined" color="error" onClick={() => setPolitica(true)}>Aplicar ahora</Button></Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Para solicitudes individuales de supresión, use "Suprimir datos" en Compradores.</Typography>
      </CardContent></Card>

      <Confirmar abierto={politica} titulo="Aplicar política de conservación" peligro mensaje="Los datos personales anonimizados no se pueden recuperar."
        onCancelar={() => setPolitica(false)} onConfirmar={async () => { const n = await rpc<number>('aplicar_politica_conservacion'); setPolitica(false); avisar(`${n} compradores anonimizados`); }} />
    </>
  );
}
