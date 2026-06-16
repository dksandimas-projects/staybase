import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import config from "../hotel.config";

// Per W4.2: Vite build-time transform that substitutes the
// static <meta> tags in `index.html` with values from
// `hotel.config.ts` (brandName, domain, ogImage).
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
          .replace(/<title>[\s\S]*?<\/title>/i, `<title>${config.brandName} — Admin</title>`)
          .replace(
            /<meta property="og:title" content="[^"]*"\s*\/>/i,
            `<meta property="og:title" content="${config.brandName} — Admin" />`
          )
          .replace(
            /<meta property="og:image" content="[^"]*"\s*\/>/i,
            `<meta property="og:image" content="${ogImage}" />`
          )
          .replace(
            /<meta property="og:url" content="[^"]*"\s*\/>/i,
            `<meta property="og:url" content="https://${config.adminDomain}/" />`
          );
      }
    }
  };
}

export default defineConfig({
  plugins: [indexHtmlTransformPlugin(), react()],
  resolve: {
    alias: {
      "@config": path.resolve(__dirname, "../hotel.config.ts"),
      "@shared": path.resolve(__dirname, "../shared")
    }
  }
});
