import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import config from "../hotel.config";

const indexableRoutes = ["/", "/rooms", "/corporate", "/rewards", "/about", "/contact"] as const;

function absolutePublicUrl(pathname: string) {
  return `https://${config.domain}${pathname}`;
}

function absoluteAssetUrl(asset: string) {
  return asset.startsWith("http")
    ? asset
    : absolutePublicUrl(`/${asset.replace(/^\/+/, "")}`);
}

function twitterUrl() {
  const handle = config.twitterHandle.trim().replace(/^@/, "");
  return handle ? `https://x.com/${handle}` : "";
}

function buildHotelJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name: config.brandName,
    legalName: config.legalName,
    description: config.metaDescription,
    url: absolutePublicUrl("/"),
    image: absoluteAssetUrl(config.ogImage),
    telephone: config.frontDeskPhone,
    email: config.supportEmail,
    priceRange: config.priceRange,
    checkinTime: config.checkInTime,
    checkoutTime: config.checkOutTime,
    sameAs: [config.facebookUrl, config.instagramUrl, twitterUrl()].filter(Boolean),
    address: {
      "@type": "PostalAddress",
      streetAddress: config.address.street,
      addressLocality: config.address.city,
      addressRegion: config.address.region,
      postalCode: config.address.postalCode
    }
  };
}

function buildSitemapXml() {
  const urls = indexableRoutes
    .map((route) => `  <url>\n    <loc>${absolutePublicUrl(route)}</loc>\n  </url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function seoAssetsPlugin(): Plugin {
  return {
    name: "spark-inn-seo-assets",
    closeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, "sitemap.xml"), buildSitemapXml());
      fs.writeFileSync(path.join(distDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${absolutePublicUrl("/sitemap.xml")}\n`);
    }
  };
}

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
        const ogImage = config.ogImage ? absoluteAssetUrl(config.ogImage) : absolutePublicUrl("/brand/og-default.png");
        const twitterSite = config.twitterHandle.trim()
          ? `<meta name="twitter:site" content="${config.twitterHandle.startsWith("@") ? config.twitterHandle : `@${config.twitterHandle}`}" />`
          : "";

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
            /<meta property="og:image:width" content="[^"]*"\s*\/>/i,
            `<meta property="og:image:width" content="1200" />`
          )
          .replace(
            /<meta property="og:image:height" content="[^"]*"\s*\/>/i,
            `<meta property="og:image:height" content="630" />`
          )
          .replace(
            /<meta property="og:image:alt" content="[^"]*"\s*\/>/i,
            `<meta property="og:image:alt" content="${config.brandName}" />`
          )
          .replace(
            /<meta property="og:locale" content="[^"]*"\s*\/>/i,
            `<meta property="og:locale" content="${config.locale}" />`
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
          )
          .replace(
            /<meta name="twitter:site" content="[^"]*"\s*\/>/i,
            twitterSite
          )
          .replace(
            /<script type="application\/ld\+json" id="hotel-json-ld">[\s\S]*?<\/script>/i,
            `<script type="application/ld+json" id="hotel-json-ld">${JSON.stringify(buildHotelJsonLd())}</script>`
          );
      }
    }
  };
}

export default defineConfig({
  plugins: [
    indexHtmlTransformPlugin(),
    seoAssetsPlugin(),
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
        navigateFallback: "/index.html",
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
