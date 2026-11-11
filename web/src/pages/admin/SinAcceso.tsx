import { Alert, Button, Container } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

export default function SinAcceso() {
  const auth = useAuth();
  const nav = useNavigate();
  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Alert severity="warning" sx={{ mb: 2 }}>
        Su cuenta ({auth.sesion?.user.email}) no tiene un rol administrativo activo. Solicite acceso a la persona que administra los usuarios del Centro de Padres.
      </Alert>
      <Button variant="outlined" onClick={async () => { await auth.salir(); nav('/'); }}>Cerrar sesión</Button>
    </Container>
  );
}
