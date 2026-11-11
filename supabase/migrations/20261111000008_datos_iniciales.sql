-- =====================================================================
-- RIFA ONLINE CCPP — 0008 Datos iniciales: roles, permisos, configuración
-- (No contiene datos ficticios. Los datos de prueba están en supabase/seed/)
-- =====================================================================

insert into public.roles (codigo, nombre, descripcion) values
  ('superadmin', 'Superadministrador', 'Control total, incluida la gestión de usuarios y roles'),
  ('tesorera',   'Tesorera',           'Administración financiera: rifas, pagos, sorteos, reportes y respaldos'),
  ('presidenta', 'Presidenta',         'Acceso según lo autorice la directiva'),
  ('secretaria', 'Secretaria',         'Acceso según lo autorice la directiva'),
  ('auditor',    'Auditor de consulta','Sólo lectura, sin modificar información')
on conflict (codigo) do nothing;

insert into public.permisos (codigo, descripcion, solo_lectura) values
  ('rifas.ver',               'Ver rifas (incluidos borradores)', true),
  ('rifas.gestionar',         'Crear, editar, publicar y cerrar rifas', false),
  ('numeros.bloquear',        'Bloquear y desbloquear números', false),
  ('compradores.ver',         'Ver datos personales de compradores y reservas', true),
  ('pagos.ver',               'Ver pagos y comprobantes', true),
  ('pagos.validar',           'Aprobar, rechazar, confirmar, cancelar y revertir pagos', false),
  ('sorteos.ejecutar',        'Congelar padrón y ejecutar sorteos', false),
  ('premios.entregar',        'Registrar entrega de premios', false),
  ('reportes.ver',            'Ver dashboard y generar reportes', true),
  ('usuarios.gestionar',      'Administrar usuarios y permisos por rol', false),
  ('configuracion.gestionar', 'Modificar configuración y datos personales (supresión)', false),
  ('auditoria.ver',           'Consultar la bitácora de auditoría', true),
  ('drive.gestionar',         'Conectar y supervisar respaldos en Google Drive', false),
  ('notificaciones.gestionar','Configurar y supervisar notificaciones', false)
on conflict (codigo) do nothing;

-- Superadministrador: todo
insert into public.rol_permisos (rol, permiso) select 'superadmin', codigo from public.permisos on conflict do nothing;

-- Tesorera: administración financiera completa (cuenta institucional propietaria)
insert into public.rol_permisos (rol, permiso)
select 'tesorera', codigo from public.permisos where codigo <> 'usuarios.gestionar'
on conflict do nothing;

-- Presidenta / Secretaria: mínimo por defecto; la directiva amplía desde el panel
insert into public.rol_permisos (rol, permiso) values
  ('presidenta', 'rifas.ver'), ('presidenta', 'reportes.ver'),
  ('secretaria', 'rifas.ver'), ('secretaria', 'premios.entregar')
on conflict do nothing;

-- Auditor: todo lo de sólo lectura
insert into public.rol_permisos (rol, permiso)
select 'auditor', codigo from public.permisos where solo_lectura
on conflict do nothing;

-- Configuración por defecto
insert into public.configuraciones (clave, valor, publica, descripcion) values
  ('institucion.colegio',          '"Nombre del Colegio"', true,  'Nombre del establecimiento'),
  ('institucion.centro_padres',    '"Centro de Padres y Apoderados"', true, 'Nombre del Centro de Padres'),
  ('institucion.contacto',         '"tesoreria@ejemplo.cl"', true, 'Correo/teléfono público de contacto'),
  ('institucion.url_publica',      '"https://rifa-ccpp.vercel.app"', true, 'URL pública de la aplicación (enlaces en correos)'),
  ('seguridad.mfa_obligatorio',    'true',  false, 'Exigir segundo factor (TOTP) a todos los administradores'),
  ('notificaciones.email_activo',  'true',  false, 'Enviar correos automáticos'),
  ('notificaciones.whatsapp_activo','false', false, 'Encolar avisos por WhatsApp (requiere proveedor oficial)'),
  ('notificaciones.recordatorio_minutos_antes', '10', false, 'Minutos antes del vencimiento para recordar el pago'),
  ('notificaciones.tipos', '{"reserva_confirmada":true,"recordatorio_pago":true,"reserva_expirada":true,"pago_confirmado":true,"pago_rechazado":true,"nuevo_comprobante_solicitado":true,"reserva_cancelada":true,"resultado_sorteo":true}', false, 'Activar/desactivar cada tipo de aviso'),
  ('drive.cuenta_institucional',   'null',  false, 'Correo de la cuenta Google institucional de Tesorería (dueña del Drive)'),
  ('privacidad.meses_conservacion','24',    false, 'Meses de conservación de datos personales tras el sorteo'),
  ('privacidad.politica_url',      '"/privacidad"', true, 'Ruta de la política de privacidad')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Primer administrador: tras crear el usuario en Supabase Auth, ejecutar
-- (reemplazando el correo):
--   select interno.crear_primer_superadmin('tesoreria@colegio.cl', 'Tesorería CCPP');
-- Sólo funciona si aún no existe ningún usuario administrativo.
-- ---------------------------------------------------------------------
create or replace function interno.crear_primer_superadmin(p_email text, p_nombre text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if exists (select 1 from public.usuarios) then
    raise exception 'Ya existen usuarios administrativos; use el panel para agregar más';
  end if;
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then raise exception 'No existe en Auth un usuario con el correo %', p_email; end if;
  insert into public.usuarios (id, email, nombre, rol) values (v_id, lower(trim(p_email)), p_nombre, 'superadmin');
  update public.configuraciones set valor = to_jsonb(lower(trim(p_email))) where clave = 'drive.cuenta_institucional' and valor = 'null'::jsonb;
  return v_id;
end; $$;
