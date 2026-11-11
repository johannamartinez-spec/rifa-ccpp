-- =====================================================================
-- DATOS DE PRUEBA FICTICIOS — SÓLO PARA UN PROYECTO DE DESARROLLO.
-- ¡NO EJECUTAR EN PRODUCCIÓN! Todos los nombres, teléfonos y correos son inventados.
-- Requiere que exista al menos un usuario administrativo (crear_primer_superadmin).
-- =====================================================================
do $$
declare
  v_admin uuid := (select id from public.usuarios order by created_at limit 1);
  v_rifa uuid := gen_random_uuid();
  r jsonb;
  i int;
begin
  if v_admin is null then raise exception 'Cree primero el superadministrador'; end if;
  if exists (select 1 from public.rifas where nombre like '[PRUEBA]%') then raise notice 'Ya cargado'; return; end if;

  insert into public.rifas (id, nombre, colegio, centro_padres, descripcion, objetivo, precio_numero, numero_inicial, numero_final,
                            fecha_sorteo, bases, info_pago, contacto, created_by)
  values (v_rifa, '[PRUEBA] Rifa Día del Alumno', 'Colegio Ficticio', 'CCPP Ficticio',
          'Rifa de demostración con datos inventados.', 'Probar el sistema', 1000, 1, 200, now() + interval '15 days',
          'Bases de demostración.', E'Banco Ficticio\nCuenta Corriente 00-000-00\nRUT 11.111.111-1\nprueba@ejemplo.cl',
          'prueba@ejemplo.cl', v_admin);
  insert into public.premios (rifa_id, posicion, nombre, descripcion) values
    (v_rifa, 1, 'Tablet (ficticia)', 'Premio de demostración'),
    (v_rifa, 2, 'Canasta familiar (ficticia)', null),
    (v_rifa, 3, 'Entradas al cine (ficticias)', null);
  update public.rifas set estado = 'activa' where id = v_rifa;

  for i in 1..15 loop
    r := public.reservar_numeros(v_rifa, array[i * 3, i * 3 + 1], 'Apoderado Ficticio ' || chr(64 + i) || ' Prueba',
                                 (1 + i % 8) || '°' || chr(65 + i % 3), '+5690000' || lpad(i::text, 4, '0'), null, null);
    if i <= 10 then
      perform public.registrar_comprobante(r ->> 'codigo', '+5690000' || lpad(i::text, 4, '0'),
        v_rifa || '/' || (r ->> 'codigo') || '/demo.png', 'demo.png', 'image/png', 1000, encode(extensions.digest(i::text, 'sha256'), 'hex'));
    end if;
  end loop;
  raise notice 'Rifa de prueba creada: %', v_rifa;
end $$;
