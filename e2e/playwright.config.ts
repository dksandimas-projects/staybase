import { defineConfig, devices } from "@playwright/test";

/**
 * AI-BROWSER-QA (2026-10-23) — Playwright configuration.
 *
 * TARGET: PRODUCTION (https://www.sparkinnbohol.com + https://admin.sparkinnbohol.com).
 * Staging is unavailable, and the hotel is not yet in public use, so the
 * production controls in the handoff apply: dedicated QA identities only,
 * every created record tracked, no real payments.
 *
 * DESIGN RULES
 *  - Two projects: `desktop` (1440x900) and `mobile` (Pixel 5). Every
 *    browser scenario runs on both unless it is explicitly desktop-only.
 *  - `workers: 1` — the production booking endpoint is rate limited to
 *    5 requests/minute/IP, and several scenarios write to Firestore.
 *    Parallel workers would trip the rate limiter and produce false
 *    failures that look like product bugs.
 *  - `retries: 0` — a flaky retry hides a real defect. A failure is a
 *    failure.
 *  - `trace: "retain-on-failure"` — every failing test keeps its trace,
 *    video and screenshots as evidence.
 *  - Credentials come from the environment ONLY. `.qa.env.local` is
 *    gitignored and never committed. See `e2e/support/env.ts`.
 */

const GUEST_BASE_URL = process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com";
const ADMIN_BASE_URL = process.env.QA_ADMIN_BASE_URL || "https://admin.sparkinnbohol.com";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.artifacts/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "./.artifacts/results.json" }],
    ["html", { outputFolder: "./.artifacts/report", open: "never" }]
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    // A real browser UA is not required for correctness, but the site
    // serves a mobile layout to narrow viewports and the admin app has a
    // dedicated < 768px mode, so the mobile project must not look like a
    // desktop browser with a small window.
    ignoreHTTPSErrors: false
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        isMobile: false,
        hasTouch: false,
        baseURL: GUEST_BASE_URL
      }
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        baseURL: GUEST_BASE_URL
      }
    }
  ]
});

export const BASE_URLS = { guest: GUEST_BASE_URL, admin: ADMIN_BASE_URL };
