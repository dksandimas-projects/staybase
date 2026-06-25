import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import config from "../hotel.config";

// Per W4.2 / decision #106: Vite build-time transform that
// substitutes the static <meta> tags in `index.html` with values
// from `hotel.config.ts` (brandName, domain, ogImage). The default
// meta values are the ones from `hotel.config.ts` already, so the
// dev server still works without a separate template file.
function indexHtmlTransformPlugin(): Plugin {
  return {
    name: "spark-inn-index-html-transform",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const ogImage = config.ogImage
          ? config.ogImage.startsWith("http")
            ? config.ogImage
            : `https://${config.domain}/${config.ogImage.replace(/^\/+/, "")}`
          : `https://${config.domain}/brand/og-default.png`;

        return html
          .replace(/<title>[\s\S]*?<\/title>/i, `<title>${config.brandName}</title>`)
          .replace(
            /<meta name="description" content="[^"]*"\s*\/>/i,
            `<meta name="description" content="Book your stay at ${config.brandName}, a boutique hotel in Bohol, Philippines." />`
          )
          .replace(
            /<meta property="og:site_name" content="[^"]*"\s*\/>/i,
            `<meta property="og:site_name" content="${config.brandName}" />`
          )
          .replace(
            /<meta property="og:title" content="[^"]*"\s*\/>/i,
            `<meta property="og:title" content="${config.brandName}" />`
          )
          .replace(
            /<meta property="og:description" content="[^"]*"\s*\/>/i,
            `<meta property="og:description" content="Book your stay at ${config.brandName}, a boutique hotel in Bohol, Philippines." />`
          )
          .replace(
            /<meta property="og:image" content="[^"]*"\s*\/>/i,
            `<meta property="og:image" content="${ogImage}" />`
          )
          .replace(
            /<meta property="og:url" content="[^"]*"\s*\/>/i,
            `<meta property="og:url" content="https://${config.domain}/" />`
          )
          .replace(
            /<meta name="twitter:title" content="[^"]*"\s*\/>/i,
            `<meta name="twitter:title" content="${config.brandName}" />`
          )
          .replace(
            /<meta name="twitter:description" content="[^"]*"\s*\/>/i,
            `<meta name="twitter:description" content="Book your stay at ${config.brandName}, a boutique hotel in Bohol, Philippines." />`
          )
          .replace(
            /<meta name="twitter:image" content="[^"]*"\s*\/>/i,
            `<meta name="twitter:image" content="${ogImage}" />`
          );
      }
    }
  };
}

export default defineConfig({
  plugins: [
    indexHtmlTransformPlugin(),
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
        skipWaiting: true,
        clientsClaim: true,
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
