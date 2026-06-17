import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #2: the CORS headers used to be `*` +
// `Access-Control-Allow-Credentials: true`, which browsers reject.
// Per W4.6 / W1.13 / decision #106, the fix is an explicit allowlist
// from config.domain + config.adminDomain + dev origins, and the
// credentials header is removed (Firebase ID tokens ride in the
// Authorization header, not cookies).

describe("[...route].ts — CORS explicit allowlist (SEV-1 #2)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../api/[...route].ts"),
    "utf8"
  );

  it("no longer uses Access-Control-Allow-Origin: *", () => {
    expect(src).not.toMatch(/setHeader\(\s*["']Access-Control-Allow-Origin["']\s*,\s*["']\*["']/);
  });

  it("no longer sets Access-Control-Allow-Credentials: true", () => {
    expect(src).not.toMatch(/setHeader\(\s*["']Access-Control-Allow-Credentials["']\s*,\s*["']true["']/);
  });

  it("defines an ALLOWED_ORIGINS Set built from config.domain + config.adminDomain + dev origins", () => {
    expect(src).toMatch(/ALLOWED_ORIGINS\s*=\s*new Set/);
    expect(src).toMatch(/config\.domain/);
    expect(src).toMatch(/config\.adminDomain/);
    // Dev origins
    expect(src).toMatch(/localhost:5173/); // guest-app
    expect(src).toMatch(/localhost:5174/); // admin-app
  });

  it("echoes the request Origin only if it matches the allowlist", () => {
    // The fix uses a Set lookup; the response header is set conditionally
    expect(src).toMatch(/if\s*\(\s*ALLOWED_ORIGINS\.has\(/);
    expect(src).toMatch(/setHeader\(\s*["']Access-Control-Allow-Origin["']\s*,\s*allowOrigin\s*\)/);
  });

  it("sets the Vary: Origin header so caches don't poison the response", () => {
    expect(src).toMatch(/setHeader\(\s*["']Vary["']\s*,\s*["']Origin["']\s*\)/);
  });
});
