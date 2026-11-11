import UploadFileIcon from '@mui/icons-material/UploadFile';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { mensajeError } from '../lib/errores';
import { llamarFuncion } from '../lib/supabase';
import { validarArchivoComprobante } from '../lib/validacion';

export function SubirComprobante({ codigo, telefono, onListo }: { codigo: string; telefono: string; onListo: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);

  const elegir = (f: File | undefined) => {
    setOk(false);
    if (!f) return;
    const e = validarArchivoComprobante(f);
    setError(e);
    setArchivo(e ? null : f);
  };

  const enviar = async () => {
    if (!archivo) return;
    setEnviando(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('codigo', codigo);
      fd.append('telefono', telefono);
      fd.append('archivo', archivo);
      await llamarFuncion('subir-comprobante', fd);
      setOk(true);
      setArchivo(null);
      if (ref.current) ref.current.value = '';
      onListo();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Box sx={{ border: '2px dashed', borderColor: 'primary.light', borderRadius: 3, p: 2, bgcolor: '#f7fbf8' }}>
      <Typography fontWeight={800} gutterBottom>Enviar comprobante de transferencia</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Captura de pantalla (JPG o PNG) o PDF del banco. Máximo 5 MB.
      </Typography>
      <input
        ref={ref} id={`archivo-${codigo}`} type="file" accept="image/jpeg,image/png,application/pdf" hidden
        onChange={(e) => elegir(e.target.files?.[0])} aria-label="Seleccionar comprobante"
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} sx={{ mt: 1 }}>
        <Button variant="outlined" size="large" startIcon={<UploadFileIcon />} onClick={() => ref.current?.click()} disabled={enviando}>
          {archivo ? 'Cambiar archivo' : 'Elegir archivo'}
        </Button>
        <Button variant="contained" size="large" onClick={enviar} disabled={!archivo || enviando}>
          {enviando ? 'Enviando…' : 'Enviar comprobante'}
        </Button>
      </Stack>
      {archivo && <Typography variant="body2" sx={{ mt: 1 }}>Archivo: <b>{archivo.name}</b> ({Math.round(archivo.size / 1024)} KB)</Typography>}
      {enviando && <LinearProgress sx={{ mt: 1 }} />}
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      {ok && <Alert severity="success" sx={{ mt: 1.5 }}>¡Comprobante recibido! Tesorería lo revisará y le avisaremos.</Alert>}
    </Box>
  );
}
