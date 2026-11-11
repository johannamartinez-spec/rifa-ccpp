-- =====================================================================
-- RIFA ONLINE CCPP — 0007 Vistas administrativas, reportes, privacidad,
-- estado de integraciones
-- =====================================================================

-- Vista de reservas para el panel (security_invoker: respeta RLS del usuario)
create or replace view public.v_reservas_admin
with (security_invoker = true) as
select re.id, re.codigo, re.estado, re.cantidad, re.monto_total, re.expira_at, re.motivo,
       re.created_at, re.updated_at, re.rifa_id, ri.codigo as rifa_codigo, ri.nombre as rifa_nombre,
       c.id as comprador_id, c.nombre as comprador_nombre, c.curso, c.telefono, c.email, c.rut,
       (select array_agg(d.numero order by d.numero) from public.detalle_reservas d where d.reserva_id = re.id) as numeros,
       (select co.id from public.comprobantes co where co.reserva_id = re.id order by co.created_at desc limit 1) as ultimo_comprobante_id,
       (select co.created_at from public.comprobantes co where co.reserva_id = re.id order by co.created_at desc limit 1) as ultimo_comprobante_at
  from public.reservas re
  join public.rifas ri on ri.id = re.rifa_id
  join public.compradores c on c.id = re.comprador_id;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.dashboard_resumen(p_rifa_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform interno.exigir_permiso('reportes.ver');
  select jsonb_build_object(
    'total_rifas', (select count(*) from public.rifas where p_rifa_id is null or id = p_rifa_id),
    'rifas_activas', (select count(*) from public.rifas where estado = 'activa' and (p_rifa_id is null or id = p_rifa_id)),
    'numeros', (select jsonb_build_object(
        'total', count(*),
        'disponibles', count(*) filter (where n.estado = 'disponible'),
        'reservados', count(*) filter (where n.estado = 'reservado'),
        'pendientes', count(*) filter (where n.estado = 'pendiente_pago'),
        'vendidos', count(*) filter (where n.estado = 'vendido'),
        'bloqueados', count(*) filter (where n.estado = 'bloqueado'))
      from public.numeros n join public.rifas r on r.id = n.rifa_id
      where r.estado <> 'borrador' and (p_rifa_id is null or n.rifa_id = p_rifa_id)),
    'pagos_pendientes', (select count(*) from public.reservas
        where estado in ('reservado','pendiente_pago') and (p_rifa_id is null or rifa_id = p_rifa_id)),
    'comprobantes_por_revisar', (select count(*) from public.reservas
        where estado in ('comprobante_enviado','en_revision') and (p_rifa_id is null or rifa_id = p_rifa_id)),
    'recaudacion_confirmada', (select coalesce(sum(p.monto), 0) from public.pagos p join public.reservas re on re.id = p.reserva_id
        where p.estado = 'aprobado' and (p_rifa_id is null or re.rifa_id = p_rifa_id)),
    'recaudacion_pendiente', (select coalesce(sum(monto_total), 0) from public.reservas
        where estado in ('reservado','pendiente_pago','comprobante_enviado','en_revision') and (p_rifa_id is null or rifa_id = p_rifa_id)),
    'ventas_por_dia', coalesce((select jsonb_agg(x order by x.dia) from (
        select to_char(p.validado_at at time zone 'America/Santiago', 'YYYY-MM-DD') as dia,
               sum(p.monto) as monto, sum(re.cantidad) as numeros
          from public.pagos p join public.reservas re on re.id = p.reserva_id
         where p.estado = 'aprobado' and (p_rifa_id is null or re.rifa_id = p_rifa_id)
           and p.validado_at > now() - interval '60 days'
         group by 1) x), '[]'::jsonb),
    'ventas_por_curso', coalesce((select jsonb_agg(x order by x.monto desc) from (
        select c.curso, sum(p.monto) as monto, sum(re.cantidad) as numeros
          from public.pagos p join public.reservas re on re.id = p.reserva_id join public.compradores c on c.id = re.comprador_id
         where p.estado = 'aprobado' and (p_rifa_id is null or re.rifa_id = p_rifa_id)
         group by c.curso limit 30) x), '[]'::jsonb)
  ) into v;
  return v;
end; $$;

-- ---------------------------------------------------------------------
-- Reportes (devuelven filas JSON; el frontend exporta a Excel/PDF)
-- Los reportes financieros consideran ÚNICAMENTE pagos aprobados.
-- ---------------------------------------------------------------------
create or replace function public.reporte(
  p_tipo text, p_rifa_id uuid default null, p_desde date default null, p_hasta date default null, p_curso text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_desde timestamptz := case when p_desde is null then '-infinity'::timestamptz
                              else (p_desde::timestamp at time zone 'America/Santiago') end;
  v_hasta timestamptz := case when p_hasta is null then 'infinity'::timestamptz
                              else ((p_hasta + 1)::timestamp at time zone 'America/Santiago') end;
  v_curso text := nullif(lower(trim(coalesce(p_curso,''))), '');
  v jsonb;
begin
  perform interno.exigir_permiso('reportes.ver');
  if p_tipo in ('compradores','numeros_vendidos','reservas_vencidas','pagos_pendientes','pagos_confirmados',
                'comprobantes_rechazados','ganadores','premios_entregados','ajustes') then
    perform interno.exigir_permiso('compradores.ver');
  end if;

  case p_tipo
  when 'ventas_por_rifa' then
    select jsonb_agg(x order by x.codigo) into v from (
      select r.codigo, r.nombre, r.estado, r.precio_numero,
             count(n.*) as total_numeros,
             count(n.*) filter (where n.estado = 'vendido') as vendidos,
             count(n.*) filter (where n.estado = 'reservado') as reservados,
             count(n.*) filter (where n.estado = 'pendiente_pago') as en_validacion,
             count(n.*) filter (where n.estado = 'disponible') as disponibles,
             count(n.*) filter (where n.estado = 'bloqueado') as bloqueados,
             (select coalesce(sum(p.monto),0) from public.pagos p join public.reservas re on re.id = p.reserva_id
               where re.rifa_id = r.id and p.estado = 'aprobado' and p.validado_at >= v_desde and p.validado_at < v_hasta) as recaudacion_confirmada,
             round(100.0 * count(n.*) filter (where n.estado = 'vendido') / nullif(count(n.*),0), 1) as avance_pct
        from public.rifas r left join public.numeros n on n.rifa_id = r.id
       where p_rifa_id is null or r.id = p_rifa_id
       group by r.id) x;

  when 'compradores' then
    select jsonb_agg(x order by x.curso, x.nombre) into v from (
      select c.nombre, c.curso, c.telefono, c.email, r.codigo as rifa,
             count(distinct re.id) filter (where re.estado = 'pagado') as reservas_pagadas,
             coalesce(sum(re.cantidad) filter (where re.estado = 'pagado'), 0) as numeros_pagados,
             coalesce(sum(re.monto_total) filter (where re.estado = 'pagado'), 0) as monto_pagado,
             count(distinct re.id) as reservas_totales
        from public.compradores c join public.reservas re on re.comprador_id = c.id join public.rifas r on r.id = re.rifa_id
       where (p_rifa_id is null or re.rifa_id = p_rifa_id) and (v_curso is null or lower(c.curso) = v_curso)
         and re.created_at >= v_desde and re.created_at < v_hasta and c.anonimizado_at is null
       group by c.id, r.codigo) x;

  when 'numeros_vendidos' then
    select jsonb_agg(x order by x.rifa, x.numero) into v from (
      select r.codigo as rifa, d.numero, re.codigo as reserva, c.nombre, c.curso, p.validado_at as fecha_pago, p.metodo
        from public.detalle_reservas d join public.reservas re on re.id = d.reserva_id and re.estado = 'pagado'
        join public.pagos p on p.reserva_id = re.id and p.estado = 'aprobado'
        join public.compradores c on c.id = re.comprador_id join public.rifas r on r.id = re.rifa_id
       where d.activo and (p_rifa_id is null or re.rifa_id = p_rifa_id) and (v_curso is null or lower(c.curso) = v_curso)
         and p.validado_at >= v_desde and p.validado_at < v_hasta) x;

  when 'numeros_disponibles' then
    select jsonb_agg(x order by x.rifa, x.numero) into v from (
      select r.codigo as rifa, n.numero, n.estado from public.numeros n join public.rifas r on r.id = n.rifa_id
       where n.estado = 'disponible' and (p_rifa_id is null or n.rifa_id = p_rifa_id)) x;

  when 'reservas_vencidas' then
    select jsonb_agg(x order by x.creada desc) into v from (
      select re.codigo, r.codigo as rifa, c.nombre, c.curso, c.telefono, re.cantidad, re.monto_total, re.created_at as creada,
             (select h.created_at from public.historial_reservas h where h.reserva_id = re.id and h.estado_nuevo = 'expirado' limit 1) as expirada_at,
             (select array_agg(d.numero order by d.numero) from public.detalle_reservas d where d.reserva_id = re.id) as numeros
        from public.reservas re join public.compradores c on c.id = re.comprador_id join public.rifas r on r.id = re.rifa_id
       where re.estado = 'expirado' and (p_rifa_id is null or re.rifa_id = p_rifa_id) and (v_curso is null or lower(c.curso) = v_curso)
         and re.created_at >= v_desde and re.created_at < v_hasta) x;

  when 'pagos_pendientes' then
    select jsonb_agg(x order by x.creada) into v from (
      select re.codigo, r.codigo as rifa, re.estado, c.nombre, c.curso, c.telefono, re.cantidad, re.monto_total,
             re.expira_at, re.created_at as creada,
             (select array_agg(d.numero order by d.numero) from public.detalle_reservas d where d.reserva_id = re.id and d.activo) as numeros
        from public.reservas re join public.compradores c on c.id = re.comprador_id join public.rifas r on r.id = re.rifa_id
       where re.estado in ('reservado','pendiente_pago','comprobante_enviado','en_revision')
         and (p_rifa_id is null or re.rifa_id = p_rifa_id) and (v_curso is null or lower(c.curso) = v_curso)
         and re.created_at >= v_desde and re.created_at < v_hasta) x;

  when 'pagos_confirmados' then
    select jsonb_agg(x order by x.validado_at) into v from (
      select re.codigo as reserva, r.codigo as rifa, c.nombre, c.curso, p.metodo, p.monto, p.referencia_externa,
             p.validado_at, coalesce(u.nombre, 'Webpay') as validado_por, p.observacion,
             (select array_agg(d.numero order by d.numero) from public.detalle_reservas d where d.reserva_id = re.id and d.activo) as numeros
        from public.pagos p join public.reservas re on re.id = p.reserva_id
        join public.compradores c on c.id = re.comprador_id join public.rifas r on r.id = re.rifa_id
        left join public.usuarios u on u.id = p.validado_por
       where p.estado = 'aprobado' and (p_rifa_id is null or re.rifa_id = p_rifa_id) and (v_curso is null or lower(c.curso) = v_curso)
         and p.validado_at >= v_desde and p.validado_at < v_hasta) x;

  when 'comprobantes_rechazados' then
    select jsonb_agg(x order by x.revisado_at) into v from (
      select re.codigo as reserva, r.codigo as rifa, c.nombre, c.curso, co.created_at as enviado_at,
             co.revisado_at, co.motivo_rechazo, u.nombre as revisado_por
        from public.comprobantes co join public.reservas re on re.id = co.reserva_id
        join public.compradores c on c.id = co.comprador_id join public.rifas r on r.id = co.rifa_id
        left join public.usuarios u on u.id = co.revisado_por
       where co.estado_revision = 'rechazado' and (p_rifa_id is null or co.rifa_id = p_rifa_id)
         and (v_curso is null or lower(c.curso) = v_curso) and co.created_at >= v_desde and co.created_at < v_hasta) x;

  when 'recaudacion' then
    select jsonb_build_object(
      'por_rifa', coalesce((select jsonb_agg(x) from (
          select r.codigo as rifa, r.nombre, count(*) as pagos, sum(p.monto) as monto, sum(re.cantidad) as numeros
            from public.pagos p join public.reservas re on re.id = p.reserva_id join public.rifas r on r.id = re.rifa_id
            join public.compradores c on c.id = re.comprador_id
           where p.estado = 'aprobado' and (p_rifa_id is null or re.rifa_id = p_rifa_id)
             and (v_curso is null or lower(c.curso) = v_curso) and p.validado_at >= v_desde and p.validado_at < v_hasta
           group by r.id) x), '[]'::jsonb),
      'por_metodo', coalesce((select jsonb_agg(x) from (
          select p.metodo, count(*) as pagos, sum(p.monto) as monto
            from public.pagos p join public.reservas re on re.id = p.reserva_id join public.compradores c on c.id = re.comprador_id
           where p.estado = 'aprobado' and (p_rifa_id is null or re.rifa_id = p_rifa_id)
             and (v_curso is null or lower(c.curso) = v_curso) and p.validado_at >= v_desde and p.validado_at < v_hasta
           group by p.metodo) x), '[]'::jsonb),
      'total_confirmado', (select coalesce(sum(p.monto),0) from public.pagos p join public.reservas re on re.id = p.reserva_id
           join public.compradores c on c.id = re.comprador_id
           where p.estado = 'aprobado' and (p_rifa_id is null or re.rifa_id = p_rifa_id)
             and (v_curso is null or lower(c.curso) = v_curso) and p.validado_at >= v_desde and p.validado_at < v_hasta),
      'total_revertido', (select coalesce(sum(p.monto),0) from public.pagos p join public.reservas re on re.id = p.reserva_id
           where p.estado = 'revertido' and (p_rifa_id is null or re.rifa_id = p_rifa_id)
             and p.revertido_at >= v_desde and p.revertido_at < v_hasta)
    ) into v;

  when 'ajustes' then
    select jsonb_agg(x order by x.fecha) into v from (
      select 'REVERSION' as tipo, re.codigo as reserva, r.codigo as rifa, p.monto, p.revertido_at as fecha,
             u.nombre as responsable, p.motivo as detalle
        from public.pagos p join public.reservas re on re.id = p.reserva_id join public.rifas r on r.id = re.rifa_id
        left join public.usuarios u on u.id = p.revertido_por
       where p.estado = 'revertido' and (p_rifa_id is null or re.rifa_id = p_rifa_id)
         and p.revertido_at >= v_desde and p.revertido_at < v_hasta
      union all
      select 'CONFIRMACION_MANUAL', re.codigo, r.codigo, p.monto, p.validado_at, u.nombre, p.observacion
        from public.pagos p join public.reservas re on re.id = p.reserva_id join public.rifas r on r.id = re.rifa_id
        left join public.usuarios u on u.id = p.validado_por
       where p.estado in ('aprobado','revertido') and p.comprobante_id is null and p.metodo <> 'webpay'
         and (p_rifa_id is null or re.rifa_id = p_rifa_id) and p.validado_at >= v_desde and p.validado_at < v_hasta) x;

  when 'ganadores' then
    select jsonb_agg(x order by x.rifa, x.posicion) into v from (
      select r.codigo as rifa, g.posicion, pr.nombre as premio, g.numero, c.nombre, c.curso, c.telefono,
             s.ejecutado_at, (ep.id is not null) as entregado
        from public.ganadores g join public.sorteos s on s.id = g.sorteo_id join public.rifas r on r.id = s.rifa_id
        join public.compradores c on c.id = g.comprador_id left join public.premios pr on pr.id = g.premio_id
        left join public.entrega_premios ep on ep.ganador_id = g.id
       where (p_rifa_id is null or r.id = p_rifa_id)) x;

  when 'premios_entregados' then
    select jsonb_agg(x order by x.entregado_at) into v from (
      select r.codigo as rifa, g.posicion, pr.nombre as premio, g.numero, c.nombre as ganador, ep.recibido_por,
             ep.entregado_at, u.nombre as registrado_por, ep.observacion
        from public.entrega_premios ep join public.ganadores g on g.id = ep.ganador_id
        join public.sorteos s on s.id = g.sorteo_id join public.rifas r on r.id = s.rifa_id
        join public.compradores c on c.id = g.comprador_id left join public.premios pr on pr.id = g.premio_id
        left join public.usuarios u on u.id = ep.registrado_por
       where (p_rifa_id is null or r.id = p_rifa_id) and ep.entregado_at >= v_desde and ep.entregado_at < v_hasta) x;
  else
    raise exception 'VALIDACION: tipo de reporte desconocido %', p_tipo;
  end case;

  perform interno.auditar_accion('reportes', p_tipo, 'GENERAR_REPORTE',
          jsonb_build_object('rifa', p_rifa_id, 'desde', p_desde, 'hasta', p_hasta, 'curso', p_curso));
  return coalesce(v, '[]'::jsonb);
end; $$;


-- ---------------------------------------------------------------------
-- Protección de datos personales (Ley 19.628 / Ley 21.719)
-- ---------------------------------------------------------------------
create or replace function public.anonimizar_comprador(p_comprador_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform interno.exigir_permiso('configuracion.gestionar');
  if length(trim(coalesce(p_motivo,''))) < 5 then raise exception 'VALIDACION: indique el motivo'; end if;
  if exists (select 1 from public.reservas where comprador_id = p_comprador_id
              and estado in ('reservado','pendiente_pago','comprobante_enviado','en_revision')) then
    raise exception 'VALIDACION: el comprador tiene reservas en curso';
  end if;
  if exists (select 1 from public.ganadores g left join public.entrega_premios e on e.ganador_id = g.id
              where g.comprador_id = p_comprador_id and e.id is null) then
    raise exception 'VALIDACION: el comprador tiene un premio pendiente de entrega';
  end if;
  update public.compradores
     set nombre = 'Titular anonimizado', rut = null, telefono = null, email = null, anonimizado_at = now()
   where id = p_comprador_id and anonimizado_at is null;
  update public.notificaciones set destinatario = 'anonimizado', datos = '{}'::jsonb where reserva_id in
    (select id from public.reservas where comprador_id = p_comprador_id);
  perform interno.auditar_accion('compradores', p_comprador_id::text, 'ANONIMIZAR', jsonb_build_object('motivo', p_motivo));
end; $$;

-- Política de conservación: anonimiza compradores sin actividad pendiente cuyas
-- rifas terminaron hace más de N meses (configuración privacidad.meses_conservacion)
create or replace function public.aplicar_politica_conservacion()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_meses integer := coalesce((interno.config('privacidad.meses_conservacion','24'::jsonb))::text::integer, 24);
  r record; n integer := 0;
begin
  if auth.uid() is not null then perform interno.exigir_permiso('configuracion.gestionar'); end if;
  perform set_config('app.actor', 'sistema', true);
  for r in
    select c.id from public.compradores c
     where c.anonimizado_at is null
       and not exists (
         select 1 from public.reservas re join public.rifas ri on ri.id = re.rifa_id
          where re.comprador_id = c.id
            and (ri.estado <> 'sorteada' or ri.updated_at > now() - make_interval(months => v_meses)))
       and not exists (select 1 from public.ganadores g left join public.entrega_premios e on e.ganador_id = g.id
                        where g.comprador_id = c.id and e.id is null)
  loop
    update public.compradores set nombre = 'Titular anonimizado', rut = null, telefono = null, email = null,
           anonimizado_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end; $$;

-- ---------------------------------------------------------------------
-- Integraciones: estado (sin exponer tokens)
-- ---------------------------------------------------------------------
create or replace function public.estado_drive()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_permiso('drive.gestionar');
  return jsonb_build_object(
    'conectado', exists (select 1 from public.integraciones where proveedor = 'google_drive' and token_cifrado is not null),
    'cuenta_email', (select cuenta_email from public.integraciones where proveedor = 'google_drive'),
    'conectado_at', (select conectado_at from public.integraciones where proveedor = 'google_drive'),
    'cuenta_institucional_esperada', interno.config('drive.cuenta_institucional', 'null'::jsonb),
    'pendientes', (select count(*) from public.respaldos_drive where estado = 'pendiente'),
    'errores', (select count(*) from public.respaldos_drive where estado = 'error'),
    'subidos', (select count(*) from public.respaldos_drive where estado = 'enviado'),
    'ultimo_respaldo_at', (select max(subido_at) from public.respaldos_drive)
  );
end; $$;

create or replace function public.reintentar_respaldos()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform interno.exigir_permiso('drive.gestionar');
  update public.respaldos_drive set estado = 'pendiente', intentos = 0, error = null where estado = 'error';
  get diagnostics n = row_count; return n;
end; $$;

create or replace function public.reintentar_notificaciones()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform interno.exigir_permiso('notificaciones.gestionar');
  update public.notificaciones set estado = 'pendiente', intentos = 0, error = null where estado = 'error';
  get diagnostics n = row_count; return n;
end; $$;

-- Toma de trabajos para funciones Edge (service_role): bloqueo con SKIP LOCKED
create or replace function public.tomar_notificaciones(p_limite integer default 20)
returns setof public.notificaciones language sql security definer set search_path = '' as $$
  update public.notificaciones n set intentos = n.intentos + 1
   where n.id in (select id from public.notificaciones where estado = 'pendiente' and intentos < 5
                   order by created_at limit p_limite for update skip locked)
  returning n.*;
$$;

create or replace function public.tomar_respaldos(p_limite integer default 10)
returns setof public.respaldos_drive language sql security definer set search_path = '' as $$
  update public.respaldos_drive r set intentos = r.intentos + 1, ultimo_intento_at = now()
   where r.id in (select id from public.respaldos_drive where estado = 'pendiente' and intentos < 8
                   order by created_at limit p_limite for update skip locked)
  returning r.*;
$$;

