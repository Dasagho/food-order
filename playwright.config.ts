import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4174);
// E2E_BACKEND=real: en vez del fake, arranca el backend REAL (../food-order-api, ya compilado con
// `npm run build`) detrás de un proxy de control (tests/real-api/control.mjs).
const REAL = process.env.E2E_BACKEND === "real";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1, // un único servidor falso compartido (se reinicia en cada test)
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Chrome real instalado en la máquina (no el Chromium de Playwright)
    launchOptions: { executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] },
    viewport: { width: 1280, height: 900 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: [
    // Backend FALSO en memoria que implementa el contrato de food-order-api/SPEC.md
    // (o, con E2E_BACKEND=real, el backend real con el mismo interfaz de control)
    {
      command: REAL ? "node tests/real-api/control.mjs" : "node tests/fake-api/server.ts",
      url: `http://localhost:${API_PORT}/health`,
      env: REAL
        ? { CONTROL_PORT: String(API_PORT), FRONTEND_ORIGINS: `http://localhost:${PORT}` }
        : { FAKE_API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    // Build de producción servido con vite preview (lo mismo que recibe el usuario),
    // apuntando al backend falso y con el acceso de desarrollo activado
    {
      command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      // /media/<clave> es del origen de la app (producción: nginx -> bucket); aquí `vite preview` lo reenvía
      // al fake / backend real (DEV_MEDIA_TARGET), que sirve las imágenes subidas.
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}`,
        VITE_DEV_LOGIN: "1",
        DEV_MEDIA_TARGET: `http://localhost:${API_PORT}`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
