import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import handler from "../../server/apiRouter";

vi.mock("../../server/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: vi.fn()
  },
  adminDb: {
    collection: vi.fn()
  },
  adminStorage: {
    bucket: vi.fn()
  }
}));

// Regression test for SEV-1 #2: the CORS headers used to be `*` +
// `Access-Control-Allow-Credentials: true`, which browsers reject.
// Per W4.6 / W1.13 / decision #106, the fix is an explicit allowlist
// from explicit production + dev origins, and the credentials header
// is removed (Firebase ID tokens ride in the Authorization header,
// not cookies).

describe("[...route].ts — CORS explicit allowlist (SEV-1 #2)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../server/apiRouter.ts"),
    "utf8"
  );
  const rootApiSrc = readFileSync(
    resolve(__dirname, "../../../api/[...route].ts"),
    "utf8"
  );
  const vercelConfig = JSON.parse(
    readFileSync(resolve(__dirname, "../../vercel.json"), "utf8")
  ) as { rewrites?: Array<{ source: string; destination: string }> };

  it("no longer uses Access-Control-Allow-Origin: *", () => {
    expect(src).not.toMatch(/setHeader\(\s*["']Access-Control-Allow-Origin["']\s*,\s*["']\*["']/);
  });

  it("no longer sets Access-Control-Allow-Credentials: true", () => {
    expect(src).not.toMatch(/setHeader\(\s*["']Access-Control-Allow-Credentials["']\s*,\s*["']true["']/);
  });

  it("defines an ALLOWED_ORIGINS Set built from production + dev origins", () => {
    expect(src).toMatch(/ALLOWED_ORIGINS\s*=\s*new Set/);
    expect(src).toMatch(/https:\/\/sparkinnbohol\.com/);
    expect(src).toMatch(/https:\/\/www\.sparkinnbohol\.com/);
    expect(src).toMatch(/https:\/\/admin\.sparkinnbohol\.com/);
    // Dev origins
    expect(src).toMatch(/localhost:5173/); // guest-app
    expect(src).toMatch(/localhost:5174/); // admin-app
  });

  it("echoes the request Origin only if it matches the allowlist", () => {
    // The fix uses a Set lookup; the response header is set conditionally
    expect(src).toMatch(/ALLOWED_ORIGINS\.has\(\s*parsedOrigin\s*\)/);
    expect(src).toMatch(/setHeader\(\s*["']Access-Control-Allow-Origin["']\s*,\s*allowOrigin\s*\)/);
  });

  it("sets the Vary: Origin header so caches don't poison the response", () => {
    expect(src).toMatch(/setHeader\(\s*["']Vary["']\s*,\s*["']Origin["']\s*\)/);
  });

  it("keeps the API entrypoint free of risky runtime imports before preflight", () => {
    expect(src).not.toMatch(/from\s+["']@config["']/);
    expect(src).not.toMatch(/from\s+["']\.\.\/\.\.\/hotel\.config["']/);
    expect(src).not.toMatch(/from\s+["']@spark-inn\/shared["']/);
  });

  it("exposes the guest-app API from the repo root for root-directory Vercel deployments", () => {
    expect(rootApiSrc).toMatch(/export\s+\{\s*default\s*\}\s+from\s+["']\.\.\/guest-app\/api\/\[\.\.\.route\]["']/);
  });

  it("does not rewrite /api routes through the SPA fallback", () => {
    expect(vercelConfig.rewrites || []).toContainEqual({
      source: "/api/:path*",
      destination: "/api/%5B...route%5D?route=:path*"
    });
    expect(vercelConfig.rewrites || []).not.toContainEqual({
      source: "/(.*)",
      destination: "/index.html"
    });
    expect(vercelConfig.rewrites || []).toContainEqual({
      source: "/((?!api/).*)",
      destination: "/index.html"
    });
  });

  it("answers admin create-staff preflight with the admin origin allow header", async () => {
    const req = {
      method: "OPTIONS",
      url: "/api/%5B...route%5D?route=admin/create-staff",
      query: {
        route: "admin/create-staff"
      },
      headers: {
        host: "www.sparkinnbohol.com",
        origin: "https://admin.sparkinnbohol.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      },
      socket: {
        remoteAddress: "127.0.0.1"
      }
    } as any;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis()
    };

    await handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "https://admin.sparkinnbohol.com");
    expect(res.setHeader).toHaveBeenCalledWith("Vary", "Origin");
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      expect.stringContaining("Authorization")
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
  });
});
