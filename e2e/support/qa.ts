import { test as base, expect, type Page, type ConsoleMessage } from "@playwright/test";
import {
  ENV_CONFIG,
  QA_RUN_ID,
  adminIdentity,
  frontDeskIdentity,
  memberIdentity,
  type Identity
} from "./env";

/**
 * AI-BROWSER-QA (2026-10-23) — shared test fixtures.
 *
 * Two things every spec needs:
 *  1. A console/network watchdog. The scenario catalog requires recording
 *     console and network errors for each case, so they are captured
 *     automatically rather than remembered. `assertClean()` is opt-in per
 *     test because a few surfaces are EXPECTED to log (e.g. a deliberately
 *     invalid request).
 *  2. Auth helpers that skip — never silently pass — when the matching
 *     credential is not available.
 */

export type Watcher = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  httpErrors: string[];
  reset: () => void;
  summary: () => string;
};

export const test = base.extend<{ watcher: Watcher }>({
  watcher: async ({ page }, use) => {
    const watcher: Watcher = {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [],
      reset: () => {
        watcher.consoleErrors = [];
        watcher.consoleWarnings = [];
        watcher.pageErrors = [];
        watcher.failedRequests = [];
        watcher.httpErrors = [];
      },
      summary: () =>
        [
          `console errors: ${watcher.consoleErrors.length}`,
          `page errors: ${watcher.pageErrors.length}`,
          `failed requests: ${watcher.failedRequests.length}`,
          `http>=400: ${watcher.httpErrors.length}`
        ].join(" · ")
    };

    page.on("console", (m: ConsoleMessage) => {
      const text = m.text();
      if (m.type() === "error") watcher.consoleErrors.push(text.slice(0, 300));
      if (m.type() === "warning") watcher.consoleWarnings.push(text.slice(0, 300));
    });
    page.on("pageerror", (e) => watcher.pageErrors.push(String(e).slice(0, 300)));
    page.on("requestfailed", (r) => {
      const text = `${r.method()} ${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`;
      // Cloudflare's challenge platform hosts are unreachable from some
      // networks; the widget degrades but the product still renders. The
      // failure is recorded, not hidden.
      watcher.failedRequests.push(text);
    });
    page.on("response", (r) => {
      if (r.status() >= 400) watcher.httpErrors.push(`${r.status()} ${r.url().slice(0, 180)}`);
    });

    await use(watcher);
  }
});

export { expect };

/** Skip with an explicit reason rather than passing silently. */
export function requireIdentity(kind: string, identity: Identity | null): Identity {
  if (!identity) {
    test.skip(true, `No credentials for the ${kind} QA identity — scenario not executed.`);
  }
  return identity as Identity;
}

/** Staff sign-in on the admin app. */
export async function staffLogin(page: Page, identity: Identity) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(identity.email);
  await page.locator("#pwd").fill(identity.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/admin\/|\/$|\/bookings/i, { timeout: 45_000 });
  // The admin app renders the signed-in shell only once the role claim
  // resolves; a rejected role signs the user straight back out.
  await page.waitForTimeout(1500);
}

/** Guest sign-in on the rewards/account surface. */
export async function guestLogin(page: Page, identity: Identity) {
  await page.goto("/signin", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(identity.email);
  await page.locator('input[type="password"]').fill(identity.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/account|\/rewards|\/$/i, { timeout: 45_000 });
  await page.waitForTimeout(1200);
}

/**
 * The test-run id stamped onto every booking this pass creates. It makes
 * "every record I created" a Firestore query rather than a promise.
 */
export const testRunId = QA_RUN_ID;

/**
 * A future date pair far enough out that the room inventory is not
 * contended, used by the read-only availability assertions.
 */
export function futureStay(offsetDays = 30) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const start = new Date(Date.now() + offsetDays * 86400000);
  const end = new Date(Date.now() + (offsetDays + 1) * 86400000);
  return { checkIn: fmt(start), checkOut: fmt(end) };
}

export const ENV = ENV_CONFIG;
export const ADMIN = adminIdentity;
export const FRONT_DESK = frontDeskIdentity;
export const MEMBER = memberIdentity;
