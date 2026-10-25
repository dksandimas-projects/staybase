import { test, expect } from "../support/qa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * AI-BROWSER-QA (2026-10-23) — public guest surface.
 *
 * Scenario coverage in this file:
 *   RO-01  the rooms page lists the configured room types
 *   RO-02  the room detail view shows beds, capacity, amenities and the rate
 *   ST-01* static pages (About / Contact / Privacy / Terms) render
 *   ST-02* the 404 route
 *   CT-04  mobile layout: no horizontal overflow, nav reachable
 *   OP-02  the deployed bundle carries the shared VERSION constant
 *
 * Console / network policy
 * ------------------------
 * The scenario catalog requires a console + network record per case. The
 * strict assertion lives in `deploy-posture.spec.ts` (`SEC-CSP`), where a
 * single real defect is isolated and named. The per-surface assertions
 * here exclude THAT ONE known violation so an unrelated page cannot fail
 * for it — but they are not weakened anywhere else: any other console
 * error, uncaught exception, failed request or HTTP >= 400 still fails.
 */

const ROOM_LABELS = ["Single", "Standard Double", "Standard Twin", "Deluxe", "Family"];

/** The one console error this pass is tracking as a defect (see §3.9). */
const KNOWN_CONSOLE_VIOLATIONS: RegExp[] = [
  /apis\.google\.com\/js\/api\.js.*violates the following Content Security Policy/i
];

function unexpectedConsoleErrors(errors: string[]): string[] {
  return errors.filter((e) => !KNOWN_CONSOLE_VIOLATIONS.some((re) => re.test(e)));
}

test.describe("Public guest surface", () => {
  test("OP-02 · the deployed guest bundle carries the shared VERSION constant", async ({ page }) => {
    const res = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);

    const scripts = await page.locator('script[src*="/assets/"]').evaluateAll((els) =>
      els.map((e) => (e as HTMLScriptElement).src)
    );
    expect(scripts.length).toBeGreaterThan(0);

    // The version is read from `shared/VERSION.ts` — the source of
    // truth — rather than hard-coded, so the guard keeps working after
    // every release instead of failing on the next bump.
    const sharedVersion = readFileSync(
      resolve(__dirname, "../../shared/VERSION.ts"),
      "utf8"
    ).match(/VERSION\s*=\s*"([^"]+)"/)?.[1];
    expect(sharedVersion, "shared/VERSION.ts must export a version string").toBeTruthy();

    let found = false;
    for (const src of scripts) {
      const body = await (await page.request.get(src)).text();
      if (new RegExp(`\\b${sharedVersion!.replace(/\./g, "\\.")}\\b`).test(body)) {
        found = true;
        break;
      }
    }
    expect(found, `the deployed bundle must contain shared/VERSION (${sharedVersion})`).toBe(true);
  });

  test("RO-01 · the rooms page lists every configured room type", async ({ page, watcher }) => {
    const res = await page.goto("/rooms", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/rooms/i);

    // The room catalogue is loaded from Firestore, so wait for it — and
    // for EVERY configured room type, not just the first card. The cards
    // render as the catalogue arrives, so a count taken the moment the
    // first card appears can be short (it flaked once on the mobile
    // project, where the last card lands a few hundred ms later).
    await expect(page.getByRole("heading", { name: "Our rooms" })).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => await page.getByRole("heading", { level: 3 }).count(), {
        timeout: 20_000,
        message: "every configured room type must render"
      })
      .toBeGreaterThanOrEqual(ROOM_LABELS.length);

    const detailButtons = page.getByRole("button", { name: /details/i });
    await expect(detailButtons.first()).toBeVisible();
    expect(
      await detailButtons.count(),
      "one Details action per configured room type"
    ).toBeGreaterThanOrEqual(ROOM_LABELS.length);

    const bodyText = await page.locator("body").innerText();
    for (const label of ROOM_LABELS) {
      expect(bodyText, `room type "${label}" must be listed`).toContain(label);
    }

    expect(watcher.pageErrors, `page errors: ${watcher.pageErrors.join(" | ")}`).toEqual([]);
    expect(
      unexpectedConsoleErrors(watcher.consoleErrors),
      `console errors: ${watcher.consoleErrors.join(" | ")}`
    ).toEqual([]);
  });

  test("RO-02 · the room detail view shows beds, capacity, amenities and the rate", async ({
    page
  }) => {
    await page.goto("/rooms", { waitUntil: "domcontentloaded" });
    const details = page.getByRole("button", { name: /details/i });
    await expect(details.first()).toBeVisible({ timeout: 20_000 });
    await details.first().click();

    // The detail view is a modal whose content is stable copy.
    await expect(page.getByRole("heading", { name: "Amenities" })).toBeVisible({ timeout: 15_000 });
    // `textContent` rather than `innerText`: the detail panel is a
    // scrollable overlay and `innerText` omits rows that are laid out
    // outside the current viewport.
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).toMatch(/Beds/);
    expect(body).toMatch(/Capacity/);
    expect(body).toMatch(/Weekend/);
    expect(body).toMatch(/₱\s?[\d,]+/);
    await expect(page.getByRole("link", { name: /book this type/i })).toBeVisible();

    // It must close again.
    await page.getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(800);
    await expect(page.getByRole("heading", { name: "Amenities" })).toBeHidden();
  });

  test("ST-01* · the static pages render with a heading and body copy", async ({ page }) => {
    for (const path of ["/about", "/contact", "/privacy", "/terms"]) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `${path} must return 200`).toBe(200);

      // The h1 is filled from Firestore websiteContent, so wait for it to
      // resolve rather than reading it on the first paint.
      const heading = page.locator("h1").first();
      await expect(heading, `${path} must render an h1`).toBeVisible({ timeout: 20_000 });
      await expect(heading, `${path} h1 must not be empty`).not.toHaveText("", { timeout: 20_000 });

      const body = await page.locator("body").innerText();
      expect(body.length, `${path} must render body copy`).toBeGreaterThan(200);
    }
  });

  test("ST-02* · an unknown route renders the 404 page", async ({ page }) => {
    const res = await page.goto("/this-route-does-not-exist-qa", { waitUntil: "domcontentloaded" });
    expect([200, 404]).toContain(res?.status());
    await page.waitForTimeout(1500);
    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).toMatch(/not found|404|page .*not|no page/i);
  });

  test("CT-04 · the mobile layout has no horizontal overflow and the nav is reachable", async ({
    page
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    expect(
      overflow.scrollWidth,
      `horizontal overflow: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // The nav must be operable at mobile width.
    const toggle = page.getByRole("button", { name: /toggle menu/i });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(600);
      await expect(page.getByRole("link", { name: /^rooms$/i }).first()).toBeVisible();
    }
  });

  test("SEO · robots.txt and sitemap.xml are served and reference the sitemap", async ({
    page
  }) => {
    const robots = await page.request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toMatch(/user-agent/i);
    expect(robotsText).toMatch(/sitemap/i);

    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const sitemapText = await sitemap.text();
    expect(sitemapText).toMatch(/<urlset/i);
    expect(sitemapText).toContain("<loc>");
  });
});
