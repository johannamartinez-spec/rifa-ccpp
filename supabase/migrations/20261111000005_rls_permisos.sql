-- =====================================================================
-- RIFA ONLINE CCPP — 0005 Row Level Security, privilegios y protección
-- de usuarios administrativos
-- Principio: mínimo privilegio. Los visitantes sólo leen datos públicos
-- de rifas; toda escritura sensible pasa por funciones validadas.
-- =====================================================================

-- RLS en TODAS las tablas del esquema public
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Quitar privilegios por defecto y otorgar sólo lo necesario
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Lectura pública (visitantes)
-- ---------------------------------------------------------------------
grant select on public.rifas, public.premios, public.numeros to anon, authenticated;
grant select on public.configuraciones to anon, authenticated;
grant select on public.sorteos to anon, authenticated;

create policy rifas_lectura on public.rifas for select to anon, authenticated
  using (estado <> 'borrador' or public.tiene_permiso('rifas.ver'));
create policy premios_lectura on public.premios for select to anon, authenticated
  using (exists (select 1 from public.rifas r where r.id = rifa_id and (r.estado <> 'borrador' or public.tiene_permiso('rifas.ver'))));
create policy numeros_lectura on public.numeros for select to anon, authenticated
  using (exists (select 1 from public.rifas r where r.id = rifa_id and (r.estado <> 'borrador' or public.tiene_permiso('rifas.ver'))));
create policy config_lectura on public.configuraciones for select to anon, authenticated
  using (publica or public.es_usuario_admin());
-- sorteos: la semilla sólo se escribe al ejecutar; antes sólo hay compromiso (hash)
create policy sorteos_lectura on public.sorteos for select to anon, authenticated
  using (exists (select 1 from public.rifas r where r.id = rifa_id and r.estado <> 'borrador'));

-- ---------------------------------------------------------------------
-- Escritura administrativa directa (protegida además por triggers)
-- ---------------------------------------------------------------------
grant insert, update, delete on public.rifas to authenticated;
grant usage on sequence public.rifa_correlativo_seq to authenticated;
grant insert, update, delete on public.premios to authenticated;
grant update (valor, updated_by) on public.configuraciones to authenticated;

create policy rifas_insertar on public.rifas for insert to authenticated
  with check (public.tiene_permiso('rifas.gestionar') and estado = 'borrador' and not venta_iniciada);
create policy rifas_actualizar on public.rifas for update to authenticated
  using (public.tiene_permiso('rifas.gestionar')) with check (public.tiene_permiso('rifas.gestionar'));
create policy rifas_eliminar on public.rifas for delete to authenticated
  using (public.tiene_permiso('rifas.gestionar') and estado = 'borrador');

create policy premios_escribir on public.premios for all to authenticated
  using (public.tiene_permiso('rifas.gestionar')) with check (public.tiene_permiso('rifas.gestionar'));

create policy config_actualizar on public.configuraciones for update to authenticated
  using (public.tiene_permiso('configuracion.gestionar')) with check (public.tiene_permiso('configuracion.gestionar'));

-- ---------------------------------------------------------------------
-- Lectura administrativa según permiso
-- ---------------------------------------------------------------------
grant select on public.roles, public.permisos, public.rol_permisos, public.usuarios,
               public.compradores, public.reservas, public.detalle_reservas, public.historial_reservas,
               public.pagos, public.comprobantes, public.transacciones_pasarela, public.notificaciones,
               public.participantes_sorteo, public.ganadores, public.entrega_premios, public.documentos,
               public.respaldos_drive, public.auditoria, public.bloqueos_numeros
      to authenticated;
grant insert, delete on public.rol_permisos to authenticated;
grant update (nombre, rol, activo) on public.usuarios to authenticated;

create policy roles_lectura on public.roles for select to authenticated using (public.es_usuario_admin());
create policy permisos_lectura on public.permisos for select to authenticated using (public.es_usuario_admin());
create policy rol_permisos_lectura on public.rol_permisos for select to authenticated using (public.es_usuario_admin());
create policy rol_permisos_insertar on public.rol_permisos for insert to authenticated
  with check (public.tiene_permiso('usuarios.gestionar') and rol <> 'superadmin');
create policy rol_permisos_eliminar on public.rol_permisos for delete to authenticated
  using (public.tiene_permiso('usuarios.gestionar') and rol <> 'superadmin');

create policy usuarios_lectura on public.usuarios for select to authenticated
  using (id = auth.uid() or public.tiene_permiso('usuarios.gestionar') or public.tiene_permiso('auditoria.ver'));
create policy usuarios_actualizar on public.usuarios for update to authenticated
  using (public.tiene_permiso('usuarios.gestionar')) with check (public.tiene_permiso('usuarios.gestionar'));

create policy compradores_lectura on public.compradores for select to authenticated
  using (public.tiene_permiso('compradores.ver'));
create policy reservas_lectura on public.reservas for select to authenticated
  using (public.tiene_permiso('compradores.ver') or public.tiene_permiso('pagos.ver'));
create policy detalle_lectura on public.detalle_reservas for select to authenticated
  using (public.tiene_permiso('compradores.ver') or public.tiene_permiso('pagos.ver'));
create policy historial_lectura on public.historial_reservas for select to authenticated
  using (public.tiene_permiso('compradores.ver') or public.tiene_permiso('pagos.ver'));
create policy pagos_lectura on public.pagos for select to authenticated using (public.tiene_permiso('pagos.ver'));
create policy comprobantes_lectura on public.comprobantes for select to authenticated using (public.tiene_permiso('pagos.ver'));
create policy tx_lectura on public.transacciones_pasarela for select to authenticated using (public.tiene_permiso('pagos.ver'));
create policy notif_lectura on public.notificaciones for select to authenticated
  using (public.tiene_permiso('notificaciones.gestionar') or public.tiene_permiso('auditoria.ver'));
create policy participantes_lectura on public.participantes_sorteo for select to authenticated
  using (public.tiene_permiso('sorteos.ejecutar') or public.tiene_permiso('reportes.ver'));
create policy ganadores_lectura on public.ganadores for select to authenticated
  using (public.tiene_permiso('sorteos.ejecutar') or public.tiene_permiso('reportes.ver') or public.tiene_permiso('premios.entregar'));
create policy entrega_lectura on public.entrega_premios for select to authenticated
  using (public.tiene_permiso('reportes.ver') or public.tiene_permiso('premios.entregar'));
create policy documentos_lectura on public.documentos for select to authenticated using (public.tiene_permiso('reportes.ver'));
create policy respaldos_lectura on public.respaldos_drive for select to authenticated
  using (public.tiene_permiso('drive.gestionar') or public.tiene_permiso('auditoria.ver'));
create policy auditoria_lectura on public.auditoria for select to authenticated using (public.tiene_permiso('auditoria.ver'));
create policy bloqueos_lectura on public.bloqueos_numeros for select to authenticated
  using (public.tiene_permiso('numeros.bloquear') or public.tiene_permiso('rifas.ver'));
-- integraciones y limites_solicitudes: SIN políticas => inaccesibles salvo service_role

-- ---------------------------------------------------------------------
-- Protección de usuarios administrativos
-- ---------------------------------------------------------------------
create or replace function interno.tg_usuario_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.id = auth.uid() and (new.rol <> old.rol or new.activo <> old.activo) then
    raise exception 'VALIDACION: no puede cambiar su propio rol ni desactivarse';
  end if;
  if new.rol = 'superadmin' and old.rol <> 'superadmin'
     and auth.uid() is not null
     and not exists (select 1 from public.usuarios where id = auth.uid() and rol = 'superadmin') then
    raise exception 'SIN_PERMISO: sólo un superadministrador puede otorgar ese rol';
  end if;
  if new.email <> old.email or new.id <> old.id then
    raise exception 'VALIDACION: el correo se cambia desde la autenticación';
  end if;
  return new;
end; $$;
create trigger tg_usuario_proteger before update on public.usuarios
  for each row execute function interno.tg_usuario_proteger();

-- Debe quedar siempre al menos una cuenta activa capaz de administrar usuarios
create or replace function interno.tg_usuario_minimo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.usuarios u join public.rol_permisos rp on rp.rol = u.rol
                  where u.activo and rp.permiso = 'usuarios.gestionar') then
    raise exception 'VALIDACION: debe existir al menos un administrador activo con gestión de usuarios';
  end if;
  return null;
end; $$;
create constraint trigger tg_usuario_minimo after update on public.usuarios
  deferrable initially deferred for each row execute function interno.tg_usuario_minimo();

-- ---------------------------------------------------------------------
-- Realtime: sólo la tabla numeros (sin datos personales) y rifas
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.numeros;
    alter publication supabase_realtime add table public.rifas;
  end if;
end $$;
