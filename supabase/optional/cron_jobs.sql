-- =====================================================================
-- RIFA ONLINE CCPP — Tareas programadas (pg_cron + pg_net). Plan gratuito.
--
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de las migraciones.
-- 1. Habilite las extensiones pg_cron y pg_net (Database > Extensions).
-- 2. Guarde la URL del proyecto y la clave service_role en Vault
--    (Project Settings > Vault) con estos nombres:
--      select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--      select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--    La clave queda cifrada en la base de datos; nunca va al frontend ni a GitHub.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Liberar reservas vencidas cada minuto (además existe liberación perezosa)
select cron.schedule('ccpp-liberar-vencidas', '* * * * *', $$ select public.liberar_reservas_vencidas(); $$);

-- Encolar recordatorios de pago cada 2 minutos
select cron.schedule('ccpp-recordatorios', '*/2 * * * *', $$ select public.encolar_recordatorios(); $$);

-- Procesar cola de notificaciones cada 2 minutos (función Edge)
select cron.schedule('ccpp-notificaciones', '*/2 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/procesar-notificaciones',
    headers := jsonb_build_object('Content-Type','application/json',
               'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$$);

-- Respaldo en Google Drive cada 15 minutos (función Edge)
select cron.schedule('ccpp-drive-sync', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/drive-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);

-- Política de conservación de datos: mensual
select cron.schedule('ccpp-conservacion', '0 4 1 * *', $$ select public.aplicar_politica_conservacion(); $$);

-- Limpieza del historial de cron (evita crecer indefinidamente)
select cron.schedule('ccpp-limpiar-cron', '0 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
$$);

-- Ver tareas: select * from cron.job;
-- Quitar una: select cron.unschedule('ccpp-drive-sync');
