import { Alert, Box, Button, Card, CardContent, Container, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Cargando } from '../../components/comunes';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

/** Segundo factor TOTP (Google Authenticator, Microsoft Authenticator, etc.). Gratuito en Supabase. */
export default function Mfa() {
  const auth = useAuth();
  const nav = useNavigate();
  const [fase, setFase] = useState<'cargando' | 'enrolar' | 'verificar'>('cargando');
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secreto, setSecreto] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.sesion) return;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = data?.totp?.find((f) => f.status === 'verified');
      if (totp) { setFactorId(totp.id); setFase('verificar'); return; }
      if (!auth.mfaObligatorio) { nav('/admin', { replace: true }); return; }
      // limpiar factores sin verificar de intentos previos
      for (const f of data?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: e, error: er } = await supabase.auth.mfa.enroll({ factorType: 'totp',    friendlyName: `CCPP ${Date.now()}` });
      if (er || !e) { setError(er?.message ?? 'No se pudo iniciar el segundo factor'); return; }
      setFactorId(e.id); setQr(e.totp.qr_code); setSecreto(e.totp.secret); setFase('enrolar');
    })();
  }, [auth.sesion, auth.mfaObligatorio, nav]);

  if (!auth.cargando && !auth.sesion) return <Navigate to="/admin/ingresar" replace />;
  if (auth.cargando || fase === 'cargando') return error ? <Container sx={{ py: 4 }}><Alert severity="error">{error}</Alert></Container> : <Cargando />;

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const { error: er } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo.replace(/\s/g, '') });
    if (er) { setError('Código incorrecto o vencido. Intente con el código actual de su aplicación.'); return; }
    await auth.recargar();
    nav('/admin', { replace: true });
  };

  return (
    <Container maxWidth="xs" sx={{ py: 6 }}>
      <Card component="form" onSubmit={verificar}>
        <CardContent>
          <Typography variant="h2" gutterBottom>Verificación en dos pasos</Typography>
          {fase === 'enrolar' && (
            <>
              <Typography gutterBottom>Escanee este código con una aplicación autenticadora (Google Authenticator, Microsoft Authenticator u otra) e ingrese el código de 6 dígitos.</Typography>
              <Box sx={{ textAlign: 'center', my: 2 }}><img src={qr} alt="Código QR para el autenticador" width={200} height={200} /></Box>
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>Clave manual: {secreto}</Typography>
            </>
          )}
          {fase === 'verificar' && <Typography gutterBottom>Ingrese el código de 6 dígitos de su aplicación autenticadora.</Typography>}
          <Stack gap={2} sx={{ mt: 2 }}>
            <TextField label="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" autoComplete="one-time-code" inputProps={{ maxLength: 7 }} autoFocus required />
            {error && <Alert severity="error">{error}</Alert>}
            <Button type="submit" variant="contained" size="large">Verificar</Button>
            <Button onClick={async () => { await auth.salir(); nav('/admin/ingresar'); }}>Cancelar</Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
