// Per the env-aware URL fix (2026-07-24): the QR code in the admin
// dashboard must point to the same environment the staff is working in
// (staging admin → staging QR, production admin → production QR) so a
// scan during a test round-trips back to the staging guest app rather
// than the live site. See `admin-app/src/utils/apiBaseUrl.ts` for the
// resolution rules and `admin-app/src/pages/QRManagementPage.tsx` for
// the consumer.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("QR intercom URL — env-aware (2026-07-24 fix)", () => {
  const qrPage = read("admin-app/src/pages/QRManagementPage.tsx");

  it("getIntercomUrl uses getApiBaseUrl so the base URL respects the current environment", () => {
    const fn = qrPage.match(/function getIntercomUrl[\s\S]*?\n\}/);
    expect(fn, "expected to find the getIntercomUrl function").not.toBeNull();
    expect(fn?.[0]).toMatch(/getApiBaseUrl\(\)/);
    expect(fn?.[0]).not.toMatch(/https:\/\/\$\{config\.domain\}/);
  });

  it("getIntercomUrl is not hardcoded to https://${config.domain} (regression guard)", () => {
    expect(qrPage).not.toMatch(/`https:\/\/\$\{config\.domain\}\/intercom\//);
  });

  it("QRManagementPage imports getApiBaseUrl from the shared utility", () => {
    expect(qrPage).toMatch(
      /import\s*\{[^}]*\bgetApiBaseUrl\b[^}]*\}\s*from\s*"\.\.\/utils\/apiBaseUrl"/
    );
  });

  it("the static URL preview in the QR Management UI also uses the env-aware base URL", () => {
    // The display row "QR destination" shows the URL pattern with the
    // base placeholder; pre-fix it was hardcoded to https://{config.domain}.
    // After the fix it should be getApiBaseUrl() (the same helper as
    // the encoded QR value, so staff can sanity-check what they're about
    // to print).
    const preview = qrPage.match(
      /QR destination[\s\S]{0,200}\/intercom\/\[room\]/
    );
    expect(preview, "expected to find the QR destination preview block").not.toBeNull();
    expect(preview?.[0]).toMatch(/getApiBaseUrl\(\)/);
    expect(preview?.[0]).not.toMatch(/https:\/\/\{config\.domain\}/);
  });

  it("resolveApiBaseUrl still returns https://stg.<domain> for stg-admin.<domain> (regression guard)", () => {
    // The existing api-base-url.test.ts covers this, but we re-pin the
    // core staging rule here so a future refactor of that helper can't
    // silently break QR URL generation.
    const apiBaseUrl = read("admin-app/src/utils/apiBaseUrl.ts");
    expect(apiBaseUrl).toMatch(/return\s+`https:\/\/stg\.\$\{domain\}`/);
  });
});
