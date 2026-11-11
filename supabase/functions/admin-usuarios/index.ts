/**
 * Gestión de cuentas administrativas (requiere service_role, por eso vive en el servidor).
 *   { accion:'invitar', email, nombre, rol }     -> envía invitación por correo
 *   { accion:'desactivar' | 'activar', id }      -> bloquea/desbloquea el acceso (incluye sesiones)
 * Requiere permiso usuarios.gestionar. Sólo un superadmin puede crear superadmins.
 */
import { clienteServicio, cors, env, ErrorHttp, exigirAdmin, manejarError, responder } from '../_shared/servidor.ts';

const ROLES = ['superadmin', 'tesorera', 'presidenta', 'secretaria', 'auditor'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    if (req.method !== 'POST') throw new ErrorHttp(405, 'Método no permitido');
    const admin = await exigirAdmin(req, 'usuarios.gestionar');
    const sb = clienteServicio();
    const cuerpo = await req.json();
    const { data: yo } = await sb.from('usuarios').select('rol').eq('id', admin.id).single();

    if (cuerpo.accion === 'invitar') {
      const email = String(cuerpo.email ?? '').trim().toLowerCase();
      const nombre = String(cuerpo.nombre ?? '').trim();
      const rol = String(cuerpo.rol ?? '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorHttp(400, 'Correo inválido');
      if (nombre.length < 3) throw new ErrorHttp(400, 'Nombre inválido');
      if (!ROLES.includes(rol)) throw new ErrorHttp(400, 'Rol inválido');
      if (rol === 'superadmin' && yo?.rol !== 'superadmin') throw new ErrorHttp(403, 'Sólo un superadministrador puede crear otro');
      const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${env('APP_URL').replace(/\/$/, '')}/admin/activar`,
        data: { nombre },
      });
      if (error) throw new ErrorHttp(400, `No se pudo invitar: ${error.message}`);
      const { error: e2 } = await sb.from('usuarios').insert({ id: data.user.id, email, nombre, rol, created_by: admin.id });
      if (e2) throw new ErrorHttp(400, e2.message);
      return responder(req, { ok: true, id: data.user.id });
    }

    if (cuerpo.accion === 'desactivar' || cuerpo.accion === 'activar') {
      const id = String(cuerpo.id ?? '');
      if (id === admin.id) throw new ErrorHttp(400, 'No puede desactivarse a sí mismo');
      const activo = cuerpo.accion === 'activar';
      // Se usa el cliente del administrador: aplica RLS y triggers de protección
      const { error } = await admin.cliente.from('usuarios').update({ activo }).eq('id', id);
      if (error) throw new ErrorHttp(400, error.message);
      const { error: e2 } = await sb.auth.admin.updateUserById(id, { ban_duration: activo ? 'none' : '876000h' });
      if (e2) throw new ErrorHttp(400, e2.message);
      return responder(req, { ok: true });
    }
    throw new ErrorHttp(400, 'Acción desconocida');
  } catch (e) {
    return manejarError(req, e);
  }
});
