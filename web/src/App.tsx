import { Alert, Container } from '@mui/material';
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Cargando } from './components/comunes';
import { LayoutPublico, Permiso, RequiereAdmin } from './components/Layouts';
import { configuracionFaltante } from './lib/supabase';
import Inicio from './pages/publico/Inicio';
import PaginaRifa from './pages/publico/Rifa';
import PaginaReserva from './pages/publico/Reserva';

const SorteoVivo = lazy(() => import('./pages/publico/SorteoVivo'));
const VerificarSorteo = lazy(() => import('./pages/publico/VerificarSorteo'));
const Privacidad = lazy(() => import('./pages/publico/Privacidad'));
const Ingresar = lazy(() => import('./pages/admin/Ingresar'));
const Mfa = lazy(() => import('./pages/admin/Mfa'));
const Activar = lazy(() => import('./pages/admin/Activar'));
const SinAcceso = lazy(() => import('./pages/admin/SinAcceso'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Rifas = lazy(() => import('./pages/admin/Rifas'));
const RifaEditor = lazy(() => import('./pages/admin/RifaEditor'));
const Pagos = lazy(() => import('./pages/admin/Pagos'));
const Compradores = lazy(() => import('./pages/admin/Compradores'));
const Sorteos = lazy(() => import('./pages/admin/Sorteos'));
const Reportes = lazy(() => import('./pages/admin/Reportes'));
const Usuarios = lazy(() => import('./pages/admin/Usuarios'));
const Drive = lazy(() => import('./pages/admin/Drive'));
const Notificaciones = lazy(() => import('./pages/admin/Notificaciones'));
const Auditoria = lazy(() => import('./pages/admin/Auditoria'));
const Configuracion = lazy(() => import('./pages/admin/Configuracion'));

export default function App() {
  if (configuracionFaltante) {
    return (
      <Container sx={{ py: 6 }}>
        <Alert severity="warning">
          Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Vea docs/MANUAL_INSTALACION.md.
        </Alert>
      </Container>
    );
  }
  return (
    <Suspense fallback={<Cargando />}>
      <Routes>
        <Route element={<LayoutPublico />}>
          <Route index element={<Inicio />} />
          <Route path="rifa/:id" element={<PaginaRifa />} />
          <Route path="reserva" element={<PaginaReserva />} />
          <Route path="sorteo/:id/verificar" element={<VerificarSorteo />} />
          <Route path="privacidad" element={<Privacidad />} />
        </Route>
        <Route path="sorteo/:id" element={<SorteoVivo />} />
        <Route path="admin/ingresar" element={<Ingresar />} />
        <Route path="admin/mfa" element={<Mfa />} />
        <Route path="admin/activar" element={<Activar />} />
        <Route path="admin/sin-acceso" element={<SinAcceso />} />
        <Route path="admin" element={<RequiereAdmin />}>
          <Route index element={<Permiso p="reportes.ver"><Dashboard /></Permiso>} />
          <Route path="rifas" element={<Permiso p="rifas.ver"><Rifas /></Permiso>} />
          <Route path="rifas/:id" element={<Permiso p="rifas.ver"><RifaEditor /></Permiso>} />
          <Route path="pagos" element={<Permiso p="pagos.ver"><Pagos /></Permiso>} />
          <Route path="compradores" element={<Permiso p="compradores.ver"><Compradores /></Permiso>} />
          <Route path="sorteos" element={<Permiso p={['sorteos.ejecutar', 'premios.entregar', 'reportes.ver']}><Sorteos /></Permiso>} />
          <Route path="reportes" element={<Permiso p="reportes.ver"><Reportes /></Permiso>} />
          <Route path="usuarios" element={<Permiso p="usuarios.gestionar"><Usuarios /></Permiso>} />
          <Route path="drive" element={<Permiso p="drive.gestionar"><Drive /></Permiso>} />
          <Route path="notificaciones" element={<Permiso p="notificaciones.gestionar"><Notificaciones /></Permiso>} />
          <Route path="auditoria" element={<Permiso p="auditoria.ver"><Auditoria /></Permiso>} />
          <Route path="configuracion" element={<Permiso p="configuracion.gestionar"><Configuracion /></Permiso>} />
        </Route>
        <Route path="*" element={<LayoutPublico />}>
          <Route path="*" element={<Container sx={{ py: 6 }}><Alert severity="info">Página no encontrada.</Alert></Container>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
