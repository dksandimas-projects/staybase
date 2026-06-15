import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import config from "../hotel.config";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: config.brandName,
        short_name: config.brandName,
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: config.colors.primary,
        icons: [
          { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      workbox: {
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst"
          },
          {
            urlPattern: ({ request }) => ["font", "image", "style", "script"].includes(request.destination),
            handler: "CacheFirst"
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@config": path.resolve(__dirname, "../hotel.config.ts"),
      "@shared": path.resolve(__dirname, "../shared")
    }
  }
});
