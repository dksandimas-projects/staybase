// Per `plan/docs/ENV-SETUP.md` and the env-aware URL fix (2026-07-24):
// every link the server emits (email templates, deep links, etc.) must
// respect the current environment so a test email from staging links
// to the staging deployment. See `guest-app/server/lib/siteUrl.ts`
// for the resolution order (SITE_URL override → VERCEL_ENV → stg.
// default).

import { describe, it, expect } from "vitest";
import { getServerBaseUrl, getServerAdminBaseUrl } from "../../server/lib/siteUrl";

const prodEnv = { VERCEL_ENV: "production" } as NodeJS.ProcessEnv;
const previewEnv = { VERCEL_ENV: "preview" } as NodeJS.ProcessEnv;
const developmentEnv = { VERCEL_ENV: "development" } as NodeJS.ProcessEnv;
const emptyEnv = {} as NodeJS.ProcessEnv;

describe("getServerBaseUrl — env-aware email + link base URL", () => {
  it("returns https://www.<domain> when VERCEL_ENV=production", () => {
    expect(getServerBaseUrl(prodEnv)).toBe("https://www.sparkinnbohol.com");
  });

  it("returns https://stg.<domain> when VERCEL_ENV=preview (Vercel preview deploy)", () => {
    expect(getServerBaseUrl(previewEnv)).toBe("https://stg.sparkinnbohol.com");
  });

  it("returns https://stg.<domain> when VERCEL_ENV=development (Vercel local dev)", () => {
    expect(getServerBaseUrl(developmentEnv)).toBe("https://stg.sparkinnbohol.com");
  });

  it("returns https://stg.<domain> when VERCEL_ENV is unset (npm test, local scripts)", () => {
    expect(getServerBaseUrl(emptyEnv)).toBe("https://stg.sparkinnbohol.com");
  });

  it("SITE_URL override wins over VERCEL_ENV=production (white-label clients)", () => {
    expect(
      getServerBaseUrl({ ...prodEnv, SITE_URL: "https://staging.acmehotel.com" })
    ).toBe("https://staging.acmehotel.com");
  });

  it("SITE_URL override wins over the default stg. fallback", () => {
    expect(
      getServerBaseUrl({ ...emptyEnv, SITE_URL: "https://acme.local" })
    ).toBe("https://acme.local");
  });

  it("SITE_URL trailing slashes are stripped", () => {
    expect(
      getServerBaseUrl({ SITE_URL: "https://acme.local////" })
    ).toBe("https://acme.local");
  });

  it("empty / whitespace SITE_URL falls through to VERCEL_ENV resolution", () => {
    expect(
      getServerBaseUrl({ ...prodEnv, SITE_URL: "   " })
    ).toBe("https://www.sparkinnbohol.com");
  });
});

describe("getServerAdminBaseUrl — env-aware admin link base URL", () => {
  it("returns https://<adminDomain> when VERCEL_ENV=production", () => {
    expect(getServerAdminBaseUrl(prodEnv)).toBe("https://admin.sparkinnbohol.com");
  });

  it("returns https://stg-admin.<domain> when VERCEL_ENV=preview", () => {
    expect(getServerAdminBaseUrl(previewEnv)).toBe("https://stg-admin.sparkinnbohol.com");
  });

  it("returns https://stg-admin.<domain> when VERCEL_ENV is unset", () => {
    expect(getServerAdminBaseUrl(emptyEnv)).toBe("https://stg-admin.sparkinnbohol.com");
  });

  it("ADMIN_SITE_URL override wins over VERCEL_ENV=production", () => {
    expect(
      getServerAdminBaseUrl({
        ...prodEnv,
        ADMIN_SITE_URL: "https://staging-admin.acmehotel.com"
      })
    ).toBe("https://staging-admin.acmehotel.com");
  });
});

describe("email handler — siteUrl / adminUrl resolve to the env-aware base", () => {
  // The handler exports these as private helpers; we exercise them
  // indirectly by reading the source. Regression guard so a future
  // refactor can't silently hardcode https://www.${config.domain} or
  // https://${config.adminDomain} back in.
  it("siteUrl no longer hardcodes https://www.${config.domain}", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );
    const siteUrlBlock = src.match(/function siteUrl\([\s\S]*?\n\}/);
    expect(siteUrlBlock, "expected to find a function siteUrl block").not.toBeNull();
    expect(siteUrlBlock?.[0]).not.toMatch(/https:\/\/www\.\$\{config\.domain\}/);
    expect(siteUrlBlock?.[0]).toMatch(/getServerBaseUrl\(\)/);
  });

  it("adminUrl no longer hardcodes https://${config.adminDomain}", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/handlers/email.ts"),
      "utf8"
    );
    const adminUrlBlock = src.match(/function adminUrl\([\s\S]*?\n\}/);
    expect(adminUrlBlock, "expected to find a function adminUrl block").not.toBeNull();
    expect(adminUrlBlock?.[0]).not.toMatch(/https:\/\/\$\{config\.adminDomain\}/);
    expect(adminUrlBlock?.[0]).toMatch(/getServerAdminBaseUrl\(\)/);
  });
});
