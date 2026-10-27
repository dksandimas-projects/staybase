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
  },
  test: {
    // Vitest's default `testTimeout` is 5000ms. That is a reasonable
    // budget for a unit test and far too small for this suite on a
    // loaded machine.
    //
    // The concrete offender is
    // `src/__tests__/p1-admin-addons-catalog-shape.test.ts`: it
    // parses EVERY `.tsx` file in `admin-app/src` AND
    // `guest-app/src` with the TypeScript compiler, to prove that no
    // `//` comment is painted as UI text. That is a whole-tree
    // AST walk inside a single `it()`, and it is charged entirely
    // to that one assertion.
    //
    // Proven pre-existing (2026-10-27): the same test times out at
    // the committed HEAD (v2.21.6) under full-suite load — with
    // three MORE failures there than in a loaded working tree — so
    // it is not caused by any current change.
    //
    // A ceiling is not a mask: 20s is only reached by a genuinely
    // stuck test. The guest-app suite got the same treatment for
    // the same reason (see `guest-app/vite.config.ts`).
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
});
