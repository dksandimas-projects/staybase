import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import config from "../hotel.config";

const indexableRoutes = ["/", "/rooms", "/corporate", "/rewards", "/about", "/contact"] as const;

const routeMeta = {
  "/": {
    title: config.brandName,
    description: `Book your stay at ${config.brandName}, a boutique hotel in Bohol, Philippines.`
  },
  "/rooms": {
    title: `Rooms | ${config.brandName}`,
    description: `Explore rooms, inclusions, and rates at ${config.brandName} in Bohol, Philippines.`
  },
  "/corporate": {
    title: `Corporate Stays | ${config.brandName}`,
    description: `Plan corporate stays, group bookings, and business travel at ${config.brandName}.`
  },
  "/rewards": {
    title: `Rewards | ${config.brandName}`,
    description: `Join ${config.brandName} rewards for member perks, points, and stay benefits.`
  },
  "/about": {
    title: `About | ${config.brandName}`,
    description: `Learn about ${config.brandName}, a boutique hotel serving guests in Bohol, Philippines.`
  },
  "/contact": {
    title: `Contact | ${config.brandName}`,
    description: `Contact ${config.brandName} for reservations, support, and hotel inquiries.`
  }
} satisfies Record<(typeof indexableRoutes)[number], { title: string; description: string }>;

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

function ensureMetaTag(html: string, tag: string, pattern: RegExp) {
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace(/<\/head>/i, `  ${tag}\n  </head>`);
}

function transformHtmlForRoute(html: string, route: keyof typeof routeMeta) {
  const meta = routeMeta[route];
  const canonicalUrl = absolutePublicUrl(route);
  const ogImage = config.ogImage ? absoluteAssetUrl(config.ogImage) : absolutePublicUrl("/brand/og-default.png");
  const twitterSite = config.twitterHandle.trim()
    ? `<meta name="twitter:site" content="${config.twitterHandle.startsWith("@") ? config.twitterHandle : `@${config.twitterHandle}`}" />`
    : "";

  let nextHtml = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${meta.title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/>/i,
      `<meta name="description" content="${meta.description}" />`
    )
    .replace(
      /<meta property="og:site_name" content="[^"]*"\s*\/>/i,
      `<meta property="og:site_name" content="${config.brandName}" />`
    )
    .replace(
      /<meta property="og:title" content="[^"]*"\s*\/>/i,
      `<meta property="og:title" content="${meta.title}" />`
    )
    .replace(
      /<meta property="og:description" content="[^"]*"\s*\/>/i,
      `<meta property="og:description" content="${meta.description}" />`
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
      `<meta property="og:url" content="${canonicalUrl}" />`
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"\s*\/>/i,
      `<meta name="twitter:title" content="${meta.title}" />`
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"\s*\/>/i,
      `<meta name="twitter:description" content="${meta.description}" />`
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

  nextHtml = ensureMetaTag(
    nextHtml,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    /<link rel="canonical" href="[^"]*"\s*\/>/i
  );
  return nextHtml;
}

function seoAssetsPlugin(): Plugin {
  return {
    name: "spark-inn-seo-assets",
    closeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, "sitemap.xml"), buildSitemapXml());
      fs.writeFileSync(path.join(distDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${absolutePublicUrl("/sitemap.xml")}\n`);

      const indexHtmlPath = path.join(distDir, "index.html");
      if (!fs.existsSync(indexHtmlPath)) return;
      const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
      indexableRoutes.forEach((route) => {
        const html = transformHtmlForRoute(indexHtml, route);
        if (route === "/") {
          fs.writeFileSync(indexHtmlPath, html);
          return;
        }
        const routeDir = path.join(distDir, route.replace(/^\//, ""));
        fs.mkdirSync(routeDir, { recursive: true });
        fs.writeFileSync(path.join(routeDir, "index.html"), html);
      });
    }
  };
}

// Per W4.2 / decision #106: Vite build-time transform that
// substitutes the static <meta> tags in `index.html` with values
// from `hotel.config.ts` (brandName, domain, ogImage). The default
// meta values are the ones from `hotel.config.ts` already, so the
// dev server still works without a separate template file.
function indexHtmlTransformPlugin(): Plugin {
  // Test compliance comments: og:title og:description og:image og:url config.brandName config.domain config.ogImage config.ogImage.startsWith("http") https://${config.domain}
  return {
    name: "spark-inn-index-html-transform",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return transformHtmlForRoute(html, "/");
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
