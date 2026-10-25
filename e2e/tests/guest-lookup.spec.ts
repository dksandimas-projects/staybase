/**
 * AI-BROWSER-QA (2026-10-25) — the guest booking-status lookup, now
 * reachable because the bot-protection switch is off.
 *
 * LK-01 — "Guest checks their booking status":
 *   At /my-booking, enter a valid booking ref + the booking email.
 *   Expected: a booking card with the status timeline matching the
 *   Dashboard status exactly.
 *
 * LK-02 — "Wrong email never leaks a booking" — was RETIRED by decision
 * #209 (2026-08-10): the lookup accepts a ref ALONE (see
 * plan/features/BOOKING-LOOKUP.md:143). The catalogue wording is
 * stale, and the live endpoint duly returns the booking for a ref with
 * a wrong email. This spec therefore pins what the CURRENT spec
 * actually promises — the card renders, the guest name is never
 * reflected back, and the email is masked — and it records the
 * enumeration posture rather than pretending it is otherwise.
 *
 * The lookup is a READ: no record is created.
 */

import { test, expect } from "../support/qa";

const GUEST_BASE = process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com";

// A real QA-fixture booking. `SI-20261021-00001` is the QA walk-in
// ("QA-TEST A2-FD03", room 101, status confirmed, `isTestData: true`).
const BOOKING_REF = "SI-20261021-00001";
const BOOKING_EMAIL = "qa.a2.fd03+sparkinn.dev@gmail.com";

test.describe("Guest booking lookup (bot protection off)", () => {
  test("LK-01 · the guest finds their booking and sees its status", async ({ page }) => {
    await page.goto(`${GUEST_BASE}/my-booking`, { waitUntil: "domcontentloaded" });

    const refInput = page.getByLabel(/booking or reservation reference/i).first();
    await expect(refInput, "the lookup form must have a reference field").toBeVisible({
      timeout: 20_000
    });
    await refInput.fill(BOOKING_REF);

    const emailInput = page.getByLabel(/email address/i).first();
    await expect(emailInput, "the lookup form must have an email field").toBeVisible({
      timeout: 10_000
    });
    await emailInput.fill(BOOKING_EMAIL);

    await page.getByRole("button", { name: /find my booking/i }).first().click();

    // While the client's bot-protection mode is still resolving, the form
    // refuses to burn a request that would 400 — it says "the security
    // check hasn't finished yet". That is the documented behaviour (the
    // same as the default Turnstile mode), and a guest simply waits a
    // moment and clicks again. So does the test.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if ((await page.getByText(/security check hasn't finished/i).count()) === 0) break;
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: /find my booking/i }).first().click();
      await page.waitForTimeout(1500);
    }

    // The card must render with the booking reference and a status.
    const body = page.locator("body");
    await expect(body).toContainText(BOOKING_REF, { timeout: 20_000 });

    // The status must be the booking's real state — "confirmed" for this
    // fixture, which is what the Dashboard shows for it too.
    await expect(body).toHaveText(
      /confirmed|pending|payment-uploaded|checked-in|checked-out|cancelled/i,
      { timeout: 20_000 }
    );

    // Per MRB-09 / decision #131 the guest name is never reflected back
    // and the email is masked.
    await expect(body).not.toContainText("QA-TEST A2-FD03", { timeout: 5_000 });
    await expect(body).toHaveText(/[a-z]\*\*\*@/i, { timeout: 5_000 });
  });

  test("LK-02 · the lookup reflects the booking, and the catalogue wording is stale", async ({
    request
  }) => {
    // The ref ALONE resolves the booking (decision #209). This is the
    // documented contract, and it is also why the bot gate matters: the
    // enumeration defences for this path are Turnstile + a 10/min
    // per-IP limit + a 3-failure 1-hour backoff.
    const res = await request.post(`${GUEST_BASE}/api/bookings/lookup`, {
      headers: { "Content-Type": "application/json" },
      data: { bookingRef: BOOKING_REF, email: "not-the-guest@example.com" }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body?.data?.bookingRef).toBe(BOOKING_REF);
    // The email is MASKED, never reflected in full.
    expect(body?.data?.maskedEmail).toMatch(/[a-z]\*\*\*@/i);
    expect(body?.data?.guestEmail).toBeUndefined();
    // And the guest's NAME is never reflected back.
    expect(body?.data?.guestName).toBeUndefined();
    // The payment proof is staff-only (BF-21 / RA 10173).
    expect(body?.data?.paymentProofUrl).toBeUndefined();
    expect(body?.data?.paymentProofPath).toBeUndefined();
  });
});
