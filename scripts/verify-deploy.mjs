// Token-free deploy verifier.
//
// "Did my deploy actually land?" — without a Vercel token and without a
// browser. It compares the asset filename the LIVE site serves against the
// asset filename in a LOCAL build (`admin-app/dist/index.html`), and can
// optionally assert that a marker string is present in the live bundle.
//
//   node scripts/verify-deploy.mjs
//   node scripts/verify-deploy.mjs --origin https://www.sparkinnbohol.com --dist guest-app/dist
//   node scripts/verify-deploy.mjs --contains "Error hydrating the reservation payments ledger"
//
// Exit code 0 when the live asset matches the local build (or the marker is
// found), 1 otherwise. Read-only: it only performs HTTP GETs.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const origin = arg("origin", "https://admin.sparkinnbohol.com").replace(/\/$/, "");
const distDir = resolve(process.cwd(), arg("dist", "admin-app/dist"));
const contains = arg("contains", "");
const timeoutMs = Number(arg("timeout", "900")) * 1000;

const localHtmlPath = resolve(distDir, "index.html");
if (!existsSync(localHtmlPath)) {
  console.error(`no local build at ${distDir} — build first (npm run build -w admin-app).`);
  process.exit(2);
}

const localHtml = readFileSync(localHtmlPath, "utf8");
const localAsset = /\/assets\/(index-[A-Za-z0-9_-]+\.(?:js|css))/.exec(localHtml)?.[1] ?? null;

async function probe() {
  const response = await fetch(`${origin}/`, { headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const asset = /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1] ?? null;
  return { asset, html };
}

const started = Date.now();
let lastError = null;
while (Date.now() - started < timeoutMs) {
  try {
    const { asset, html } = await probe();
    const seconds = Math.round((Date.now() - started) / 1000);
    if (!asset) {
      console.log(`[${seconds}s] live asset not found in the HTML shell`);
    } else {
      const same = localAsset ? asset === localAsset : null;
      console.log(`[${seconds}s] live asset: ${asset}${localAsset ? ` | local build: ${localAsset}` : ""}`);
      if (same === true) {
        console.log("MATCH — the live site is serving this build.");
        process.exit(0);
      }
      if (contains) {
        const js = await (await fetch(`${origin}/assets/${asset}`)).text();
        if (js.includes(contains)) {
          console.log(`MARKER FOUND — the live bundle contains "${contains}".`);
          process.exit(0);
        }
        console.log(`marker "${contains}" not present yet (bundle ${js.length} bytes).`);
      } else {
        console.log("DIFFERENT — the live site is still serving an older build.");
      }
    }
  } catch (error) {
    lastError = error;
    console.log(`[${Math.round((Date.now() - started) / 1000)}s] fetch failed: ${error.message}`);
  }
  await new Promise((r) => setTimeout(r, 15000));
}

console.error(lastError ? `gave up: ${lastError.message}` : "gave up: timeout");
process.exit(1);
