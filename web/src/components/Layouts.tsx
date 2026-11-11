import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CasinoIcon from '@mui/icons-material/Casino';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  AppBar, Box, Container, Divider, Drawer, IconButton, Link, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography, useMediaQuery,
} from '@mui/material';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link as RLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Cargando } from './comunes';

export function useConfigPublica() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from('configuraciones').select('clave, valor').eq('publica', true).then(({ data }) => {
      setCfg(Object.fromEntries((data ?? []).map((c) => [c.clave, String(c.valor ?? '')])));
    });
  }, []);
  return cfg;
}

export function LayoutPublico() {
  const cfg = useConfigPublica();
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" color="primary" elevation={0}>
        <Toolbar sx={{ gap: 1 }}>
          <ConfirmationNumberIcon sx={{ color: 'secondary.main' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component={RLink} to="/" sx={{ color: 'inherit', textDecoration: 'none', fontWeight: 800, display: 'block' }} noWrap>
              {cfg['institucion.centro_padres'] || 'Centro de Padres'}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }} noWrap display="block">{cfg['institucion.colegio']}</Typography>
          </Box>
          <Link component={RLink} to="/reserva" color="inherit" underline="always" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Mi reserva</Link>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flex: 1 }}>
        <Outlet />
      </Box>
      <Box component="footer" sx={{ py: 3, px: 2, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>
        <div>{cfg['institucion.contacto'] && <>Contacto: {cfg['institucion.contacto']} · </>}<Link component={RLink} to="/privacidad">Política de privacidad</Link></div>
        <div style={{ marginTop: 6 }}><Link component={RLink} to="/admin" color="inherit" underline="hover" sx={{ fontSize: 12 }}>Acceso Tesorería</Link></div>
      </Box>
    </Box>
  );
}

const MENU: { a: string; t: string; i: ReactNode; p: string | string[] }[] = [
  { a: '/admin', t: 'Resumen', i: <DashboardIcon />, p: 'reportes.ver' },
  { a: '/admin/rifas', t: 'Rifas', i: <ConfirmationNumberIcon />, p: 'rifas.ver' },
  { a: '/admin/pagos', t: 'Pagos y comprobantes', i: <AccountBalanceIcon />, p: 'pagos.ver' },
  { a: '/admin/compradores', t: 'Compradores', i: <PeopleIcon />, p: 'compradores.ver' },
  { a: '/admin/sorteos', t: 'Sorteos y premios', i: <CasinoIcon />, p: ['sorteos.ejecutar', 'premios.entregar', 'reportes.ver'] },
  { a: '/admin/reportes', t: 'Reportes', i: <AssessmentIcon />, p: 'reportes.ver' },
  { a: '/admin/drive', t: 'Respaldo Drive', i: <CloudSyncIcon />, p: 'drive.gestionar' },
  { a: '/admin/notificaciones', t: 'Notificaciones', i: <NotificationsIcon />, p: 'notificaciones.gestionar' },
  { a: '/admin/usuarios', t: 'Usuarios y roles', i: <GroupIcon />, p: 'usuarios.gestionar' },
  { a: '/admin/auditoria', t: 'Bitácora', i: <HistoryIcon />, p: 'auditoria.ver' },
  { a: '/admin/configuracion', t: 'Configuración', i: <SettingsIcon />, p: 'configuracion.gestionar' },
];

export function RequiereAdmin() {
  const auth = useAuth();
  const loc = useLocation();
  if (auth.cargando) return <Cargando />;
  if (!auth.sesion) return <Navigate to="/admin/ingresar" replace state={{ desde: loc.pathname }} />;
  if (auth.necesitaMfa) return <Navigate to="/admin/mfa" replace />;
  if (!auth.rol) return <Navigate to="/admin/sin-acceso" replace />;
  return <LayoutAdmin />;
}

function LayoutAdmin() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const escritorio = useMediaQuery('(min-width:900px)');
  const [abierto, setAbierto] = useState(false);
  // cerrar el menú lateral en cada cambio de página (celulares)
  useEffect(() => { setAbierto(false); }, [loc.pathname]);
  const items = MENU.filter((m) => tieneAlguno(auth.tiene, m.p));
  const menu = (
    <Box sx={{ width: 260 }} role="navigation" aria-label="Menú administrativo">
      <Box sx={{ p: 2 }}>
        <Typography fontWeight={800}>Panel de Tesorería</Typography>
        <Typography variant="body2" color="text.secondary">{auth.nombre} · {auth.rol}</Typography>
      </Box>
      <Divider />
      <List>
        {items.map((m) => (
          <ListItemButton key={m.a} component={RLink} to={m.a} selected={m.a === '/admin' ? loc.pathname === '/admin' : loc.pathname.startsWith(m.a)} onClick={() => setAbierto(false)}>
            <ListItemIcon>{m.i}</ListItemIcon>
            <ListItemText primary={m.t} />
          </ListItemButton>
        ))}
        <Divider sx={{ my: 1 }} />
        <ListItemButton onClick={async () => { await auth.salir(); nav('/admin/ingresar'); }}>
          <ListItemIcon><LogoutIcon /></ListItemIcon>
          <ListItemText primary="Cerrar sesión" />
        </ListItemButton>
      </List>
    </Box>
  );
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {escritorio ? (
        <Drawer variant="permanent" sx={{ width: 260, '& .MuiDrawer-paper': { width: 260 } }}>{menu}</Drawer>
      ) : (
        <Drawer open={abierto} onClose={() => setAbierto(false)}>{menu}</Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {!escritorio && (
          <AppBar position="sticky" elevation={0}>
            <Toolbar>
              <IconButton color="inherit" edge="start" aria-label="Abrir menú" onClick={() => setAbierto(true)}><MenuIcon /></IconButton>
              <Typography fontWeight={800}>Tesorería CCPP</Typography>
            </Toolbar>
          </AppBar>
        )}
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Suspense fallback={<Cargando />}>
            <Outlet />
          </Suspense>
        </Container>
      </Box>
    </Box>
  );
}

export function SinPermiso() {
  return <Typography color="text.secondary" sx={{ py: 4 }}>No tiene permiso para ver esta sección. Solicite acceso a quien administra los usuarios.</Typography>;
}

const tieneAlguno = (tiene: (p: string) => boolean, p: string | string[]) => (Array.isArray(p) ? p.some(tiene) : tiene(p));

export function Permiso({ p, children }: { p: string | string[]; children: ReactNode }) {
  const auth = useAuth();
  return tieneAlguno(auth.tiene, p) ? <>{children}</> : <SinPermiso />;
}
