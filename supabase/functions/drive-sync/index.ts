/**
 * Respalda en Google Drive los archivos pendientes (comprobantes, actas,
 * reportes, evidencias). Si Drive no está conectado, NO falla: los archivos
 * quedan en estado "pendiente" y se respaldan cuando se conecte.
 * Idempotente: cada archivo lleva appProperties.ccpp_respaldo_id; si un
 * reintento encuentra el archivo ya subido, no lo duplica.
 */
import { descifrar } from '../_shared/cripto.ts';
import { ClienteDrive, tokenDeAcceso } from '../_shared/drive.ts';
import { clienteServicio, cors, env, esLlamadaServicio, exigirAdmin, manejarError, responder } from '../_shared/servidor.ts';

const MAX_INTENTOS = 8;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    if (!esLlamadaServicio(req)) await exigirAdmin(req, 'drive.gestionar');
    const sb = clienteServicio();

    const { data: integ } = await sb.from('integraciones').select('*').eq('proveedor', 'google_drive').maybeSingle();
    if (!integ?.token_cifrado) {
      const { count } = await sb.from('respaldos_drive').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
      return responder(req, { conectado: false, pendientes: count ?? 0, mensaje: 'Google Drive no está conectado; los archivos quedan pendientes.' });
    }

    const refresh = await descifrar(integ.token_cifrado, env('TOKEN_ENC_KEY'));
    const acceso = await tokenDeAcceso({ clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') }, refresh);
    const drive = new ClienteDrive(acceso, integ.carpetas_cache ?? {});

    const { data: trabajos, error } = await sb.rpc('tomar_respaldos', { p_limite: 10 });
    if (error) throw error;
    const res = { subidos: 0, ya_existian: 0, errores: 0 };

    for (const t of trabajos ?? []) {
      try {
        let id = await drive.buscarRespaldo(t.id);
        if (id) {
          res.ya_existian++;
        } else {
          const { data: blob, error: e } = await sb.storage.from(t.storage_bucket).download(t.storage_path);
          if (e || !blob) throw new Error(`No se pudo leer ${t.storage_path}: ${e?.message}`);
          const carpeta = await drive.asegurarRuta(t.carpeta_drive);
          id = await drive.subir({
            carpetaId: carpeta,
            nombre: t.nombre_archivo,
            mime: blob.type || 'application/octet-stream',
            bytes: new Uint8Array(await blob.arrayBuffer()),
            descripcion: [`Rifa: ${t.carpeta_drive.split('/')[3] ?? ''}`, `Tipo: ${t.tipo_evidencia}`,
              t.codigo_reserva ? `Reserva: ${t.codigo_reserva}` : '', `Documento: ${t.entidad_id}`,
              `Fecha: ${t.created_at}`, t.sha256 ? `SHA-256: ${t.sha256}` : ''].filter(Boolean).join('\n'),
            propiedades: {
              ccpp_respaldo_id: String(t.id),
              ccpp_rifa: String(t.rifa_id ?? ''),
              ccpp_reserva: String(t.codigo_reserva ?? ''),
              ccpp_documento: String(t.entidad_id),
              ccpp_tipo: t.tipo_evidencia,
            },
          });
          res.subidos++;
        }
        await sb.from('respaldos_drive').update({ estado: 'enviado', drive_file_id: id, subido_at: new Date().toISOString(), error: null }).eq('id', t.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb.from('respaldos_drive').update({ estado: t.intentos >= MAX_INTENTOS ? 'error' : 'pendiente', error: msg.slice(0, 500) }).eq('id', t.id);
        res.errores++;
      }
    }
    await sb.from('integraciones').update({ carpetas_cache: drive.cache }).eq('proveedor', 'google_drive');
    return responder(req, { conectado: true, cuenta: integ.cuenta_email, procesados: trabajos?.length ?? 0, ...res });
  } catch (e) {
    return manejarError(req, e);
  }
});
