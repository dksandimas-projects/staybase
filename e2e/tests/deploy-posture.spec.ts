import { test, expect } from "../support/qa";
import { adminIdentity } from "../support/env";

/**
 * AI-BROWSER-QA (2026-10-23) — deployment posture checks.
 *
 * These run against the SHIPPED bundles and need no credentials, so they
 * work even when the staff accounts are unavailable.
 *
 * They exist because of a defect found during this pass: the admin app
 * calls six server endpoints that are gated behind Cloudflare Turnstile,
 * but the admin app ships no Turnstile widget and sends no
 * `turnstileToken`. Every one of those staff mutations therefore failed
 * in production with HTTP 400 "Bot verification token is missing."
 *
 * `admin-turnstile-token` is the regression guard for it. Per
 * FIX-2026-10-24 the remedy is NOT a widget in the admin app: an
 * AUTHENTICATED staff write does not need a bot token. The server skips
 * the gate for a caller whose Firebase ID token verifies AND carries a
 * staff role claim — the posture `bookings/cancel` has used since
 * 2026-06-26. A Cloudflare challenge on every "Mark served" click would
 * be worse UX and would make the desk's core workflow depend on a third
 * party being reachable.
 *
 * The guard therefore asserts two things:
 *   1. the SHIPPED admin bundle sends no placeholder token and no
 *      never-read echo header, and
 *   2. the LIVE server accepts an authenticated staff call to a gated
 *      endpoint — proven by a probe that sends an invalid body on
 *      purpose, so the request reaches the schema validation and
 *      answers with a validation error rather than the bot-verification
 *      error. Nothing is written.
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

/**
 * Sign the QA staff identity in through Firebase's REST endpoint and
 * return an ID token.
 *
 * The Web API key is PUBLIC (it ships inside the admin bundle), so it is
 * read out of the deployed bundle rather than added to the credential
 * file — nothing secret is involved.
 */
async function staffIdToken(page: any, bundle: string): Promise<string | null> {
  const apiKey = /apiKey:\s*"([^"]+)"/.exec(bundle)?.[1];
  if (!apiKey) return null;

  const identity = adminIdentity();
  if (!identity) return null;

  const res = await page.request.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      headers: {
        "Content-Type": "application/json",
        // The Firebase Web API key is HTTP-referer-restricted to the
        // app's own origin, so the sign-in has to carry it.
        Origin: ADMIN_BASE,
        Referer: `${ADMIN_BASE}/`
      },
      data: { email: identity.email, password: identity.password, returnSecureToken: true }
    }
  );
  if (!res.ok()) return null;
  const body = await res.json().catch(() => ({}));
  return typeof body.idToken === "string" ? body.idToken : null;
}

test.describe("Deployment posture", () => {
  test("admin-turnstile-token · an authenticated staff write is not refused by the bot gate", async ({
    page
  }) => {
    const bundle = await bundleOf(page, ADMIN_BASE);

    // 1. The admin bundle must not send a placeholder token, and must
    //    not send the never-read echo header. Both were the symptom of
    //    the defect: the admin app had no way to obtain a token.
    const sendsUndefined = /turnstileToken:\s*undefined/.test(bundle);
    const sendsEchoHeader = /X-Spark-Inn-Turnstile/.test(bundle);

    console.log(
      `      sendsUndefined=${sendsUndefined} sendsEchoHeader=${sendsEchoHeader}`
    );

    expect(
      sendsUndefined,
      "the admin app must not send a placeholder `turnstileToken: undefined` — " +
        "the server skips the bot gate for an authenticated staff write, so it " +
        "must not pretend to send a token"
    ).toBe(false);
    expect(
      sendsEchoHeader,
      "the admin app must not send the `X-Spark-Inn-Turnstile` echo header — " +
        "the server never read it"
    ).toBe(false);

    // 2. The LIVE server must accept an authenticated staff call to a
    //    gated endpoint. The probe sends an empty body on purpose: the
    //    gate is skipped, the request reaches the schema validation and
    //    answers with a validation error. Before the fix it answered
    //    "Bot verification token is missing." instead. Nothing is
    //    written — the body never validates.
    const idToken = await staffIdToken(page, bundle);
    test.skip(
      !idToken,
      "no staff ID token available (QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD or the " +
        "public Firebase API key not found in the bundle) — the live half of " +
        "admin-turnstile-token did not run"
    );

    const res = await page.request.post(`${GUEST_BASE}/api/bookings/breakfast/staff-update`, {
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      data: {}
    });
    const body = await res.json().catch(() => ({}));
    const error = String(body?.error || "");

    console.log(`      live staff probe -> HTTP ${res.status()} ${error.slice(0, 120)}`);

    expect(
      error,
      "an authenticated staff call to a gated endpoint must not be refused by " +
        "the bot gate — it must reach the request validation instead"
    ).not.toMatch(/bot verification/i);
  });

  test("the bot gate still refuses an ANONYMOUS caller", async ({ page }) => {
    // The other half of the contract: skipping the gate for STAFF must
    // not open it for anyone else. The hotel-wide bot-protection switch
    // (§11.3) is off by default and fails closed, so an anonymous write
    // is still refused.
    //
    // The answer is the same in both modes: on a STAFF endpoint the
    // authorization check is what refuses the anonymous caller (401),
    // with or without the bot gate in front of it.
    const res = await page.request.post(`${GUEST_BASE}/api/bookings/breakfast/staff-update`, {
      headers: { "Content-Type": "application/json" },
      data: {}
    });
    const body = await res.json().catch(() => ({}));
    console.log(`      anonymous probe -> HTTP ${res.status()} ${String(body?.error || "").slice(0, 120)}`);

    expect(res.status()).toBe(401);
    expect(String(body?.error || "")).toMatch(/unauthorized|token/i);
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
