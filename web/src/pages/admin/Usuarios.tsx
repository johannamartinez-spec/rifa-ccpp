import {
  Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Cargando, ErrorCaja, useAviso } from '../../components/comunes';
import { useAuth } from '../../lib/auth';
import { mensajeError } from '../../lib/errores';
import { fechaHora } from '../../lib/formato';
import { llamarFuncion, supabase } from '../../lib/supabase';

interface Usuario { id: string; email: string; nombre: string; rol: string; activo: boolean; created_at: string }
interface Rol { codigo: string; nombre: string }
interface Permiso { codigo: string; descripcion: string }

export default function Usuarios() {
  const auth = useAuth();
  const avisar = useAviso();
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [matriz, setMatriz] = useState<Set<string>>(new Set());
  const [invitar, setInvitar] = useState(false);
  const [nuevo, setNuevo] = useState({ email: '', nombre: '', rol: 'secretaria' });
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [u, r, p, rp] = await Promise.all([
      supabase.from('usuarios').select('*').order('created_at'),
      supabase.from('roles').select('codigo, nombre'),
      supabase.from('permisos').select('codigo, descripcion').order('codigo'),
      supabase.from('rol_permisos').select('rol, permiso'),
    ]);
    if (u.error) { setError(mensajeError(u.error)); return; }
    setUsuarios(u.data as Usuario[]); setRoles(r.data ?? []); setPermisos(p.data ?? []);
    setMatriz(new Set((rp.data ?? []).map((x) => `${x.rol}|${x.permiso}`)));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const cambiarRol = async (u: Usuario, rol: string) => {
    const { error: e } = await supabase.from('usuarios').update({ rol }).eq('id', u.id);
    if (e) avisar(mensajeError(e), 'error'); else { avisar('Rol actualizado'); void cargar(); }
  };
  const alternarActivo = async (u: Usuario) => {
    try { await llamarFuncion('admin-usuarios', { accion: u.activo ? 'desactivar' : 'activar', id: u.id }); avisar(u.activo ? 'Acceso desactivado' : 'Acceso reactivado'); void cargar(); }
    catch (e) { avisar(mensajeError(e), 'error'); }
  };
  const alternarPermiso = async (rol: string, permiso: string) => {
    const clave = `${rol}|${permiso}`;
    const r = matriz.has(clave)
      ? await supabase.from('rol_permisos').delete().eq('rol', rol).eq('permiso', permiso)
      : await supabase.from('rol_permisos').insert({ rol, permiso });
    if (r.error) avisar(mensajeError(r.error), 'error'); else void cargar();
  };
  const enviarInvitacion = async () => {
    try { await llamarFuncion('admin-usuarios', { accion: 'invitar', ...nuevo }); setInvitar(false); setNuevo({ email: '', nombre: '', rol: 'secretaria' }); avisar('Invitación enviada por correo'); void cargar(); }
    catch (e) { avisar(mensajeError(e), 'error'); }
  };

  if (!usuarios) return error ? <ErrorCaja error={error} /> : <Cargando />;
  const rolesEditables = roles.filter((r) => r.codigo !== 'superadmin');
  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h1">Usuarios y roles</Typography>
        <Button variant="contained" onClick={() => setInvitar(true)}>Invitar usuario</Button>
      </Stack>
      <TableContainer component={Card}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Nombre</TableCell><TableCell>Correo</TableCell><TableCell>Rol</TableCell><TableCell>Estado</TableCell><TableCell>Creado</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>
            {usuarios.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.nombre}</TableCell><TableCell>{u.email}</TableCell>
                <TableCell>
                  <TextField select size="small" value={u.rol} onChange={(e) => cambiarRol(u, e.target.value)} disabled={u.id === auth.sesion?.user.id}>
                    {roles.map((r) => <MenuItem key={r.codigo} value={r.codigo} disabled={r.codigo === 'superadmin' && auth.rol !== 'superadmin'}>{r.nombre}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell><Chip size="small" label={u.activo ? 'Activo' : 'Desactivado'} color={u.activo ? 'success' : 'default'} /></TableCell>
                <TableCell>{fechaHora(u.created_at)}</TableCell>
                <TableCell>{u.id !== auth.sesion?.user.id && <Button size="small" color={u.activo ? 'error' : 'primary'} onClick={() => alternarActivo(u)}>{u.activo ? 'Desactivar' : 'Reactivar'}</Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Card sx={{ mt: 3 }}><CardContent>
        <Typography variant="h3" gutterBottom>Permisos por rol</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>Marque las funciones que la directiva autoriza a cada rol. El superadministrador siempre tiene todos los permisos. Los cambios rigen de inmediato y quedan en la bitácora.</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow><TableCell>Permiso</TableCell>{rolesEditables.map((r) => <TableCell key={r.codigo} align="center">{r.nombre}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {permisos.map((p) => (
                <TableRow key={p.codigo}>
                  <TableCell><b>{p.codigo}</b><br /><Typography variant="caption">{p.descripcion}</Typography></TableCell>
                  {rolesEditables.map((r) => (
                    <TableCell key={r.codigo} align="center">
                      <Checkbox checked={matriz.has(`${r.codigo}|${p.codigo}`)} onChange={() => alternarPermiso(r.codigo, p.codigo)} inputProps={{ 'aria-label': `${p.codigo} para ${r.nombre}` }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent></Card>

      <Dialog open={invitar} onClose={() => setInvitar(false)} fullWidth maxWidth="xs">
        <DialogTitle>Invitar usuario</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ mt: 1 }}>
            <TextField label="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            <TextField label="Correo" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} helperText="Use, de preferencia, correos institucionales del cargo" />
            <TextField select label="Rol" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
              {roles.filter((r) => r.codigo !== 'superadmin' || auth.rol === 'superadmin').map((r) => <MenuItem key={r.codigo} value={r.codigo}>{r.nombre}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setInvitar(false)}>Cancelar</Button><Button variant="contained" onClick={enviarInvitacion} disabled={!nuevo.email || nuevo.nombre.length < 3}>Enviar invitación</Button></DialogActions>
      </Dialog>
    </>
  );
}
