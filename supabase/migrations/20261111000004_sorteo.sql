-- =====================================================================
-- RIFA ONLINE CCPP — 0004 Sorteo transparente y auditable
--
-- Algoritmo CCPP-SHA256-RS v1.0.0 (verificable públicamente):
--   padron_texto = números elegibles ordenados ascendente, unidos por ","
--   padron_hash  = SHA256(padron_texto)
--   semilla      = 32 bytes aleatorios del servidor (hex). Al congelar el
--                  padrón se publica sólo compromiso = SHA256(semilla).
--   entropia     = valor público externo ingresado al momento del sorteo
--                  (p. ej. dígitos anunciados en vivo); puede ser vacío.
--   base         = SHA256(semilla || "|" || padron_hash || "|" || entropia)
--   Para cada ganador k = 1..N:
--     m = tamaño de la lista restante; c = 0
--     h = SHA256(base || "|" || k || "|" || c); x = primeros 12 hex de h (48 bits)
--     si x >= 2^48 - (2^48 mod m) -> c++ y repetir (muestreo por rechazo: sin sesgo)
--     índice = x mod m; ganador = lista[índice]; si no se permiten repetidos,
--     se quita de la lista.
-- La animación pública NO determina el resultado: sólo lo muestra.
-- =====================================================================

-- Semillas privadas hasta la ejecución (esquema no expuesto)
create table interno.semillas_sorteo (
  sorteo_id uuid primary key references public.sorteos(id) on delete restrict,
  semilla   text not null
);

create or replace function interno.sha256_hex(p text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex');
$$;

-- Selección determinística (función pura, usada también en pruebas de verificación)
create or replace function public.calcular_ganadores_sorteo(
  p_semilla text, p_padron_hash text, p_entropia text, p_padron integer[],
  p_cantidad integer, p_permitir_repetidos boolean)
returns table (posicion integer, numero integer, intento integer)
language plpgsql immutable set search_path = '' as $$
declare
  v_base text := interno.sha256_hex(p_semilla || '|' || p_padron_hash || '|' || coalesce(p_entropia, ''));
  v_lista integer[] := p_padron;
  v_m bigint; v_limite bigint; v_x bigint; v_idx integer; v_c integer; v_h text;
  k integer;
  c_rango constant bigint := 281474976710656;  -- 2^48
begin
  if p_cantidad < 1 then raise exception 'VALIDACION: cantidad de ganadores inválida'; end if;
  for k in 1..p_cantidad loop
    v_m := cardinality(v_lista);
    if v_m = 0 then raise exception 'SORTEO: no quedan participantes'; end if;
    v_limite := c_rango - (c_rango % v_m);
    v_c := 0;
    loop
      v_h := interno.sha256_hex(v_base || '|' || k || '|' || v_c);
      v_x := ('x' || lpad(substr(v_h, 1, 12), 16, '0'))::bit(64)::bigint;
      exit when v_x < v_limite;
      v_c := v_c + 1;
    end loop;
    v_idx := (v_x % v_m)::integer;   -- 0-based
    posicion := k; numero := v_lista[v_idx + 1]; intento := v_c;
    return next;
    if not p_permitir_repetidos then
      v_lista := v_lista[1:v_idx] || v_lista[v_idx + 2:];
    end if;
  end loop;
end; $$;

-- Cerrar ventas
create or replace function public.cerrar_ventas(p_rifa_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform interno.exigir_permiso('rifas.gestionar');
  update public.rifas set estado = 'cerrada' where id = p_rifa_id and estado in ('activa','pausada');
  if not found then raise exception 'ESTADO_INVALIDO: la rifa no está activa ni pausada'; end if;
  return jsonb_build_object('rifa_id', p_rifa_id, 'estado', 'cerrada', 'cerrada_at', now());
end; $$;

-- Generar y congelar el padrón oficial
create or replace function public.congelar_padron(
  p_rifa_id uuid, p_cantidad_ganadores integer, p_permitir_repetidos boolean default false,
  p_forzar boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := interno.exigir_permiso('sorteos.ejecutar');
  v_rifa public.rifas%rowtype;
  v_pend integer;
  v_padron integer[];
  v_hash text;
  v_semilla text := encode(extensions.gen_random_bytes(32), 'hex');
  v_sorteo uuid;
begin
  select * into v_rifa from public.rifas where id = p_rifa_id for update;
  if not found then raise exception 'RIFA_NO_ENCONTRADA'; end if;
  if v_rifa.estado <> 'cerrada' then raise exception 'ESTADO_INVALIDO: primero debe cerrar las ventas'; end if;
  if exists (select 1 from public.sorteos where rifa_id = p_rifa_id) then
    raise exception 'SORTEO_EXISTENTE: el padrón de esta rifa ya fue congelado';
  end if;

  perform interno.expirar_reservas((select array_agg(id) from public.reservas where rifa_id = p_rifa_id));
  select count(*) into v_pend from public.reservas
   where rifa_id = p_rifa_id and estado in ('reservado','pendiente_pago','comprobante_enviado','en_revision');
  if v_pend > 0 and not p_forzar then
    raise exception 'RESERVAS_PENDIENTES: hay % reservas sin resolver; apruebe, rechace o cancele antes de congelar', v_pend;
  end if;

  -- Sólo números vendidos, de reservas pagadas, con pago aprobado, de esta rifa
  select array_agg(n.numero order by n.numero) into v_padron
    from public.numeros n
    join public.detalle_reservas d on d.numero_id = n.id and d.activo
    join public.reservas re on re.id = d.reserva_id and re.estado = 'pagado'
   where n.rifa_id = p_rifa_id and n.estado = 'vendido'
     and exists (select 1 from public.pagos p where p.reserva_id = re.id and p.estado = 'aprobado');

  if v_padron is null then raise exception 'SIN_PARTICIPANTES: no hay números pagados'; end if;
  if not p_permitir_repetidos and p_cantidad_ganadores > cardinality(v_padron) then
    raise exception 'VALIDACION: hay más ganadores (%) que números participantes (%)', p_cantidad_ganadores, cardinality(v_padron);
  end if;

  v_hash := interno.sha256_hex(array_to_string(v_padron, ','));

  insert into public.sorteos (rifa_id, cantidad_ganadores, permitir_repetidos, total_participantes, padron_hash,
                              semilla_compromiso, reservas_excluidas, padron_congelado_por)
  values (p_rifa_id, p_cantidad_ganadores, p_permitir_repetidos, cardinality(v_padron), v_hash,
          interno.sha256_hex(v_semilla), v_pend, v_uid)
  returning id into v_sorteo;
  insert into interno.semillas_sorteo (sorteo_id, semilla) values (v_sorteo, v_semilla);

  insert into public.participantes_sorteo (sorteo_id, orden, numero, numero_id, reserva_id, comprador_id)
  select v_sorteo, (row_number() over (order by n.numero)) - 1, n.numero, n.id, re.id, re.comprador_id
    from public.numeros n
    join public.detalle_reservas d on d.numero_id = n.id and d.activo
    join public.reservas re on re.id = d.reserva_id
   where n.rifa_id = p_rifa_id and n.numero = any(v_padron);

  perform interno.auditar_accion('sorteos', v_sorteo::text, 'CONGELAR_PADRON',
          jsonb_build_object('padron_hash', v_hash, 'total', cardinality(v_padron), 'excluidas', v_pend));
  return jsonb_build_object('sorteo_id', v_sorteo, 'total_participantes', cardinality(v_padron),
                            'padron_hash', v_hash, 'semilla_compromiso', interno.sha256_hex(v_semilla),
                            'reservas_excluidas', v_pend);
end; $$;

-- Ejecutar el sorteo en el servidor
create or replace function public.ejecutar_sorteo(p_sorteo_id uuid, p_entropia_externa text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := interno.exigir_permiso('sorteos.ejecutar');
  v_s public.sorteos%rowtype;
  v_semilla text;
  v_padron integer[];
  v_ent text := trim(coalesce(p_entropia_externa, ''));
  g record;
  v_res record;
begin
  if length(v_ent) > 200 then raise exception 'VALIDACION: entropía externa demasiado larga'; end if;
  select * into v_s from public.sorteos where id = p_sorteo_id for update;
  if not found then raise exception 'SORTEO_NO_ENCONTRADO'; end if;
  if v_s.estado <> 'padron_congelado' then raise exception 'SORTEO_YA_EJECUTADO'; end if;
  select semilla into v_semilla from interno.semillas_sorteo where sorteo_id = p_sorteo_id;
  select array_agg(numero order by orden) into v_padron from public.participantes_sorteo where sorteo_id = p_sorteo_id;

  -- Verificación de integridad del padrón antes de sortear
  if interno.sha256_hex(array_to_string(v_padron, ',')) <> v_s.padron_hash then
    raise exception 'INTEGRIDAD: el padrón no coincide con su hash';
  end if;
  if interno.sha256_hex(v_semilla) <> v_s.semilla_compromiso then
    raise exception 'INTEGRIDAD: la semilla no coincide con el compromiso';
  end if;

  for g in select * from public.calcular_ganadores_sorteo(v_semilla, v_s.padron_hash, v_ent, v_padron,
                                                          v_s.cantidad_ganadores, v_s.permitir_repetidos)
  loop
    insert into public.ganadores (sorteo_id, posicion, premio_id, numero, numero_id, reserva_id, comprador_id, intento)
    select p_sorteo_id, g.posicion,
           (select pr.id from public.premios pr where pr.rifa_id = v_s.rifa_id and pr.posicion = g.posicion),
           ps.numero, ps.numero_id, ps.reserva_id, ps.comprador_id, g.intento
      from public.participantes_sorteo ps
     where ps.sorteo_id = p_sorteo_id and ps.numero = g.numero;
  end loop;

  update public.sorteos
     set estado = 'ejecutado', semilla = v_semilla, entropia_externa = v_ent,
         hash_base = interno.sha256_hex(v_semilla || '|' || v_s.padron_hash || '|' || v_ent),
         ejecutado_at = now(), ejecutado_por = v_uid
   where id = p_sorteo_id;
  update public.rifas set estado = 'sorteada' where id = v_s.rifa_id;

  -- Aviso de resultado a todos los participantes con correo
  for v_res in select distinct reserva_id from public.participantes_sorteo where sorteo_id = p_sorteo_id loop
    perform interno.encolar_notificacion(v_res.reserva_id, 'resultado_sorteo',
      jsonb_build_object('ganadores', (select jsonb_agg(jsonb_build_object('posicion', posicion, 'numero', numero) order by posicion)
                                         from public.ganadores where sorteo_id = p_sorteo_id)));
  end loop;

  perform interno.auditar_accion('sorteos', p_sorteo_id::text, 'EJECUTAR_SORTEO',
          jsonb_build_object('entropia', v_ent, 'ganadores',
            (select jsonb_agg(numero order by posicion) from public.ganadores where sorteo_id = p_sorteo_id)));
  return public.sorteo_publico(v_s.rifa_id);
end; $$;

-- Información pública del sorteo (sin datos personales)
create or replace function public.sorteo_publico(p_rifa_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rifa', jsonb_build_object('id', r.id, 'codigo', r.codigo, 'nombre', r.nombre, 'colegio', r.colegio,
                               'centro_padres', r.centro_padres, 'fecha_sorteo', r.fecha_sorteo, 'estado', r.estado,
                               'afiche_path', r.afiche_path),
    'premios', coalesce((select jsonb_agg(jsonb_build_object('posicion', p.posicion, 'nombre', p.nombre,
                                 'descripcion', p.descripcion, 'foto_path', p.foto_path) order by p.posicion)
                         from public.premios p where p.rifa_id = r.id), '[]'::jsonb),
    'sorteo', case when s.id is null then null else jsonb_build_object(
        'id', s.id, 'estado', s.estado, 'algoritmo', s.algoritmo, 'version', s.version_algoritmo,
        'cantidad_ganadores', s.cantidad_ganadores, 'permitir_repetidos', s.permitir_repetidos,
        'total_participantes', s.total_participantes, 'padron_hash', s.padron_hash,
        'semilla_compromiso', s.semilla_compromiso, 'padron_congelado_at', s.padron_congelado_at,
        'semilla', s.semilla, 'entropia_externa', s.entropia_externa, 'hash_base', s.hash_base,
        'ejecutado_at', s.ejecutado_at,
        'participantes', (select jsonb_agg(ps.numero order by ps.orden) from public.participantes_sorteo ps where ps.sorteo_id = s.id),
        'ganadores', (select jsonb_agg(jsonb_build_object('posicion', g.posicion, 'numero', g.numero, 'intento', g.intento,
                                       'premio', pr.nombre) order by g.posicion)
                        from public.ganadores g left join public.premios pr on pr.id = g.premio_id
                       where g.sorteo_id = s.id)
      ) end
  )
  from public.rifas r
  left join public.sorteos s on s.rifa_id = r.id
  where r.id = p_rifa_id and r.estado <> 'borrador';
$$;

-- Registro del acta (una única vez) y su respaldo
create or replace function public.registrar_documento(
  p_rifa_id uuid, p_tipo text, p_storage_path text, p_nombre text, p_mime text, p_sha256 text,
  p_sorteo_acta uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_doc uuid;
  v_rifa public.rifas%rowtype;
begin
  if p_tipo in ('ACTAS','GANADORES') then v_uid := interno.exigir_permiso('sorteos.ejecutar');
  elsif p_tipo = 'EVIDENCIAS' then v_uid := interno.exigir_permiso('premios.entregar');
  else v_uid := interno.exigir_permiso('rifas.gestionar'); end if;
  if p_storage_path !~ ('^' || p_rifa_id::text || '/' || p_tipo || '/[A-Za-z0-9._-]+$') then
    raise exception 'VALIDACION: ruta de documento inválida';
  end if;
  select * into v_rifa from public.rifas where id = p_rifa_id;
  insert into public.documentos (rifa_id, tipo, storage_path, nombre, mime, sha256, subido_por)
  values (p_rifa_id, p_tipo, p_storage_path, p_nombre, p_mime, p_sha256, v_uid)
  returning id into v_doc;
  if p_sorteo_acta is not null then
    update public.sorteos set acta_path = p_storage_path where id = p_sorteo_acta and rifa_id = p_rifa_id and acta_path is null;
  end if;
  insert into public.respaldos_drive (rifa_id, tipo_evidencia, entidad, entidad_id, storage_bucket, storage_path,
                                      nombre_archivo, carpeta_drive, sha256)
  values (p_rifa_id, p_tipo, 'documento', v_doc, 'documentos', p_storage_path,
          v_rifa.codigo || '_' || to_char(now() at time zone 'America/Santiago', 'YYYYMMDD-HH24MISS') || '_' ||
            p_tipo || '_' || left(v_doc::text, 8) || '_' || regexp_replace(p_nombre, '[^A-Za-z0-9._-]', '_', 'g'),
          'CENTRO_DE_PADRES/RIFAS/' || to_char(v_rifa.created_at at time zone 'America/Santiago', 'YYYY') || '/' || v_rifa.codigo || '/' || p_tipo,
          p_sha256)
  on conflict (storage_bucket, storage_path) do nothing;
  return v_doc;
end; $$;

create or replace function public.registrar_entrega_premio(
  p_ganador_id uuid, p_recibido_por text, p_observacion text default null, p_evidencia_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := interno.exigir_permiso('premios.entregar'); v_id uuid;
begin
  insert into public.entrega_premios (ganador_id, recibido_por, observacion, evidencia_path, registrado_por)
  values (p_ganador_id, trim(p_recibido_por), nullif(trim(coalesce(p_observacion,'')),''), p_evidencia_path, v_uid)
  returning id into v_id;
  return v_id;
end; $$;
