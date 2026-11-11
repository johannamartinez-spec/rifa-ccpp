-- =====================================================================
-- RIFA ONLINE CCPP — 0002 Seguridad, permisos, auditoría, inmutabilidad
-- =====================================================================

-- Esquema interno: NO expuesto por la API (PostgREST sólo expone "public").
create schema if not exists interno;
revoke all on schema interno from public;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

-- ¿El usuario autenticado tiene el permiso indicado?
-- Considera: usuario activo, rol con permiso y (si se exige) MFA nivel aal2.
create or replace function public.tiene_permiso(p_permiso text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.rol_permisos rp on rp.rol = u.rol
    where u.id = auth.uid()
      and u.activo
      and rp.permiso = p_permiso
  )
  and (
    coalesce((select (c.valor)::text::boolean from public.configuraciones c
              where c.clave = 'seguridad.mfa_obligatorio'), false) = false
    or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;

create or replace function public.es_usuario_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.activo)
  and (
    coalesce((select (c.valor)::text::boolean from public.configuraciones c
              where c.clave = 'seguridad.mfa_obligatorio'), false) = false
    or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;

-- Lanza excepción si no hay permiso (usar dentro de funciones RPC)
create or replace function interno.exigir_permiso(p_permiso text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NO_AUTENTICADO' using errcode = '42501';
  end if;
  if not public.tiene_permiso(p_permiso) then
    raise exception 'SIN_PERMISO: %', p_permiso using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Permisos del usuario actual (para que el frontend arme el menú;
-- la autorización real SIEMPRE se valida en el servidor)
create or replace function public.mis_permisos()
returns table (permiso text, rol text, nombre text, mfa_obligatorio boolean, aal text)
language sql
stable
security definer
set search_path = ''
as $$
  select rp.permiso, u.rol, u.nombre,
         coalesce((select (c.valor)::text::boolean from public.configuraciones c
                   where c.clave = 'seguridad.mfa_obligatorio'), false),
         coalesce(auth.jwt() ->> 'aal', 'aal1')
  from public.usuarios u
  join public.rol_permisos rp on rp.rol = u.rol
  where u.id = auth.uid() and u.activo;
$$;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function interno.ip_hash()
returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.digest(
    'ccpp:' || coalesce(
      split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
      'sin-ip'), 'sha256'), 'hex');
$$;

-- Limitador por ventana fija. Devuelve true si se permite.
create or replace function interno.consumir_limite(p_clave text, p_max integer, p_ventana_segundos integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicio timestamptz := to_timestamp(floor(extract(epoch from now()) / p_ventana_segundos) * p_ventana_segundos);
  v_cont integer;
begin
  insert into public.limites_solicitudes as l (clave, ventana_inicio, contador)
  values (p_clave, v_inicio, 1)
  on conflict (clave, ventana_inicio) do update set contador = l.contador + 1
  returning contador into v_cont;
  -- limpieza oportunista
  if random() < 0.02 then
    delete from public.limites_solicitudes where ventana_inicio < now() - interval '1 day';
  end if;
  return v_cont <= p_max;
end;
$$;

create or replace function interno.actor_actual()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when auth.uid() is not null then 'admin'
    when current_setting('app.actor', true) in ('sistema','pasarela') then current_setting('app.actor', true)
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then 'sistema'
    else 'publico' end;
$$;

create or replace function interno.normalizar_telefono(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare d text := regexp_replace(coalesce(p,''), '[^0-9]', '', 'g');
begin
  if d ~ '^569[0-9]{8}$' then return '+' || d; end if;
  if d ~ '^9[0-9]{8}$' then return '+56' || d; end if;
  return null;
end;
$$;

-- Valida RUT chileno (módulo 11). Devuelve normalizado 12345678-K o null.
create or replace function interno.normalizar_rut(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  limpio text := upper(regexp_replace(coalesce(p,''), '[^0-9kK]', '', 'g'));
  cuerpo text; dv text; suma int := 0; mult int := 2; i int; res int; dv_calc text;
begin
  if length(limpio) < 8 or length(limpio) > 9 then return null; end if;
  cuerpo := left(limpio, length(limpio) - 1);
  dv := right(limpio, 1);
  if cuerpo !~ '^[0-9]+$' then return null; end if;
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::int * mult;
    mult := case when mult = 7 then 2 else mult + 1 end;
  end loop;
  res := 11 - (suma % 11);
  dv_calc := case res when 11 then '0' when 10 then 'K' else res::text end;
  if dv_calc <> dv then return null; end if;
  return ltrim(cuerpo, '0') || '-' || dv;
end;
$$;

-- Código de reserva no adivinable: CCPP-XXXX-XXXX (alfabeto sin 0/O/1/I)
create or replace function interno.generar_codigo_reserva()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(8);
  s text := '';
  i int;
begin
  for i in 0..7 loop
    s := s || substr(alfabeto, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return 'CCPP-' || substr(s, 1, 4) || '-' || substr(s, 5, 4);
end;
$$;

create or replace function interno.config(p_clave text, p_defecto jsonb default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select valor from public.configuraciones where clave = p_clave), p_defecto);
$$;

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function interno.tg_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

create trigger tg_upd before update on public.usuarios for each row execute function interno.tg_updated_at();
create trigger tg_upd before update on public.rifas for each row execute function interno.tg_updated_at();
create trigger tg_upd before update on public.numeros for each row execute function interno.tg_updated_at();
create trigger tg_upd before update on public.compradores for each row execute function interno.tg_updated_at();
create trigger tg_upd before update on public.reservas for each row execute function interno.tg_updated_at();
create trigger tg_upd before update on public.configuraciones for each row execute function interno.tg_updated_at();
create trigger tg_upd before update on public.transacciones_pasarela for each row execute function interno.tg_updated_at();

-- ---------------------------------------------------------------------
-- Auditoría genérica
-- ---------------------------------------------------------------------
create or replace function interno.tg_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  -- no registrar cambios triviales de updated_at
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;
  -- nunca guardar tokens cifrados en la bitácora
  if tg_table_name = 'integraciones' then
    v_old := v_old - 'token_cifrado' - 'oauth_state';
    v_new := v_new - 'token_cifrado' - 'oauth_state';
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'clave', v_old ->> 'clave',
                   v_new ->> 'proveedor', v_old ->> 'proveedor');
  insert into public.auditoria (usuario_id, usuario_email, actor, tabla, registro_id, operacion, datos_anteriores, datos_nuevos)
  values (auth.uid(), auth.jwt() ->> 'email', interno.actor_actual(), tg_table_name, v_id, tg_op, v_old, v_new);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['usuarios','rol_permisos','configuraciones','rifas','premios','bloqueos_numeros',
                           'compradores','reservas','pagos','comprobantes','sorteos','ganadores',
                           'entrega_premios','documentos','integraciones','transacciones_pasarela']
  loop
    execute format('create trigger tg_auditoria after insert or update or delete on public.%I
                    for each row execute function interno.tg_auditar()', t);
  end loop;
end $$;

-- Registro de acciones de negocio (p. ej. "APROBAR_PAGO")
create or replace function interno.auditar_accion(p_tabla text, p_registro text, p_accion text, p_datos jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.auditoria (usuario_id, usuario_email, actor, tabla, registro_id, operacion, datos_nuevos)
  values (auth.uid(), auth.jwt() ->> 'email', interno.actor_actual(), p_tabla, p_registro, p_accion, p_datos);
$$;

-- ---------------------------------------------------------------------
-- Inmutabilidad
-- ---------------------------------------------------------------------
create or replace function interno.tg_inmutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'REGISTRO_INMUTABLE: la tabla % no admite %', tg_table_name, tg_op using errcode = '42501';
end; $$;

create trigger tg_inmutable before update or delete on public.auditoria
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before update or delete on public.historial_reservas
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before update or delete on public.participantes_sorteo
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before update or delete on public.ganadores
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before update or delete on public.entrega_premios
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before delete on public.pagos
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before delete on public.reservas
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before delete on public.comprobantes
  for each row execute function interno.tg_inmutable();
create trigger tg_inmutable before delete on public.sorteos
  for each row execute function interno.tg_inmutable();

-- Sorteo: sólo se permite pasar de padron_congelado -> ejecutado una vez,
-- y registrar la ruta del acta una única vez.
create or replace function interno.tg_sorteo_proteger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.estado = 'ejecutado' then
    if (to_jsonb(new) - 'acta_path') <> (to_jsonb(old) - 'acta_path')
       or (old.acta_path is not null and new.acta_path is distinct from old.acta_path) then
      raise exception 'SORTEO_INMUTABLE: un sorteo ejecutado no puede modificarse' using errcode = '42501';
    end if;
    return new;
  end if;
  -- padron_congelado: no se puede alterar el padrón ni el compromiso
  if new.padron_hash <> old.padron_hash or new.semilla_compromiso <> old.semilla_compromiso
     or new.total_participantes <> old.total_participantes or new.rifa_id <> old.rifa_id
     or new.cantidad_ganadores <> old.cantidad_ganadores
     or new.permitir_repetidos <> old.permitir_repetidos then
    raise exception 'SORTEO_INMUTABLE: el padrón congelado no puede alterarse' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger tg_sorteo_proteger before update on public.sorteos
  for each row execute function interno.tg_sorteo_proteger();
