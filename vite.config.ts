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
        theme_color: "#0000FF",
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
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
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
          {
            urlPattern: ({ url }) => url.origin.includes("api"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/"),
    },
  },
});
