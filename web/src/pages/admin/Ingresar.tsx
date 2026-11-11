import LockIcon from '@mui/icons-material/Lock';
import { Alert, Box, Button, Card, CardContent, Container, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export default function Ingresar() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { desde?: string } };
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [modo, setModo] = useState<'ingresar' | 'recuperar'>('ingresar');

  if (auth.sesion && !auth.cargando) return <Navigate to={auth.necesitaMfa ? '/admin/mfa' : loc.state?.desde ?? '/admin'} replace />;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setTrabajando(true);
    try {
      if (modo === 'ingresar') {
        const { error: er } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
        if (er) throw new Error(er.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : er.message);
        nav('/admin/mfa');
      } else {
        const { error: er } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/admin/activar` });
        if (er) throw er;
        setInfo('Si el correo está registrado, recibirá un enlace para crear una nueva contraseña.');
      }
    } catch (er) { setError((er as Error).message); } finally { setTrabajando(false); }
  };

  return (
    <Container maxWidth="xs" sx={{ py: 6 }}>
      <Card component="form" onSubmit={enviar}>
        <CardContent>
          <Stack alignItems="center" sx={{ mb: 2 }}>
            <Box sx={{ bgcolor: 'primary.main', color: '#fff', borderRadius: '50%', p: 1.5, mb: 1 }}><LockIcon /></Box>
            <Typography variant="h2">{modo === 'ingresar' ? 'Acceso Tesorería' : 'Recuperar contraseña'}</Typography>
          </Stack>
          <Stack gap={2}>
            <TextField label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            {modo === 'ingresar' && <TextField label="Contraseña" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required />}
            {error && <Alert severity="error">{error}</Alert>}
            {info && <Alert severity="info">{info}</Alert>}
            <Button type="submit" variant="contained" size="large" disabled={trabajando}>{modo === 'ingresar' ? 'Ingresar' : 'Enviar enlace'}</Button>
            <Link component="button" type="button" onClick={() => setModo(modo === 'ingresar' ? 'recuperar' : 'ingresar')}>
              {modo === 'ingresar' ? '¿Olvidó su contraseña?' : 'Volver a ingresar'}
            </Link>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
