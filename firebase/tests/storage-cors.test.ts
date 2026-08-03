// Per `plan/project/PROD-CUTOVER-RUNBOOK.md §PC-04` and
// `plan/docs/ENV-SETUP.md §Staging`:
//   - Production: www.sparkinnbohol.com, admin.sparkinnbohol.com
//   - Staging:    stg.sparkinnbohol.com, stg-admin.sparkinnbohol.com
//   - Preview:    *.vercel.app (PR previews)
//   - Local:      localhost:3000, localhost:5173
//
// The Firebase Storage bucket for `spark-inn-stg-7a7ad` was only
// configured with production + localhost origins, so the browser
// blocked `getBlob()` from the staging admin (CORS error). The PDF
// generator's outer timeout caught the resulting 20s hang and
// surfaced a toast, but the underlying read was never going to
// succeed. This test pins the full origin allowlist so a future
// refactor that drops the staging hosts (or a white-label client
// with different staging domains) fails CI before it ships.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const corsConfig = JSON.parse(
  readFileSync(resolve(repoRoot, "firebase/cors.json"), "utf8")
);

describe("Firebase Storage CORS allowlist", () => {
  const firstRule = corsConfig?.[0];
  const origins: string[] = firstRule?.origin ?? [];
  const methods: string[] = firstRule?.method ?? [];

  it("is a non-empty list of full origins (not wildcards like '*')", () => {
    expect(Array.isArray(origins)).toBe(true);
    expect(origins.length).toBeGreaterThan(0);
    origins.forEach((origin) => {
      expect(origin).not.toBe("*");
      expect(origin).toMatch(/^https?:\/\//);
    });
  });

  it("allows the production web + admin origins", () => {
    expect(origins).toContain("https://www.sparkinnbohol.com");
    expect(origins).toContain("https://admin.sparkinnbohol.com");
  });

  it("allows the staging web + admin origins (PC-04)", () => {
    // Regression guard: dropping these made the registration PDF
    // generator hang on the staging admin because the browser
    // blocked the cross-origin Firebase Storage read.
    expect(origins).toContain("https://stg.sparkinnbohol.com");
    expect(origins).toContain("https://stg-admin.sparkinnbohol.com");
  });

  it("allows the Vercel preview wildcard for PR previews", () => {
    // PR preview URLs are `*-<branch>.<team>.vercel.app` — Firebase
    // Storage CORS supports a `*.vercel.app` wildcard to cover all
    // of them without enumerating each.
    expect(origins).toContain("https://*.vercel.app");
  });

  it("allows the local dev origins for emulator-free local runs", () => {
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:5173");
  });

  it("exposes the HTTP methods the Firebase Storage SDK needs", () => {
    // The client SDK uses GET (downloads) and PUT (uploads) at a
    // minimum. POST/DELETE are listed for parity with the previous
    // config; not all are exercised by the SDK.
    expect(methods).toContain("GET");
    expect(methods).toContain("PUT");
  });
});
