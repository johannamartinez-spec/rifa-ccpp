/**
 * POST multipart/form-data { codigo, telefono, archivo }
 * Público (el comprador no tiene cuenta). Valida el archivo en el servidor,
 * lo guarda en el bucket PRIVADO "comprobantes" con nombre generado y lo
 * registra en la base de datos de forma transaccional.
 */
import { CODIGO_RESERVA, MAX_BYTES, normalizarTelefono, sha256Hex, validarComprobante } from '../_shared/archivos.ts';
import { clienteServicio, cors, ErrorHttp, manejarError, responder } from '../_shared/servidor.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    if (req.method !== 'POST') throw new ErrorHttp(405, 'Método no permitido');
    const largo = Number(req.headers.get('content-length') ?? '0');
    if (largo > MAX_BYTES + 64 * 1024) throw new ErrorHttp(413, 'El archivo supera el máximo de 5 MB.');

    const form = await req.formData();
    const codigo = String(form.get('codigo') ?? '').trim().toUpperCase();
    const telefono = normalizarTelefono(String(form.get('telefono') ?? ''));
    const archivo = form.get('archivo');
    if (!CODIGO_RESERVA.test(codigo) || !telefono) throw new ErrorHttp(400, 'Código de reserva o teléfono inválido.');
    if (!(archivo instanceof File)) throw new ErrorHttp(400, 'Debe adjuntar el comprobante.');

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const v = validarComprobante(archivo.name, archivo.type, bytes);
    if (!v.ok) throw new ErrorHttp(422, v.error);

    const sb = clienteServicio();
    // Verificación previa (barata) antes de almacenar: reserva + teléfono + estado
    const { data: res, error: e1 } = await sb
      .from('reservas')
      .select('id, rifa_id, estado, expira_at, compradores!inner(telefono)')
      .eq('codigo', codigo)
      .eq('compradores.telefono', telefono)
      .maybeSingle();
    if (e1) throw e1;
    if (!res) throw new ErrorHttp(404, 'No encontramos una reserva con ese código y teléfono.');
    if (!['reservado', 'pendiente_pago', 'comprobante_enviado'].includes(res.estado)) {
      throw new ErrorHttp(409, 'Esta reserva ya no admite comprobantes.');
    }

    const sha = await sha256Hex(bytes);
    const ruta = `${res.rifa_id}/${codigo}/${crypto.randomUUID()}.${v.extension}`;
    const { error: e2 } = await sb.storage.from('comprobantes').upload(ruta, bytes, {
      contentType: v.mime, upsert: false, cacheControl: 'private, max-age=0',
    });
    if (e2) throw new Error(`Storage: ${e2.message}`);

    const { data, error: e3 } = await sb.rpc('registrar_comprobante', {
      p_codigo: codigo, p_telefono: telefono, p_storage_path: ruta, p_nombre_original: v.nombreVisible,
      p_mime: v.mime, p_tamano: bytes.length, p_sha256: sha,
    });
    if (e3) {
      await sb.storage.from('comprobantes').remove([ruta]); // no dejar huérfanos
      if (e3.code === '23505') throw new ErrorHttp(409, 'Este mismo archivo ya fue enviado para esta reserva.');
      throw new Error(e3.message);
    }
    return responder(req, { ok: true, ...data });
  } catch (e) {
    return manejarError(req, e);
  }
});
