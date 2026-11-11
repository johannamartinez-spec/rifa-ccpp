-- =====================================================================
-- RIFA ONLINE CCPP — 0006 Supabase Storage: buckets y políticas
--   rifas-publico : afiches y fotos de premios (público, sólo imágenes)
--   comprobantes  : PRIVADO. Sólo escribe la función Edge (service_role).
--                   Tesorería lee mediante URLs firmadas de corta duración.
--   documentos    : PRIVADO. Actas, reportes, evidencias de entrega.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('rifas-publico', 'rifas-publico', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('comprobantes',  'comprobantes',  false, 5242880, array['image/jpeg','image/png','application/pdf']),
  ('documentos',    'documentos',    false, 20971520, array['application/pdf','image/jpeg','image/png',
                                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- rifas-publico
create policy "publico_lectura" on storage.objects for select to anon, authenticated
  using (bucket_id = 'rifas-publico');
create policy "publico_escritura" on storage.objects for insert to authenticated
  with check (bucket_id = 'rifas-publico' and public.tiene_permiso('rifas.gestionar')
              and name ~ '^[0-9a-f-]{36}/(afiche|premios)/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$');
create policy "publico_actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'rifas-publico' and public.tiene_permiso('rifas.gestionar'));
create policy "publico_eliminar" on storage.objects for delete to authenticated
  using (bucket_id = 'rifas-publico' and public.tiene_permiso('rifas.gestionar'));

-- comprobantes: lectura sólo con permiso pagos.ver (necesario para firmar URLs)
create policy "comprobantes_lectura" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and public.tiene_permiso('pagos.ver'));
-- (sin políticas de insert/update/delete: sólo service_role)

-- documentos
create policy "documentos_lectura" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.tiene_permiso('reportes.ver'));
create policy "documentos_escritura" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos'
              and name ~ '^[0-9a-f-]{36}/(ACTAS|REPORTES|GANADORES|EVIDENCIAS)/[A-Za-z0-9._-]+$'
              and (public.tiene_permiso('sorteos.ejecutar') or public.tiene_permiso('premios.entregar')
                   or public.tiene_permiso('rifas.gestionar')));
-- (sin update/delete: los documentos oficiales se conservan)
