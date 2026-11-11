-- =====================================================================
-- RIFA ONLINE CCPP — 0003 Reglas de negocio: rifas, reservas y pagos
-- =====================================================================

-- ---------------------------------------------------------------------
-- Rifas: generación de números y protección contra cambios destructivos
-- ---------------------------------------------------------------------
create or replace function interno.tg_rifa_generar_numeros()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.numero_inicial <> old.numero_inicial or new.numero_final <> old.numero_final then
    -- eliminar números fuera de rango (sólo posible si nunca se reservaron: FK restrict)
    if tg_op = 'UPDATE' then
      delete from public.numeros n
       where n.rifa_id = new.id
         and (n.numero < new.numero_inicial or n.numero > new.numero_final)
         and n.estado = 'disponible';
    end if;
    insert into public.numeros (rifa_id, numero)
    select new.id, g from generate_series(new.numero_inicial, new.numero_final) g
    on conflict (rifa_id, numero) do nothing;
  end if;
  return new;
end; $$;

create trigger tg_rifa_numeros after insert or update of numero_inicial, numero_final on public.rifas
  for each row execute function interno.tg_rifa_generar_numeros();

create or replace function interno.tg_rifa_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tiene_reservas boolean;
begin
  if tg_op = 'DELETE' then
    if old.venta_iniciada or old.estado <> 'borrador' then
      raise exception 'RIFA_PROTEGIDA: sólo se pueden eliminar rifas en borrador sin ventas';
    end if;
    delete from public.numeros where rifa_id = old.id;
    delete from public.premios where rifa_id = old.id;
    return old;
  end if;

  v_tiene_reservas := exists (select 1 from public.detalle_reservas d where d.rifa_id = new.id);

  -- campos de sistema
  if new.codigo <> old.codigo or new.created_at <> old.created_at then
    raise exception 'RIFA_PROTEGIDA: código y fecha de creación no son editables';
  end if;
  if old.venta_iniciada and not new.venta_iniciada then
    raise exception 'RIFA_PROTEGIDA: no se puede desmarcar el inicio de venta';
  end if;
  if new.venta_iniciada and not old.venta_iniciada and not v_tiene_reservas then
    raise exception 'RIFA_PROTEGIDA: venta_iniciada sólo se marca con la primera reserva';
  end if;

  -- cambios destructivos tras iniciar la venta
  if old.venta_iniciada or v_tiene_reservas then
    if new.precio_numero <> old.precio_numero then
      raise exception 'RIFA_PROTEGIDA: no se puede cambiar el precio con ventas iniciadas';
    end if;
    if new.numero_inicial <> old.numero_inicial or new.numero_final < old.numero_final then
      raise exception 'RIFA_PROTEGIDA: con ventas iniciadas sólo se puede ampliar el número final';
    end if;
  end if;

  -- transiciones de estado
  if new.estado <> old.estado then
    if not (
      (old.estado = 'borrador' and new.estado = 'activa') or
      (old.estado = 'activa'   and new.estado in ('pausada','cerrada')) or
      (old.estado = 'pausada'  and new.estado in ('activa','cerrada')) or
      (old.estado = 'cerrada'  and new.estado = 'activa'
         and not exists (select 1 from public.sorteos s where s.rifa_id = new.id)) or
      (old.estado = 'cerrada'  and new.estado = 'sorteada'
         and exists (select 1 from public.sorteos s where s.rifa_id = new.id and s.estado = 'ejecutado'))
    ) then
      raise exception 'TRANSICION_INVALIDA: rifa % -> %', old.estado, new.estado;
    end if;
    if new.estado = 'activa' and old.estado = 'borrador' then
      if new.fecha_sorteo is null or coalesce(trim(new.bases),'') = '' or coalesce(trim(new.info_pago),'') = '' then
        raise exception 'RIFA_INCOMPLETA: para publicar se requiere fecha de sorteo, bases e instrucciones de pago';
      end if;
    end if;
    if new.estado = 'cerrada' then
      new.ventas_cerradas_at := now();
    elsif new.estado = 'activa' then
      new.ventas_cerradas_at := null;
    end if;
  end if;

  if old.estado = 'sorteada' and (to_jsonb(new) - 'updated_at' - 'descripcion' - 'afiche_path' - 'contacto')
                               <> (to_jsonb(old) - 'updated_at' - 'descripcion' - 'afiche_path' - 'contacto') then
    raise exception 'RIFA_PROTEGIDA: una rifa sorteada sólo admite cambios descriptivos';
  end if;
  return new;
end; $$;

create trigger tg_rifa_proteger before update or delete on public.rifas
  for each row execute function interno.tg_rifa_proteger();

-- Premios: no se pueden eliminar ni reordenar después de congelar el padrón
create or replace function interno.tg_premio_proteger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rifa uuid := coalesce(new.rifa_id, old.rifa_id);
begin
  if exists (select 1 from public.sorteos s where s.rifa_id = v_rifa)
     and current_setting('app.borrando_rifa', true) is distinct from '1' then
    if tg_op = 'DELETE' or new.posicion <> old.posicion or new.rifa_id <> old.rifa_id then
      raise exception 'PREMIO_PROTEGIDO: el sorteo ya tiene padrón congelado';
    end if;
  end if;
  return coalesce(new, old);
end; $$;
create trigger tg_premio_proteger before update or delete on public.premios
  for each row execute function interno.tg_premio_proteger();

-- ---------------------------------------------------------------------
-- Reservas: máquina de estados validada en la base de datos
-- ---------------------------------------------------------------------
create or replace function interno.tg_reserva_validar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rifa_id <> old.rifa_id or new.comprador_id <> old.comprador_id or new.codigo <> old.codigo
     or new.monto_total <> old.monto_total or new.cantidad <> old.cantidad then
    raise exception 'RESERVA_PROTEGIDA: datos de la reserva no son modificables';
  end if;
  if new.estado = old.estado then return new; end if;

  if not (
    (old.estado in ('reservado','pendiente_pago') and new.estado in ('comprobante_enviado','expirado','cancelado','pagado')) or
    (old.estado = 'comprobante_enviado' and new.estado in ('en_revision','pagado','rechazado','pendiente_pago','cancelado')) or
    (old.estado = 'en_revision' and new.estado in ('pagado','rechazado','pendiente_pago','cancelado','comprobante_enviado')) or
    (old.estado = 'pagado' and new.estado in ('cancelado','pendiente_pago'))
  ) then
    raise exception 'TRANSICION_INVALIDA: reserva % -> %', old.estado, new.estado;
  end if;

  -- No se puede marcar como pagada sin una validación autorizada registrada
  if new.estado = 'pagado' then
    if not exists (
      select 1 from public.pagos p
      where p.reserva_id = new.id and p.estado = 'aprobado' and p.validado_at is not null
        and (
          (p.validado_por is not null and exists (
              select 1 from public.usuarios u join public.rol_permisos rp on rp.rol = u.rol
              where u.id = p.validado_por and u.activo and rp.permiso = 'pagos.validar'))
          or (p.metodo = 'webpay' and p.referencia_externa is not null
              and exists (select 1 from public.transacciones_pasarela t
                          where t.reserva_id = new.id and t.token = p.referencia_externa and t.estado = 'autorizada'))
        )
    ) then
      raise exception 'PAGO_NO_VALIDADO: la reserva no tiene un pago aprobado por un usuario autorizado';
    end if;
  end if;

  -- Revertir un pago sólo antes del sorteo
  if old.estado = 'pagado' and exists (select 1 from public.sorteos s where s.rifa_id = new.rifa_id) then
    raise exception 'RESERVA_PROTEGIDA: el padrón del sorteo ya fue congelado';
  end if;
  return new;
end; $$;

create trigger tg_reserva_validar before update on public.reservas
  for each row execute function interno.tg_reserva_validar();

-- ---------------------------------------------------------------------
-- Notificaciones: encolado (el envío lo hace la función Edge)
-- ---------------------------------------------------------------------
create or replace function interno.encolar_notificacion(p_reserva_id uuid, p_tipo text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_tipos jsonb := interno.config('notificaciones.tipos', '{}'::jsonb);
  v_datos jsonb;
begin
  if coalesce((v_tipos ->> p_tipo)::boolean, true) = false then return; end if;

  select re.id, re.codigo, re.monto_total, re.expira_at, re.estado, re.motivo, re.rifa_id,
         c.nombre, c.email, c.telefono, ri.nombre as rifa_nombre, ri.info_pago, ri.fecha_sorteo,
         ri.colegio, ri.centro_padres,
         (select array_agg(d.numero order by d.numero) from public.detalle_reservas d where d.reserva_id = re.id) as numeros
    into r
    from public.reservas re
    join public.compradores c on c.id = re.comprador_id
    join public.rifas ri on ri.id = re.rifa_id
   where re.id = p_reserva_id;
  if not found then return; end if;

  v_datos := jsonb_build_object(
    'codigo', r.codigo, 'nombre', r.nombre, 'rifa', r.rifa_nombre, 'colegio', r.colegio,
    'centro_padres', r.centro_padres, 'numeros', to_jsonb(r.numeros), 'monto_total', r.monto_total,
    'expira_at', r.expira_at, 'motivo', r.motivo, 'info_pago', r.info_pago,
    'fecha_sorteo', r.fecha_sorteo) || coalesce(p_extra, '{}'::jsonb);

  if r.email is not null and coalesce((interno.config('notificaciones.email_activo','true'::jsonb))::text::boolean, true) then
    insert into public.notificaciones (rifa_id, reserva_id, tipo, canal, destinatario, datos)
    values (r.rifa_id, r.id, p_tipo, 'email', r.email, v_datos)
    on conflict do nothing;
  end if;
  if coalesce((interno.config('notificaciones.whatsapp_activo','false'::jsonb))::text::boolean, false) then
    insert into public.notificaciones (rifa_id, reserva_id, tipo, canal, destinatario, datos)
    values (r.rifa_id, r.id, p_tipo, 'whatsapp', r.telefono, v_datos)
    on conflict do nothing;
  end if;
end; $$;

-- ---------------------------------------------------------------------
-- Cambio de estado centralizado
-- ---------------------------------------------------------------------
create or replace function interno.cambiar_estado_reserva(
  p_reserva_id uuid,
  p_nuevo public.estado_reserva,
  p_detalle text,
  p_liberar boolean,                         -- true: los números vuelven a disponible
  p_estado_numeros public.estado_numero,     -- estado de números si no se liberan
  p_expira_at timestamptz default null,
  p_motivo text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ant public.estado_reserva;
begin
  select estado into v_ant from public.reservas where id = p_reserva_id for update;
  update public.reservas
     set estado = p_nuevo,
         expira_at = case when p_nuevo in ('reservado','pendiente_pago') then p_expira_at else null end,
         motivo = coalesce(p_motivo, motivo)
   where id = p_reserva_id;

  if p_liberar then
    update public.numeros n set estado = 'disponible'
      from public.detalle_reservas d
     where d.reserva_id = p_reserva_id and d.activo and d.numero_id = n.id;
    update public.detalle_reservas set activo = false where reserva_id = p_reserva_id and activo;
  elsif p_estado_numeros is not null then
    update public.numeros n set estado = p_estado_numeros
      from public.detalle_reservas d
     where d.reserva_id = p_reserva_id and d.activo and d.numero_id = n.id;
  end if;

  insert into public.historial_reservas (reserva_id, estado_anterior, estado_nuevo, usuario_id, actor, detalle)
  values (p_reserva_id, v_ant, p_nuevo, auth.uid(), interno.actor_actual(), p_detalle);
end; $$;

-- ---------------------------------------------------------------------
-- Expiración de reservas vencidas (llamada por pg_cron y de forma perezosa)
-- ---------------------------------------------------------------------
create or replace function interno.expirar_reservas(p_reserva_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.reservas
     where estado in ('reservado','pendiente_pago')
       and expira_at <= now()
       and (p_reserva_ids is null or id = any(p_reserva_ids))
     order by expira_at
     for update skip locked
  loop
    perform interno.cambiar_estado_reserva(r.id, 'expirado', 'Plazo de pago vencido', true, null);
    perform interno.encolar_notificacion(r.id, 'reserva_expirada');
    n := n + 1;
  end loop;
  return n;
end; $$;

-- Pública para cron / servicio
create or replace function public.liberar_reservas_vencidas()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.actor', 'sistema', true);
  return interno.expirar_reservas(null);
end; $$;

create or replace function public.encolar_recordatorios()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_min integer := coalesce((interno.config('notificaciones.recordatorio_minutos_antes','10'::jsonb))::text::integer, 10);
  r record; n integer := 0;
begin
  perform set_config('app.actor', 'sistema', true);
  for r in
    select re.id from public.reservas re
      join public.compradores c on c.id = re.comprador_id
     where re.estado in ('reservado','pendiente_pago')
       and re.expira_at > now()
       and re.expira_at <= now() + make_interval(mins => v_min)
       and re.created_at <= now() - make_interval(mins => 2)
       and not exists (select 1 from public.notificaciones x where x.reserva_id = re.id and x.tipo = 'recordatorio_pago')
  loop
    perform interno.encolar_notificacion(r.id, 'recordatorio_pago');
    n := n + 1;
  end loop;
  return n;
end; $$;

-- ---------------------------------------------------------------------
-- RESERVA PÚBLICA (transaccional, a prueba de concurrencia)
-- ---------------------------------------------------------------------
create or replace function public.reservar_numeros(
  p_rifa_id   uuid,
  p_numeros   integer[],
  p_nombre    text,
  p_curso     text,
  p_telefono  text,
  p_email     text default null,
  p_rut       text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rifa       public.rifas%rowtype;
  v_numeros    integer[];
  v_tel        text := interno.normalizar_telefono(p_telefono);
  v_nombre     text := regexp_replace(trim(coalesce(p_nombre,'')), '\s+', ' ', 'g');
  v_curso      text := regexp_replace(trim(coalesce(p_curso,'')), '\s+', ' ', 'g');
  v_email      text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_rut        text := null;
  v_ip         text := interno.ip_hash();
  v_bloq       record;
  v_no_disp    integer[];
  v_inexist    integer[];
  v_comprador  uuid;
  v_reserva    uuid;
  v_codigo     text;
  v_expira     timestamptz;
  v_activas    integer;
  v_vencidas   uuid[];
  i            integer;
begin
  perform set_config('app.actor', 'publico', true);

  -- 1. Validación de entradas -------------------------------------------
  if p_numeros is null or cardinality(p_numeros) = 0 then
    raise exception 'VALIDACION: debe seleccionar al menos un número';
  end if;
  select array_agg(distinct x order by x) into v_numeros from unnest(p_numeros) x;
  if cardinality(v_numeros) <> cardinality(p_numeros) then
    raise exception 'VALIDACION: números repetidos en la selección';
  end if;
  if length(v_nombre) < 3 or length(v_nombre) > 120 or v_nombre !~ '^[[:alpha:] .''-]+$' or v_nombre !~ ' ' then
    raise exception 'VALIDACION: ingrese nombre y apellido válidos';
  end if;
  if length(v_curso) < 1 or length(v_curso) > 40 or v_curso !~ '^[[:alnum:] °º.-]+$' then
    raise exception 'VALIDACION: curso inválido';
  end if;
  if v_tel is null then
    raise exception 'VALIDACION: teléfono celular chileno inválido (ej: +56 9 1234 5678)';
  end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200) then
    raise exception 'VALIDACION: correo electrónico inválido';
  end if;

  -- 2. Rifa vigente (FOR SHARE: impide cierre concurrente) --------------
  select * into v_rifa from public.rifas where id = p_rifa_id for share;
  if not found then raise exception 'RIFA_NO_ENCONTRADA'; end if;
  if v_rifa.estado <> 'activa' or (v_rifa.cierre_ventas_at is not null and now() >= v_rifa.cierre_ventas_at) then
    raise exception 'RIFA_NO_DISPONIBLE: la venta de esta rifa no está abierta';
  end if;
  if cardinality(v_numeros) > v_rifa.max_numeros_reserva then
    raise exception 'VALIDACION: máximo % números por reserva', v_rifa.max_numeros_reserva;
  end if;
  if v_rifa.pedir_rut then
    v_rut := interno.normalizar_rut(p_rut);
    if v_rut is null then raise exception 'VALIDACION: RUT inválido'; end if;
  elsif p_rut is not null and trim(p_rut) <> '' then
    v_rut := interno.normalizar_rut(p_rut);  -- opcional
  end if;

  -- 3. Prevención de abuso ---------------------------------------------
  if not interno.consumir_limite('reserva:ip:' || v_ip, 20, 3600) then
    raise exception 'LIMITE_EXCEDIDO: demasiadas reservas desde esta conexión, intente más tarde';
  end if;
  if not interno.consumir_limite('reserva:tel:' || v_tel, 10, 3600) then
    raise exception 'LIMITE_EXCEDIDO: demasiadas reservas para este teléfono, intente más tarde';
  end if;
  select count(*) into v_activas
    from public.reservas re join public.compradores c on c.id = re.comprador_id
   where re.rifa_id = p_rifa_id and c.telefono = v_tel
     and re.estado in ('reservado','pendiente_pago') and re.expira_at > now();
  if v_activas >= v_rifa.max_reservas_activas_telefono then
    raise exception 'LIMITE_EXCEDIDO: este teléfono ya tiene % reservas sin pagar; envíe el comprobante o espere su vencimiento', v_activas;
  end if;

  -- 4. Liberación perezosa de reservas vencidas que bloquean estos números
  select array_agg(distinct d.reserva_id) into v_vencidas
    from public.detalle_reservas d
    join public.reservas re on re.id = d.reserva_id
    join public.numeros n on n.id = d.numero_id
   where n.rifa_id = p_rifa_id and n.numero = any(v_numeros) and d.activo
     and re.estado in ('reservado','pendiente_pago') and re.expira_at <= now();
  if v_vencidas is not null then
    perform interno.expirar_reservas(v_vencidas);
  end if;

  -- 5. Bloqueo de filas en orden ascendente (evita interbloqueos) -------
  v_no_disp := '{}'; v_inexist := v_numeros;
  for v_bloq in
    select n.id, n.numero, n.estado from public.numeros n
     where n.rifa_id = p_rifa_id and n.numero = any(v_numeros)
     order by n.numero
     for update
  loop
    v_inexist := array_remove(v_inexist, v_bloq.numero);
    if v_bloq.estado <> 'disponible' then
      v_no_disp := v_no_disp || v_bloq.numero;
    end if;
  end loop;
  if cardinality(v_inexist) > 0 then
    raise exception 'NUMEROS_INEXISTENTES: %', array_to_string(v_inexist, ', ');
  end if;
  if cardinality(v_no_disp) > 0 then
    raise exception 'NUMEROS_NO_DISPONIBLES: %', array_to_string(v_no_disp, ', ');
  end if;

  -- 6. Comprador ---------------------------------------------------------
  insert into public.compradores as c (nombre, rut, curso, telefono, email)
  values (v_nombre, v_rut, v_curso, v_tel, v_email)
  on conflict (telefono, lower(nombre)) do update
     set curso = excluded.curso,
         email = coalesce(excluded.email, c.email),
         rut = coalesce(excluded.rut, c.rut)
  returning id into v_comprador;

  -- 7. Reserva con código único -----------------------------------------
  v_expira := now() + make_interval(mins => v_rifa.minutos_reserva);
  for i in 1..5 loop
    v_codigo := interno.generar_codigo_reserva();
    begin
      insert into public.reservas (codigo, rifa_id, comprador_id, estado, cantidad, precio_unitario, monto_total, expira_at, origen_ip_hash)
      values (v_codigo, p_rifa_id, v_comprador, 'reservado', cardinality(v_numeros), v_rifa.precio_numero,
              cardinality(v_numeros) * v_rifa.precio_numero, v_expira, v_ip)
      returning id into v_reserva;
      exit;
    exception when unique_violation then
      if i = 5 then raise; end if;
    end;
  end loop;

  -- 8. Detalle + estado de números (el índice único parcial es la última barrera)
  insert into public.detalle_reservas (reserva_id, numero_id, rifa_id, numero)
  select v_reserva, n.id, p_rifa_id, n.numero
    from public.numeros n where n.rifa_id = p_rifa_id and n.numero = any(v_numeros);

  update public.numeros set estado = 'reservado'
   where rifa_id = p_rifa_id and numero = any(v_numeros);

  if not v_rifa.venta_iniciada then
    update public.rifas set venta_iniciada = true where id = p_rifa_id;
  end if;

  insert into public.historial_reservas (reserva_id, estado_anterior, estado_nuevo, actor, detalle)
  values (v_reserva, null, 'reservado', 'publico', 'Reserva creada desde la página pública');

  perform interno.encolar_notificacion(v_reserva, 'reserva_confirmada');

  return jsonb_build_object(
    'codigo', v_codigo,
    'numeros', to_jsonb(v_numeros),
    'cantidad', cardinality(v_numeros),
    'precio_unitario', v_rifa.precio_numero,
    'monto_total', cardinality(v_numeros) * v_rifa.precio_numero,
    'expira_at', v_expira,
    'minutos_reserva', v_rifa.minutos_reserva,
    'info_pago', v_rifa.info_pago,
    'rifa', v_rifa.nombre
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Consulta pública de una reserva (código + teléfono)
-- ---------------------------------------------------------------------
create or replace function public.consultar_reserva(p_codigo text, p_telefono text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tel text := interno.normalizar_telefono(p_telefono);
  v_cod text := upper(trim(coalesce(p_codigo,'')));
  v_res record;
begin
  perform set_config('app.actor', 'publico', true);
  if not interno.consumir_limite('consulta:ip:' || interno.ip_hash(), 40, 600) then
    raise exception 'LIMITE_EXCEDIDO: demasiadas consultas, intente en unos minutos';
  end if;

  select re.id into v_res
    from public.reservas re join public.compradores c on c.id = re.comprador_id
   where re.codigo = v_cod and c.telefono = v_tel;
  if not found then
    raise exception 'RESERVA_NO_ENCONTRADA: verifique el código y el teléfono';
  end if;

  perform interno.expirar_reservas(array[v_res.id]);

  return (
    select jsonb_build_object(
      'codigo', re.codigo,
      'estado', re.estado,
      'rifa_id', ri.id,
      'rifa', ri.nombre,
      'fecha_sorteo', ri.fecha_sorteo,
      'nombre', split_part(c.nombre, ' ', 1),
      'numeros', (select jsonb_agg(d.numero order by d.numero) from public.detalle_reservas d where d.reserva_id = re.id),
      'monto_total', re.monto_total,
      'expira_at', re.expira_at,
      'motivo', case when re.estado in ('rechazado','cancelado','pendiente_pago') then re.motivo end,
      'info_pago', ri.info_pago,
      'puede_subir_comprobante', re.estado in ('reservado','pendiente_pago','comprobante_enviado'),
      'comprobantes', coalesce((select jsonb_agg(jsonb_build_object(
                          'fecha', co.created_at, 'estado', co.estado_revision, 'motivo', co.motivo_rechazo)
                          order by co.created_at)
                        from public.comprobantes co where co.reserva_id = re.id), '[]'::jsonb),
      'creada_at', re.created_at
    )
    from public.reservas re
    join public.compradores c on c.id = re.comprador_id
    join public.rifas ri on ri.id = re.rifa_id
    where re.id = v_res.id
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Registro de comprobante (SÓLO service_role: lo invoca la función Edge
-- después de validar y guardar el archivo en el bucket privado)
-- ---------------------------------------------------------------------
create or replace function public.registrar_comprobante(
  p_codigo text, p_telefono text, p_storage_path text, p_nombre_original text,
  p_mime text, p_tamano integer, p_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res record;
  v_comp uuid;
  v_ruta text;
  v_anio text;
begin
  perform set_config('app.actor', 'publico', true);
  select re.*, ri.codigo as rifa_codigo, ri.created_at as rifa_creada
    into v_res
    from public.reservas re
    join public.compradores c on c.id = re.comprador_id
    join public.rifas ri on ri.id = re.rifa_id
   where re.codigo = upper(trim(p_codigo)) and c.telefono = interno.normalizar_telefono(p_telefono)
   for update of re;
  if not found then raise exception 'RESERVA_NO_ENCONTRADA'; end if;

  perform interno.expirar_reservas(array[v_res.id]);
  select estado into v_res.estado from public.reservas where id = v_res.id;

  if v_res.estado not in ('reservado','pendiente_pago','comprobante_enviado') then
    raise exception 'RESERVA_NO_ADMITE_COMPROBANTE: estado actual %', v_res.estado;
  end if;
  if (select count(*) from public.comprobantes where reserva_id = v_res.id) >= 5 then
    raise exception 'LIMITE_EXCEDIDO: máximo 5 comprobantes por reserva';
  end if;

  update public.comprobantes set estado_revision = 'reemplazado'
   where reserva_id = v_res.id and estado_revision = 'pendiente';

  insert into public.comprobantes (reserva_id, rifa_id, comprador_id, storage_path, nombre_original, mime, tamano_bytes, sha256)
  values (v_res.id, v_res.rifa_id, v_res.comprador_id, p_storage_path, left(p_nombre_original, 255), p_mime, p_tamano, p_sha256)
  returning id into v_comp;

  -- un único pago pendiente por reserva, apuntando al último comprobante
  insert into public.pagos (reserva_id, metodo, monto, estado, comprobante_id)
  values (v_res.id, 'transferencia', v_res.monto_total, 'pendiente', v_comp)
  on conflict (reserva_id) where estado = 'pendiente' do update set comprobante_id = excluded.comprobante_id;

  if v_res.estado <> 'comprobante_enviado' then
    perform interno.cambiar_estado_reserva(v_res.id, 'comprobante_enviado', 'Comprobante recibido', false, 'pendiente_pago');
  else
    insert into public.historial_reservas (reserva_id, estado_anterior, estado_nuevo, actor, detalle)
    values (v_res.id, v_res.estado, v_res.estado, 'publico', 'Comprobante reemplazado por el comprador');
  end if;

  -- encolar respaldo en Drive
  v_anio := to_char(v_res.rifa_creada at time zone 'America/Santiago', 'YYYY');
  insert into public.respaldos_drive (rifa_id, tipo_evidencia, entidad, entidad_id, codigo_reserva, storage_bucket,
                                      storage_path, nombre_archivo, carpeta_drive, sha256)
  values (v_res.rifa_id, 'COMPROBANTES', 'comprobante', v_comp, v_res.codigo, 'comprobantes', p_storage_path,
          v_res.rifa_codigo || '_' || to_char(now() at time zone 'America/Santiago', 'YYYYMMDD-HH24MISS') || '_' ||
            v_res.codigo || '_COMPROBANTE_' || left(v_comp::text, 8) ||
            case p_mime when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end,
          'CENTRO_DE_PADRES/RIFAS/' || v_anio || '/' || v_res.rifa_codigo || '/COMPROBANTES', p_sha256)
  on conflict (storage_bucket, storage_path) do nothing;

  return jsonb_build_object('comprobante_id', v_comp, 'estado', 'comprobante_enviado');
end;
$$;

-- ---------------------------------------------------------------------
-- Operaciones de Tesorería
-- ---------------------------------------------------------------------
create or replace function public.iniciar_revision(p_reserva_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_estado public.estado_reserva;
begin
  perform interno.exigir_permiso('pagos.validar');
  select estado into v_estado from public.reservas where id = p_reserva_id for update;
  if v_estado is null then raise exception 'RESERVA_NO_ENCONTRADA'; end if;
  if v_estado = 'comprobante_enviado' then
    perform interno.cambiar_estado_reserva(p_reserva_id, 'en_revision', 'Tesorería inició la revisión', false, 'pendiente_pago');
  end if;
end; $$;

create or replace function public.aprobar_pago(p_reserva_id uuid, p_observacion text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := interno.exigir_permiso('pagos.validar');
  v_res public.reservas%rowtype;
  v_pago public.pagos%rowtype;
begin
  select * into v_res from public.reservas where id = p_reserva_id for update;
  if not found then raise exception 'RESERVA_NO_ENCONTRADA'; end if;
  if v_res.estado not in ('comprobante_enviado','en_revision') then
    raise exception 'ESTADO_INVALIDO: sólo se aprueban reservas con comprobante (estado actual %)', v_res.estado;
  end if;
  select * into v_pago from public.pagos where reserva_id = p_reserva_id and estado = 'pendiente' for update;
  if not found then raise exception 'PAGO_NO_ENCONTRADO'; end if;

  update public.pagos set estado = 'aprobado', validado_por = v_uid, validado_at = now(),
         observacion = nullif(trim(coalesce(p_observacion,'')), '')
   where id = v_pago.id;
  update public.comprobantes set estado_revision = 'aprobado', revisado_por = v_uid, revisado_at = now()
   where id = v_pago.comprobante_id;
  perform interno.cambiar_estado_reserva(p_reserva_id, 'pagado', 'Pago aprobado por Tesorería', false, 'vendido');
  perform interno.encolar_notificacion(p_reserva_id, 'pago_confirmado');
  perform interno.auditar_accion('reservas', p_reserva_id::text, 'APROBAR_PAGO',
          jsonb_build_object('pago_id', v_pago.id, 'monto', v_pago.monto));
  return jsonb_build_object('reserva_id', p_reserva_id, 'estado', 'pagado');
end; $$;

-- Confirmación manual (pago en efectivo o transferencia verificada en cartola sin comprobante)
create or replace function public.confirmar_pago_manual(
  p_reserva_id uuid, p_metodo public.metodo_pago, p_referencia text, p_observacion text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := interno.exigir_permiso('pagos.validar');
  v_res public.reservas%rowtype;
  v_pago uuid;
begin
  if p_metodo = 'webpay' then raise exception 'VALIDACION: Webpay se confirma sólo desde la pasarela'; end if;
  if length(trim(coalesce(p_observacion,''))) < 10 then
    raise exception 'VALIDACION: debe justificar la confirmación manual (mínimo 10 caracteres)';
  end if;
  select * into v_res from public.reservas where id = p_reserva_id for update;
  if not found then raise exception 'RESERVA_NO_ENCONTRADA'; end if;
  if v_res.estado not in ('reservado','pendiente_pago','comprobante_enviado','en_revision') then
    raise exception 'ESTADO_INVALIDO: estado actual %', v_res.estado;
  end if;
  if v_res.estado in ('reservado','pendiente_pago') and v_res.expira_at <= now() then
    perform interno.expirar_reservas(array[p_reserva_id]);
    raise exception 'RESERVA_EXPIRADA: la reserva venció; el comprador debe reservar nuevamente';
  end if;

  update public.pagos set estado = 'aprobado', validado_por = v_uid, validado_at = now(), metodo = p_metodo,
         referencia_externa = nullif(trim(coalesce(p_referencia,'')),''), observacion = trim(p_observacion)
   where reserva_id = p_reserva_id and estado = 'pendiente'
  returning id into v_pago;
  if v_pago is null then
    insert into public.pagos (reserva_id, metodo, monto, estado, referencia_externa, validado_por, validado_at, observacion)
    values (p_reserva_id, p_metodo, v_res.monto_total, 'aprobado', nullif(trim(coalesce(p_referencia,'')),''),
            v_uid, now(), trim(p_observacion))
    returning id into v_pago;
  else
    update public.comprobantes set estado_revision = 'aprobado', revisado_por = v_uid, revisado_at = now()
     where reserva_id = p_reserva_id and estado_revision = 'pendiente';
  end if;
  perform interno.cambiar_estado_reserva(p_reserva_id, 'pagado', 'Pago confirmado manualmente: ' || trim(p_observacion), false, 'vendido');
  perform interno.encolar_notificacion(p_reserva_id, 'pago_confirmado');
  perform interno.auditar_accion('reservas', p_reserva_id::text, 'CONFIRMAR_PAGO_MANUAL',
          jsonb_build_object('pago_id', v_pago, 'metodo', p_metodo, 'observacion', p_observacion));
  return jsonb_build_object('reserva_id', p_reserva_id, 'estado', 'pagado');
end; $$;

-- Rechazo: p_solicitar_nuevo=true mantiene los números y otorga un nuevo plazo;
-- false rechaza definitivamente y libera los números.
create or replace function public.rechazar_pago(p_reserva_id uuid, p_motivo text, p_solicitar_nuevo boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := interno.exigir_permiso('pagos.validar');
  v_res record;
  v_motivo text := trim(coalesce(p_motivo,''));
begin
  if length(v_motivo) < 5 then raise exception 'VALIDACION: indique el motivo del rechazo'; end if;
  select re.*, ri.minutos_reserva into v_res
    from public.reservas re join public.rifas ri on ri.id = re.rifa_id
   where re.id = p_reserva_id for update of re;
  if not found then raise exception 'RESERVA_NO_ENCONTRADA'; end if;
  if v_res.estado not in ('comprobante_enviado','en_revision') then
    raise exception 'ESTADO_INVALIDO: estado actual %', v_res.estado;
  end if;

  update public.pagos set estado = 'rechazado', validado_por = v_uid, validado_at = now(), motivo = v_motivo
   where reserva_id = p_reserva_id and estado = 'pendiente';
  update public.comprobantes set estado_revision = 'rechazado', revisado_por = v_uid, revisado_at = now(),
         motivo_rechazo = v_motivo
   where reserva_id = p_reserva_id and estado_revision = 'pendiente';

  if p_solicitar_nuevo then
    perform interno.cambiar_estado_reserva(p_reserva_id, 'pendiente_pago', 'Se solicitó nuevo comprobante: ' || v_motivo,
            false, 'reservado', now() + make_interval(mins => v_res.minutos_reserva), v_motivo);
    perform interno.encolar_notificacion(p_reserva_id, 'nuevo_comprobante_solicitado');
  else
    perform interno.cambiar_estado_reserva(p_reserva_id, 'rechazado', 'Pago rechazado: ' || v_motivo, true, null, null, v_motivo);
    perform interno.encolar_notificacion(p_reserva_id, 'pago_rechazado');
  end if;
  perform interno.auditar_accion('reservas', p_reserva_id::text, 'RECHAZAR_PAGO',
          jsonb_build_object('motivo', v_motivo, 'solicitar_nuevo', p_solicitar_nuevo));
  return jsonb_build_object('reserva_id', p_reserva_id,
                            'estado', case when p_solicitar_nuevo then 'pendiente_pago' else 'rechazado' end);
end; $$;

create or replace function public.cancelar_reserva(p_reserva_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := interno.exigir_permiso('pagos.validar');
  v_estado public.estado_reserva;
  v_motivo text := trim(coalesce(p_motivo,''));
begin
  if length(v_motivo) < 5 then raise exception 'VALIDACION: indique el motivo de la cancelación'; end if;
  select estado into v_estado from public.reservas where id = p_reserva_id for update;
  if v_estado is null then raise exception 'RESERVA_NO_ENCONTRADA'; end if;
  if v_estado not in ('reservado','pendiente_pago','comprobante_enviado','en_revision') then
    raise exception 'ESTADO_INVALIDO: no se puede cancelar una reserva en estado % (use "revertir pago" para pagadas)', v_estado;
  end if;
  update public.pagos set estado = 'rechazado', validado_por = v_uid, validado_at = now(), motivo = 'Cancelada: ' || v_motivo
   where reserva_id = p_reserva_id and estado = 'pendiente';
  update public.comprobantes set estado_revision = 'rechazado', revisado_por = v_uid, revisado_at = now(), motivo_rechazo = 'Reserva cancelada'
   where reserva_id = p_reserva_id and estado_revision = 'pendiente';
  perform interno.cambiar_estado_reserva(p_reserva_id, 'cancelado', 'Cancelada por Tesorería: ' || v_motivo, true, null, null, v_motivo);
  perform interno.encolar_notificacion(p_reserva_id, 'reserva_cancelada');
  return jsonb_build_object('reserva_id', p_reserva_id, 'estado', 'cancelado');
end; $$;

-- Ajuste: revertir un pago aprobado por error (sólo antes de congelar el padrón)
create or replace function public.revertir_pago(p_reserva_id uuid, p_motivo text, p_liberar boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := interno.exigir_permiso('pagos.validar');
  v_res record;
  v_motivo text := trim(coalesce(p_motivo,''));
begin
  if length(v_motivo) < 10 then raise exception 'VALIDACION: justifique el ajuste (mínimo 10 caracteres)'; end if;
  select re.*, ri.minutos_reserva into v_res from public.reservas re join public.rifas ri on ri.id = re.rifa_id
   where re.id = p_reserva_id for update of re;
  if not found then raise exception 'RESERVA_NO_ENCONTRADA'; end if;
  if v_res.estado <> 'pagado' then raise exception 'ESTADO_INVALIDO: sólo se revierten reservas pagadas'; end if;

  update public.pagos set estado = 'revertido', revertido_por = v_uid, revertido_at = now(),
         motivo = 'Ajuste: ' || v_motivo
   where reserva_id = p_reserva_id and estado = 'aprobado';
  if p_liberar then
    perform interno.cambiar_estado_reserva(p_reserva_id, 'cancelado', 'Pago revertido: ' || v_motivo, true, null, null, v_motivo);
  else
    perform interno.cambiar_estado_reserva(p_reserva_id, 'pendiente_pago', 'Pago revertido, se espera nuevo pago: ' || v_motivo,
            false, 'reservado', now() + make_interval(mins => v_res.minutos_reserva), v_motivo);
  end if;
  perform interno.auditar_accion('reservas', p_reserva_id::text, 'REVERTIR_PAGO',
          jsonb_build_object('motivo', v_motivo, 'liberar', p_liberar));
  return jsonb_build_object('reserva_id', p_reserva_id, 'estado', case when p_liberar then 'cancelado' else 'pendiente_pago' end);
end; $$;

-- Bloqueo administrativo de números disponibles
create or replace function public.bloquear_numeros(p_rifa_id uuid, p_numeros integer[], p_motivo text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := interno.exigir_permiso('numeros.bloquear'); n integer;
begin
  if length(trim(coalesce(p_motivo,''))) < 3 then raise exception 'VALIDACION: indique el motivo del bloqueo'; end if;
  with b as (
    update public.numeros set estado = 'bloqueado'
     where rifa_id = p_rifa_id and numero = any(p_numeros) and estado = 'disponible'
    returning id)
  insert into public.bloqueos_numeros (numero_id, motivo, bloqueado_por)
  select id, trim(p_motivo), v_uid from b
  on conflict (numero_id) do update set motivo = excluded.motivo, bloqueado_por = excluded.bloqueado_por, bloqueado_at = now();
  get diagnostics n = row_count;
  return n;
end; $$;

create or replace function public.desbloquear_numeros(p_rifa_id uuid, p_numeros integer[])
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform interno.exigir_permiso('numeros.bloquear');
  if exists (select 1 from public.sorteos where rifa_id = p_rifa_id) then
    raise exception 'RIFA_PROTEGIDA: padrón congelado';
  end if;
  delete from public.bloqueos_numeros b using public.numeros n
   where b.numero_id = n.id and n.rifa_id = p_rifa_id and n.numero = any(p_numeros);
  update public.numeros set estado = 'disponible'
   where rifa_id = p_rifa_id and numero = any(p_numeros) and estado = 'bloqueado';
  get diagnostics n = row_count;
  return n;
end; $$;

-- ---------------------------------------------------------------------
-- Webpay (preparado): confirmación SÓLO desde el servidor (service_role)
-- ---------------------------------------------------------------------
create or replace function public.registrar_transaccion_pasarela(p_codigo text, p_buy_order text, p_monto integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_res public.reservas%rowtype; v_id uuid;
begin
  select * into v_res from public.reservas where codigo = upper(trim(p_codigo)) for update;
  if not found then raise exception 'RESERVA_NO_ENCONTRADA'; end if;
  perform interno.expirar_reservas(array[v_res.id]);
  select * into v_res from public.reservas where id = v_res.id;
  if v_res.estado not in ('reservado','pendiente_pago') then raise exception 'ESTADO_INVALIDO: %', v_res.estado; end if;
  if p_monto <> v_res.monto_total then raise exception 'MONTO_INVALIDO'; end if;
  insert into public.transacciones_pasarela (reserva_id, buy_order, monto) values (v_res.id, p_buy_order, p_monto)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.confirmar_pago_pasarela(p_buy_order text, p_token text, p_monto integer,
                                                          p_autorizada boolean, p_respuesta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tx public.transacciones_pasarela%rowtype; v_res public.reservas%rowtype;
begin
  perform set_config('app.actor', 'pasarela', true);
  select * into v_tx from public.transacciones_pasarela where buy_order = p_buy_order for update;
  if not found then raise exception 'TRANSACCION_NO_ENCONTRADA'; end if;
  if v_tx.estado <> 'iniciada' then return jsonb_build_object('estado', v_tx.estado, 'repetida', true); end if;
  update public.transacciones_pasarela set token = p_token, respuesta = p_respuesta,
         estado = case when p_autorizada and p_monto = v_tx.monto then 'autorizada' else 'rechazada' end
   where id = v_tx.id;
  if not (p_autorizada and p_monto = v_tx.monto) then
    return jsonb_build_object('estado', 'rechazada');
  end if;
  select * into v_res from public.reservas where id = v_tx.reserva_id for update;
  if v_res.estado not in ('reservado','pendiente_pago') then
    -- pago autorizado sobre reserva ya vencida: requiere gestión manual de Tesorería (devolución o reasignación)
    perform interno.auditar_accion('transacciones_pasarela', v_tx.id::text, 'PAGO_SOBRE_RESERVA_NO_VIGENTE',
            jsonb_build_object('estado_reserva', v_res.estado));
    return jsonb_build_object('estado', 'requiere_revision');
  end if;
  insert into public.pagos (reserva_id, metodo, monto, estado, referencia_externa, validado_at, observacion)
  values (v_res.id, 'webpay', p_monto, 'aprobado', p_token, now(), 'Autorizado por Webpay');
  perform interno.cambiar_estado_reserva(v_res.id, 'pagado', 'Pago autorizado por Webpay', false, 'vendido');
  perform interno.encolar_notificacion(v_res.id, 'pago_confirmado');
  return jsonb_build_object('estado', 'autorizada', 'codigo', v_res.codigo);
end; $$;
