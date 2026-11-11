import { Alert, Button, Card, CardContent, Container, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

/** Política de contraseñas: 12+ caracteres, mayúscula, minúscula, número y símbolo. */
export function evaluarClave(c: string): { ok: boolean; faltan: string[]; puntaje: number } {
  const reglas: [boolean, string][] = [
    [c.length >= 12, 'al menos 12 caracteres'],
    [/[a-z]/.test(c), 'una minúscula'],
    [/[A-Z]/.test(c), 'una mayúscula'],
    [/\d/.test(c), 'un número'],
    [/[^A-Za-z0-9]/.test(c), 'un símbolo'],
  ];
  const faltan = reglas.filter(([ok]) => !ok).map(([, t]) => t);
  return { ok: faltan.length === 0, faltan, puntaje: ((reglas.length - faltan.length) / reglas.length) * 100 };
}

export default function Activar() {
  const auth = useAuth();
  const nav = useNavigate();
  const [c1, setC1] = useState('');
  const [c2, setC2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ev = evaluarClave(c1);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ev.ok || c1 !== c2) return;
    const { error: er } = await supabase.auth.updateUser({ password: c1 });
    if (er) { setError(er.message); return; }
    nav('/admin/mfa');
  };

  if (!auth.sesion && !auth.cargando) {
    return <Container maxWidth="xs" sx={{ py: 6 }}><Alert severity="warning">El enlace expiró o ya fue usado. Solicite uno nuevo desde "¿Olvidó su contraseña?".</Alert></Container>;
  }
  return (
    <Container maxWidth="xs" sx={{ py: 6 }}>
      <Card component="form" onSubmit={guardar}>
        <CardContent>
          <Typography variant="h2" gutterBottom>Crear contraseña</Typography>
          <Stack gap={2}>
            <TextField label="Nueva contraseña" type="password" value={c1} onChange={(e) => setC1(e.target.value)} autoComplete="new-password" required />
            <LinearProgress variant="determinate" value={ev.puntaje} color={ev.ok ? 'success' : 'warning'} />
            {!ev.ok && c1 && <Typography variant="body2" color="text.secondary">Falta: {ev.faltan.join(', ')}.</Typography>}
            <TextField label="Repetir contraseña" type="password" value={c2} onChange={(e) => setC2(e.target.value)} autoComplete="new-password"
              error={!!c2 && c1 !== c2} helperText={c2 && c1 !== c2 ? 'No coinciden' : ' '} required />
            {error && <Alert severity="error">{error}</Alert>}
            <Button type="submit" variant="contained" size="large" disabled={!ev.ok || c1 !== c2}>Guardar</Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
