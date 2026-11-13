import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

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
        // La API y el login nunca pasan por el fallback de la SPA ni por la caché
        navigateFallbackDenylist: [/^\/v1\//, /^\/auth/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              // las imágenes subidas viven en el origen de la API (sin CORS => respuesta opaca)
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
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
          // (las imágenes subidas de /v1/uploads/ ya las cubre la regla de imágenes de arriba).
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
  server: {
    // Desarrollo: con VITE_API_URL vacío, /v1 se reenvía al backend (DEV_API_TARGET)
    proxy: {
      "/v1": process.env.DEV_API_TARGET ?? "http://localhost:3000",
    },
  },
});
