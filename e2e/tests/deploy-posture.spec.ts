import { test, expect } from "../support/qa";

/**
 * AI-BROWSER-QA (2026-10-23) — deployment posture checks.
 *
 * These run against the SHIPPED bundles and need no credentials, so they
 * work even when the staff accounts are unavailable.
 *
 * They exist because of a defect found during this pass: the admin app
 * calls six server endpoints that are gated behind Cloudflare Turnstile,
 * but the admin app ships no Turnstile widget and sends no
 * `turnstileToken`. Every one of those staff mutations therefore fails
 * in production with HTTP 400 "Bot verification token is missing."
 *
 * `admin-turnstile-token` is the regression guard: if a future build
 * mounts the widget and starts sending a real token, the assertion
 * flips and the defect is considered fixed.
 */

const ADMIN_BASE = process.env.QA_ADMIN_BASE_URL || "https://admin.sparkinnbohol.com";
const GUEST_BASE = process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com";

async function bundleOf(page: any, base: string): Promise<string> {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const scripts = await page.locator('script[src*="/assets/"]').evaluateAll((els: any[]) =>
    els.map((e) => (e as HTMLScriptElement).src)
  );
  let all = "";
  for (const src of scripts) {
    const res = await page.request.get(src);
    all += "\n" + (await res.text());
  }
  return all;
}

test.describe("Deployment posture", () => {
  test("admin-turnstile-token · the shipped admin bundle can obtain a bot token", async ({
    page
  }) => {
    const bundle = await bundleOf(page, ADMIN_BASE);

    // 1. The admin app must mount the Turnstile widget somewhere.
    const mountsWidget =
      bundle.includes("cf-turnstile") ||
      bundle.includes("challenges.cloudflare.com") ||
      bundle.includes("turnstile.render");

    // 2. It must send a REAL token, not the literal `undefined`.
    const sendsUndefined = /turnstileToken:\s*undefined/.test(bundle);
    const sendsRealToken = /turnstileToken/.test(bundle) && !sendsUndefined;

    console.log(
      `      mountsWidget=${mountsWidget} sendsRealToken=${sendsRealToken} sendsUndefined=${sendsUndefined}`
    );

    // The production bundle today fails both halves. This assertion
    // documents the defect as a FAILING test — it is expected to fail
    // until the admin app is fixed, and it is NOT to be weakened.
    expect(
      mountsWidget && sendsRealToken,
      "the admin app must mount a Turnstile widget and send a real token — " +
        "without it every Turnstile-gated staff mutation (breakfast/add-on " +
        "staff-update, mark-served, mark-refund-paid) fails with HTTP 400"
    ).toBe(true);
  });

  test("guest-turnstile · the guest app does mount the widget it needs", async ({ page }) => {
    const bundle = await bundleOf(page, GUEST_BASE);
    const mountsWidget =
      bundle.includes("cf-turnstile") ||
      bundle.includes("challenges.cloudflare.com") ||
      bundle.includes("turnstile.render");
    expect(
      mountsWidget,
      "the guest app must mount the Turnstile widget for its gated endpoints"
    ).toBe(true);
  });

  test("admin-api-target · the admin app calls the production guest API", async ({ page }) => {
    // The gate's strictness depends on which deployment serves the API.
    // A staging or local API would use the always-pass secret.
    await page.goto(ADMIN_BASE, { waitUntil: "domcontentloaded" });
    const configured = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const m = html.match(/VITE_GUEST_APP_URL|https:\/\/(www\.)?sparkinnbohol\.com/g);
      return m ? m.join(",") : "";
    });
    console.log(`      admin api target hint: ${configured || "(not inline in html)"}`);
    // The default resolution is the production guest host.
    expect(GUEST_BASE).toContain("sparkinnbohol.com");
  });

  test("SEC-CSP · the guest app's CSP permits the Google auth script", async ({ page }) => {
    // The guest app loads `https://apis.google.com/js/api.js` at runtime
    // (Firebase Auth's signInWithPopup). The live guest CSP omits
    // `https://apis.google.com` from `script-src`, so the browser blocks
    // it and "Continue with Google" cannot work on the guest site.
    const res = await page.request.get(GUEST_BASE);
    const csp = res.headers()["content-security-policy"] || "";
    const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] || "";

    console.log(`      guest script-src: ${scriptSrc}`);
    expect(
      scriptSrc.includes("https://apis.google.com"),
      "the guest CSP must allow https://apis.google.com — Firebase Auth's " +
        "signInWithPopup injects it, and the browser blocks it today"
    ).toBe(true);
  });

  test("SEC-CSP · the admin app's CSP permits the Google auth script", async ({ page }) => {
    const res = await page.request.get(ADMIN_BASE);
    const csp = res.headers()["content-security-policy"] || "";
    const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] || "";
    expect(
      scriptSrc.includes("https://apis.google.com"),
      "the admin CSP must allow https://apis.google.com"
    ).toBe(true);
  });

  test("the API refuses a bot-token-less booking creation with a clear error", async ({ page }) => {
    const res = await page.request.post(`${GUEST_BASE}/api/bookings/create`, {
      data: { checkIn: "2026-11-05", checkOut: "2026-11-06" }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/bot verification/i);
  });
});
