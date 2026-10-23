// Static server for the LOCAL admin build (diagnostic RPT-01).
// Serves admin-app/dist with SPA fallback so /bookings etc. resolve to
// index.html. Read-only helper for local diagnosis.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, join } from "node:path";

const ROOT = resolve(process.cwd(), "admin-app/dist");
const PORT = Number(process.env.PORT || 8902);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json"
};

async function tryFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const clean = decodeURIComponent(url.pathname).replace(/\.\.+/g, "");
  let body = await tryFile(join(ROOT, clean));
  let type = TYPES[extname(clean)] || "application/octet-stream";
  if (!body) {
    body = await tryFile(join(ROOT, "index.html"));
    type = "text/html; charset=utf-8";
  }
  if (!body) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}/`));
