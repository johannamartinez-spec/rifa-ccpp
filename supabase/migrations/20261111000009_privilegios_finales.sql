-- =====================================================================
-- RIFA ONLINE CCPP — 0009 Privilegios finales (endurecimiento)
--
-- Supabase otorga por defecto EXECUTE sobre toda función nueva del
-- esquema public a anon y authenticated. Esta migración:
--   1) cambia los privilegios por defecto para que lo nuevo NO quede expuesto;
--   2) revoca todo y otorga explícitamente una lista blanca.
-- DEBE SER SIEMPRE LA ÚLTIMA MIGRACIÓN. Si agrega funciones en el futuro,
-- agréguelas aquí (o en una nueva migración posterior con sus grants).
-- La prueba "lista blanca de privilegios" falla si algo queda expuesto.
-- =====================================================================

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on public.v_reservas_admin from anon, authenticated;
revoke all on public.limites_solicitudes, public.integraciones from anon, authenticated;

-- Vista administrativa (security_invoker: aplica RLS de las tablas base)
grant select on public.v_reservas_admin to authenticated;

-- ---------------------------------------------------------------------
-- Visitantes (anon) y administradores
-- ---------------------------------------------------------------------
grant execute on function
  public.tiene_permiso(text),
  public.es_usuario_admin(),
  public.reservar_numeros(uuid, integer[], text, text, text, text, text),
  public.consultar_reserva(text, text),
  public.sorteo_publico(uuid),
  public.calcular_ganadores_sorteo(text, text, text, integer[], integer, boolean)
to anon, authenticated;

-- ---------------------------------------------------------------------
-- Sólo administradores (cada función valida además su permiso)
-- ---------------------------------------------------------------------
grant execute on function
  public.mis_permisos(),
  public.iniciar_revision(uuid),
  public.aprobar_pago(uuid, text),
  public.confirmar_pago_manual(uuid, public.metodo_pago, text, text),
  public.rechazar_pago(uuid, text, boolean),
  public.cancelar_reserva(uuid, text),
  public.revertir_pago(uuid, text, boolean),
  public.bloquear_numeros(uuid, integer[], text),
  public.desbloquear_numeros(uuid, integer[]),
  public.cerrar_ventas(uuid),
  public.congelar_padron(uuid, integer, boolean, boolean),
  public.ejecutar_sorteo(uuid, text),
  public.registrar_documento(uuid, text, text, text, text, text, uuid),
  public.registrar_entrega_premio(uuid, text, text, text),
  public.dashboard_resumen(uuid),
  public.reporte(text, uuid, date, date, text),
  public.anonimizar_comprador(uuid, text),
  public.aplicar_politica_conservacion(),
  public.estado_drive(),
  public.reintentar_respaldos(),
  public.reintentar_notificaciones()
to authenticated;

-- ---------------------------------------------------------------------
-- Sólo servidor (funciones Edge con service_role / pg_cron)
-- ---------------------------------------------------------------------
grant execute on function
  public.registrar_comprobante(text, text, text, text, text, integer, text),
  public.liberar_reservas_vencidas(),
  public.encolar_recordatorios(),
  public.registrar_transaccion_pasarela(text, text, integer),
  public.confirmar_pago_pasarela(text, text, integer, boolean, jsonb),
  public.tomar_notificaciones(integer),
  public.tomar_respaldos(integer),
  public.aplicar_politica_conservacion()
to service_role;
