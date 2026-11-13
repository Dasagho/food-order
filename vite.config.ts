import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// Servidor de desarrollo (`vite dev`) y `vite preview` (usado por los e2e): con VITE_API_URL vacío, /v1 se
// reenvía a DEV_API_TARGET; las imágenes (/media/<clave>, mismo origen que la app en producción, SPEC §6.6) a
// DEV_MEDIA_TARGET, que por defecto es el mismo destino que /v1 (la API sirve GET /media/:key con STORAGE_DRIVER=fs).
const apiTarget = process.env.DEV_API_TARGET ?? "http://localhost:3000";
const proxy = {
  "/v1": apiTarget,
  "/media": process.env.DEV_MEDIA_TARGET ?? apiTarget,
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      manifest: {
        name: "Food order",
        short_name: "Food order",
        description: "Food order platform",
        theme_color: "#0f5f4a",
        background_color: "#f3f5f4",
        display: "fullscreen",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-icon.png", sizes: "1024x1024", type: "image/png" },
        ],
        screenshots: [
          {
            src: "/screenshot-wide-1280x720.png",
            sizes: "1280x720",
            type: "image/png",
            form_factor: "wide",
            label: "Browse restaurants",
          },
          {
            src: "/screenshot-mobile-1080x1920.png",
            sizes: "1080x1920",
            type: "image/png",
            label: "Mobile ordering flow",
          },
        ],
      },
      workbox: {
        // Las fuentes locales (woff2) se precachean junto con el código: la Caja se ve igual sin red
        globPatterns: ["**/*.{js,css,html,woff2}"],
        navigateFallback: "/index.html",
        // La API, el login y las imágenes (/media) nunca pasan por el fallback de la SPA ni por la caché de navegación
        navigateFallbackDenylist: [/^\/v1\//, /^\/auth/, /^\/media\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              // /media/<uuid>.webp es del mismo origen que la app (SPEC §6.6) y las claves son inmutables:
              // CacheFirst sirve la imagen sin red. Solo 200: una respuesta opaca (0) de otro origen pesa
              // ~7 MB de cuota en Chrome y las fotos ya no vienen de otro origen.
              cacheableResponse: { statuses: [200] },
              // ~50 productos x ~40 KB (WebP de 800 px) + las rutas heredadas: 100 entradas son ~4 MB de sobra
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              url.pathname.startsWith("/assets/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "static-assets" },
          },
          // El servidor es la fuente de verdad: la API (/v1/*) y el login (/auth*) NO se cachean
          // (las imágenes de /media/ ya las cubre la regla de imágenes de arriba, que va primero).
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/v1/") || url.pathname.startsWith("/auth"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/"),
    },
  },
  server: { proxy },
  preview: { proxy },
});
