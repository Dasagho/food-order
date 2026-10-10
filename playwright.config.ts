import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
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
  // Build de producción servido con vite preview (lo mismo que recibe el usuario)
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
