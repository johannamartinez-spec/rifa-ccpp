import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Snackbar, TextField, Tooltip,
} from '@mui/material';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 6 }}>
      <CircularProgress size={28} /> {texto}
    </Box>
  );
}

export function ErrorCaja({ error, onReintentar }: { error: string | null; onReintentar?: () => void }) {
  if (!error) return null;
  return (
    <Alert severity="error" sx={{ my: 2 }} action={onReintentar && <Button color="inherit" onClick={onReintentar}>Reintentar</Button>}>
      {error}
    </Alert>
  );
}

export function BotonCopiar({ texto, etiqueta = 'Copiar' }: { texto: string; etiqueta?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Tooltip title={ok ? 'Copiado' : etiqueta}>
      <IconButton
        aria-label={etiqueta}
        onClick={async () => {
          try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin permiso */ }
        }}
      >
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

/** Diálogo de confirmación para acciones críticas, con campo de motivo opcional. */
export function Confirmar(props: {
  abierto: boolean;
  titulo: string;
  mensaje: ReactNode;
  textoConfirmar?: string;
  peligro?: boolean;
  pedirMotivo?: string;
  minMotivo?: number;
  extra?: ReactNode;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => Promise<void> | void;
}) {
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = props.minMotivo ?? 5;
  const valido = !props.pedirMotivo || motivo.trim().length >= min;
  return (
    <Dialog open={props.abierto} onClose={trabajando ? undefined : props.onCancelar} fullWidth maxWidth="sm">
      <DialogTitle>{props.titulo}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{props.mensaje}</DialogContentText>
        {props.extra}
        {props.pedirMotivo && (
          <TextField
            sx={{ mt: 2 }} label={props.pedirMotivo} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            multiline minRows={2} inputProps={{ maxLength: 500 }} helperText={`Mínimo ${min} caracteres`} autoFocus
          />
        )}
        <ErrorCaja error={error} />
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancelar} disabled={trabajando}>Volver</Button>
        <Button
          variant="contained" color={props.peligro ? 'error' : 'primary'} disabled={!valido || trabajando}
          onClick={async () => {
            setTrabajando(true); setError(null);
            try { await props.onConfirmar(motivo.trim()); setMotivo(''); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
          }}
        >
          {trabajando ? <CircularProgress size={20} color="inherit" /> : props.textoConfirmar ?? 'Confirmar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const CtxAviso = createContext<(m: string, t?: 'success' | 'error' | 'info') => void>(() => {});
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [a, setA] = useState<{ m: string; t: 'success' | 'error' | 'info' } | null>(null);
  const avisar = useCallback((m: string, t: 'success' | 'error' | 'info' = 'success') => setA({ m, t }), []);
  return (
    <CtxAviso.Provider value={avisar}>
      {children}
      <Snackbar open={!!a} autoHideDuration={5000} onClose={() => setA(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {a ? <Alert severity={a.t} variant="filled" onClose={() => setA(null)} sx={{ width: '100%' }}>{a.m}</Alert> : <span />}
      </Snackbar>
    </CtxAviso.Provider>
  );
}
export const useAviso = () => useContext(CtxAviso);
