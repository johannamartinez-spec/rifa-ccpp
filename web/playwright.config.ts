import { defineConfig, devices } from '@playwright/test';

// Requiere el entorno local: `bash e2e/entorno/iniciar.sh` (PostgreSQL + PostgREST + Deno + pasarela + vite preview)
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'e2e-resultados.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] },
  },
  projects: [
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
