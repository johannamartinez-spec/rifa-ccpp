import { createTheme } from '@mui/material/styles';
import { esES } from '@mui/material/locale';

export const VERDE = '#1b5e3b';
export const DORADO = '#c9a227';

export const tema = createTheme(
  {
    palette: {
      primary: { main: VERDE, dark: '#124229', light: '#4c8a66', contrastText: '#ffffff' },
      secondary: { main: DORADO, dark: '#8a6d10', contrastText: '#1d2b22' },
      background: { default: '#f5f7f5', paper: '#ffffff' },
      text: { primary: '#1d2b22', secondary: '#4f5f55' },
      success: { main: '#2e7d32' },
      warning: { main: '#b26a00' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif',
      fontSize: 15,
      h1: { fontSize: '1.9rem', fontWeight: 800 },
      h2: { fontSize: '1.5rem', fontWeight: 750 },
      h3: { fontSize: '1.25rem', fontWeight: 700 },
      button: { textTransform: 'none', fontWeight: 700 },
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 44 }, sizeLarge: { minHeight: 52, fontSize: '1.05rem' } } },
      MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderColor: '#dfe7e1' } } },
      MuiTextField: { defaultProps: { fullWidth: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    },
  },
  esES,
);
