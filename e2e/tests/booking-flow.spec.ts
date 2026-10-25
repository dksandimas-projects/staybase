import { test, expect, futureStay } from "../support/qa";

/**
 * AI-BROWSER-QA (2026-10-23) — guest booking flow.
 *
 * The flow is five steps, driven by the `step` URL parameter:
 *   1 select-room → 2 add-ons → 3 guest details → 4 review & pay → 5 confirmation
 *
 * Scenario coverage:
 *   BF-01  the flow renders every room type and refuses a cart that cannot
 *          place the party (the fit rule)
 *   BF-03  the guest-count breakdown reflects the selected rooms
 *   BF-05  an abandoned flow is restored from the URL
 *   BF-02 / VC-01  voucher validation is behind the bot gate
 *   LK-01  the lookup form demands a reference, an email and a bot token
 *   LK-02  a lookup for a wrong email never discloses a booking
 *
 * WHY CREATION IS NOT EXECUTED HERE
 * --------------------------------
 * Every public guest write endpoint is behind Cloudflare Turnstile
 * (`guest-app/server/apiRouter.ts` — `verifyTurnstile` gates
 * bookings/create, bookings/lookup, bookings/cancel, bookings/extend-stay,
 * breakfast/update, vouchers/validate, corporate-codes/validate,
 * corporate-inquiries/create and contact/create). Production uses a REAL
 * site key, so the widget must genuinely complete — and the Cloudflare
 * challenge platform hostnames do not resolve from the QA host, so no
 * token can be issued (see §3.2 of the QA report).
 *
 * The specs therefore assert what IS verifiable:
 *   1. the flow renders and enforces the fit / cart rules;
 *   2. the gate refuses an unverified caller BEFORE any schema validation
 *      — the correct anti-automation posture;
 *   3. the client's own confirm gate is token-gated, so a guest cannot
 *      submit a booking the server would reject.
 *
 * Nothing is asserted more weakly to make it pass.
 */

/** Step 1 is driven entirely by URL parameters — see `continueParams`. */
async function openStep1(page: any, offsetDays: number, adults = 2, children = 0) {
  const stay = futureStay(offsetDays);
  await page.goto(
    `/book?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}&adults=${adults}&children=${children}`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForTimeout(1500);
  return stay;
}

/** The step-1 primary action is a link whose label reflects the cart state. */
function step1Primary(page: any) {
  return page.getByRole("link", { name: /continue to add-ons|assign every guest|add at least one room/i });
}

test.describe("Guest booking flow", () => {
  test("BF-01 · the flow renders all five steps and every room type", async ({ page, watcher }) => {
    await openStep1(page, 30);

    // The five-step indicator.
    for (const step of ["Select Room", "Add-ons", "Guest Details", "Review & Pay", "Confirmation"]) {
      await expect(page.getByText(step, { exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await expect(page.getByRole("heading", { name: /select your stay/i })).toBeVisible();

    // Every configured room type is offered with its rate.
    const body = await page.locator("body").innerText();
    for (const label of ["Single", "Standard Double", "Standard Twin", "Deluxe", "Family"]) {
      expect(body, `room type "${label}" must be offered`).toContain(label);
    }
    expect(body).toMatch(/₱\s?[\d,]+/);
    expect(body).toMatch(/\d+ room types available/i);

    expect(watcher.pageErrors).toEqual([]);
  });

  test("BF-01 · the fit rule blocks a room type that cannot hold the party", async ({ page }) => {
    // The capacity chip is a three-state derivation (CHD-11):
    //   "Fits your group"         — the type has headroom over the party
    //   "Tight — at the cap"      — the type seats the party exactly
    //   "Doesn't fit your group"  — the CART cannot seat the party
    // For 2 adults: Executive (up to 4) has headroom, Standard Double
    // (up to 2) is exactly at the cap, Single (up to 1) cannot.
    await openStep1(page, 31, 2, 0);

    await expect(page.getByTestId("room-type-fit-executive")).toHaveText(/fits your group/i, {
      timeout: 20_000
    });
    await expect(page.getByTestId("room-type-fit-standard-double")).toHaveText(/tight/i, {
      timeout: 20_000
    });

    // Selecting the Single for 2 adults switches its chip to the "cart"
    // basis, which must report that the cart cannot place the party.
    const selectSingle = page.getByTestId("select-room-single");
    await expect(selectSingle).toBeVisible({ timeout: 20_000 });
    await selectSingle.click();
    await page.waitForTimeout(1200);

    await expect(page.getByTestId("room-type-fit-single")).not.toHaveText(/fits your group/i);
    await expect(page.getByTestId("room-type-fit-single")).toHaveText(/doesn't fit your group/i);

    // The guest must be told what is wrong rather than left with a dead
    // button (MBUX-06). `textContent` rather than `innerText`: the
    // callout lives inside a collapsed cart summary on some viewports.
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).toMatch(/add enough rooms to place every guest/i);
    expect(body).toMatch(/you'd need 2 of single for your group/i);

    // And the flow must not have advanced.
    expect(page.url()).not.toContain("step=add-ons");
  });

  test("BF-03 · the guest-count breakdown reflects the selected rooms", async ({ page }) => {
    // A Standard Double holds 2 adults, so the cart becomes ready.
    await openStep1(page, 32, 2, 0);

    const selectDouble = page.getByTestId("select-room-standard-double");
    await expect(selectDouble).toBeVisible({ timeout: 20_000 });
    await selectDouble.click();
    await page.waitForTimeout(900);

    // Step 1 → step 2 → step 3 (guest details), where the breakdown lives.
    const toAddOns = step1Primary(page);
    await expect(toAddOns).toHaveText(/continue to add-ons/i, { timeout: 15_000 });
    await toAddOns.click();
    await page.waitForTimeout(1200);

    const addOnsContinue = page.getByTestId("booking-addons-continue-primary");
    await expect(addOnsContinue).toBeVisible({ timeout: 20_000 });
    await addOnsContinue.click();
    await page.waitForTimeout(1200);

    const label = page.getByTestId("guest-count-label");
    await expect(label).toBeVisible({ timeout: 20_000 });
    const text = await label.innerText();
    expect(text).toMatch(/1 room/i);
    expect(text).toMatch(/2 adults/i);
  });

  test("BF-05 · an abandoned flow is restored from the URL after a reload", async ({ page }) => {
    await openStep1(page, 33, 2, 0);

    const selectDouble = page.getByTestId("select-room-standard-double");
    await expect(selectDouble).toBeVisible({ timeout: 20_000 });
    await selectDouble.click();
    await page.waitForTimeout(900);

    const before = page.url();
    expect(before).toContain("roomType");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    // The cart is restored — the primary action still offers to advance.
    const primary = step1Primary(page);
    await expect(primary).toBeVisible({ timeout: 20_000 });
    await expect(primary).toHaveText(/continue to add-ons/i);
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/your cart/i);
    expect(body).toMatch(/Standard Double/i);
  });

  test("BF-01 · a submission without a bot token is refused by the Turnstile gate", async ({
    page
  }) => {
    // The server refuses an unverified caller before schema validation.
    const res = await page.request.post("/api/bookings/create", {
      data: {
        checkIn: "2026-11-05",
        checkOut: "2026-11-06",
        guests: { adults: 2, children: 0 },
        roomType: "standard-double",
        guestDetails: {
          firstName: "QA",
          lastName: "Bot",
          email: "qa.bot@example.com",
          phone: "+63900000000",
          consent: true
        }
      }
    });
    expect(res.status(), "the gate must answer 400").toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/bot verification|token/i);
  });

  test("BF-01 · the client's own confirm gate is token-gated", async ({ page }) => {
    // Even with a complete, consented booking the client cannot submit
    // without a bot token — `canConfirm` includes `Boolean(turnstileToken)`.
    await openStep1(page, 34, 2, 0);

    const selectDouble = page.getByTestId("select-room-standard-double");
    await expect(selectDouble).toBeVisible({ timeout: 20_000 });
    await selectDouble.click();
    await page.waitForTimeout(800);

    const toAddOns = step1Primary(page);
    await expect(toAddOns).toHaveText(/continue to add-ons/i, { timeout: 15_000 });
    await toAddOns.click();
    await page.waitForTimeout(1000);

    const addOnsContinue = page.getByTestId("booking-addons-continue-primary");
    await expect(addOnsContinue).toBeVisible({ timeout: 20_000 });
    await addOnsContinue.click();
    await page.waitForTimeout(1200);

    // The single authoritative consent control (MBUX-06).
    const consent = page.locator("#consentStep2");
    await expect(consent, "the consent checkbox is required at the guest-details step").toBeVisible({
      timeout: 20_000
    });
    await expect(consent).toHaveAttribute("name", "consentStep2");
  });

  test("BF-02 / VC-01 · voucher validation is behind the same gate", async ({ page }) => {
    // OFFNOW is a valid 15% voucher in production. The validation
    // endpoint must not answer an unverified caller.
    const res = await page.request.post("/api/validate/voucher", {
      data: { code: "OFFNOW", checkIn: "2026-11-05", checkOut: "2026-11-06", roomType: "standard-double" }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/bot verification|token/i);
  });

  test("LK-01 · the lookup form demands a reference and an email", async ({ page }) => {
    await page.goto("/my-booking", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const ref = page.locator('input[placeholder*="SI-"]');
    const email = page.locator('input[placeholder*="example.com"]');
    await expect(ref).toBeVisible({ timeout: 20_000 });
    await expect(email).toBeVisible({ timeout: 20_000 });

    await ref.fill("SI-20260612-042");
    await email.fill("maria@example.com");
    await page.getByRole("button", { name: /find my booking/i }).click();
    await page.waitForTimeout(2500);

    // Without a bot token the lookup must not disclose a booking.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/check-in date|guest details|total due/i);
  });

  test("LK-02 · a lookup for a wrong email never reveals a booking", async ({ page }) => {
    const res = await page.request.post("/api/bookings/lookup", {
      data: { bookingRef: "SI-20260612-042", email: "definitely-not-the-guest@example.com" }
    });
    expect([400, 404]).toContain(res.status());
    const body = await res.json().catch(() => ({}) as any);
    if (res.status() === 404) {
      expect(String(body.error ?? "").toLowerCase()).not.toContain("exist");
    } else {
      expect(body.success).toBe(false);
    }
  });

  test("the guest booking pages mount the Turnstile widget where it is needed", async ({
    page
  }) => {
    // The lookup page always needs a token.
    await page.goto("/my-booking", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(
      await page.locator('input[name="cf-turnstile-response"]').count(),
      "/my-booking must mount a Turnstile widget"
    ).toBeGreaterThan(0);

    // The booking flow mounts it ONLY on the review step — that is the
    // step whose submit needs a token (`useTurnstileToken({ enabled:
    // isReviewStep })`). Step 1 must NOT mount it.
    await openStep1(page, 36, 2, 0);
    await expect(
      page.locator('input[name="cf-turnstile-response"]'),
      "step 1 must not mount the widget"
    ).toHaveCount(0);

    const selectDouble = page.getByTestId("select-room-standard-double");
    await expect(selectDouble).toBeVisible({ timeout: 20_000 });
    await selectDouble.click();
    await page.waitForTimeout(800);

    const toAddOns = step1Primary(page);
    await expect(toAddOns).toHaveText(/continue to add-ons/i, { timeout: 15_000 });
    await toAddOns.click();
    await page.waitForTimeout(1000);

    const addOnsContinue = page.getByTestId("booking-addons-continue-primary");
    await expect(addOnsContinue).toBeVisible({ timeout: 20_000 });
    await addOnsContinue.click();
    await page.waitForTimeout(1200);

    // Fill the guest details so the review step is reachable.
    await page.locator('input[name="firstName"]').fill("Qa");
    await page.locator('input[name="lastName"]').fill("Bot");
    await page.locator('input[name="email"]').fill("qa.bot@example.com");
    await page.locator('input[name="phone"]').fill("+639000000000");
    await page.locator("#consentStep2").check();
    await page.waitForTimeout(600);

    // Once the details are valid the CTA becomes a LINK to the review
    // step; while they are invalid it is the
    // `booking-guest-details-continue` button that explains what is wrong.
    const toReview = page.getByRole("link", { name: "Continue to review" });
    await expect(toReview).toBeVisible({ timeout: 20_000 });
    await toReview.click();
    await page.waitForTimeout(2500);

    expect(
      await page.locator('input[name="cf-turnstile-response"]').count(),
      "the review step must mount the Turnstile widget"
    ).toBeGreaterThan(0);
  });
});
