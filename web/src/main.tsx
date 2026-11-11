import { CssBaseline, ThemeProvider } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ProveedorAvisos } from './components/comunes';
import { ProveedorAuth } from './lib/auth';
import { tema } from './theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={tema}>
      <CssBaseline />
      <BrowserRouter>
        <ProveedorAuth>
          <ProveedorAvisos>
            <App />
          </ProveedorAvisos>
        </ProveedorAuth>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
