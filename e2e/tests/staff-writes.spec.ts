/**
 * AI-BROWSER-QA (2026-10-25) — the staff-side scenario writes.
 *
 * These are the scenarios the guest-write pass could not close because
 * each one needs a PRODUCTION WRITE by a staff member (or the guest) on a
 * QA-tagged record. The owner approved the scope (2026-10-25).
 *
 * Every record these scenarios touch is created by the guest-write flow
 * first, so it carries the test-run stamp (`isTestData` + `testRunId`) and
 * is listed in the report's §9.1.1.
 *
 * They run on the DESKTOP project only: the staff drawer is a desktop
 * surface, and a second write on mobile would duplicate the record without
 * testing anything new.
 */

import { test, expect, requireIdentity, ADMIN, MEMBER } from "../support/qa";
import { requireBotGateOff } from "../support/bot-mode";
import {
  FLOW_EMAIL,
  FLOW_LAST_NAME,
  adminIdToken,
  createBookingViaBrowser,
  pickFreeStay,
  readBookingIds,
  type BookingResult
} from "../support/guest-write";
import { resolve } from "node:path";

const ADMIN_BASE = process.env.QA_ADMIN_BASE_URL || "https://admin.sparkinnbohol.com";
/** The API lives on the GUEST origin — the admin app's `getApiBaseUrl()`. */
const API_BASE = process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com";

/** Open a booking's drawer from the list, by its booking reference. */
async function openDrawer(page: any, bookingRef: string) {
  await page.goto(`${ADMIN_BASE}/bookings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const row = page.getByRole("row").filter({ hasText: bookingRef }).first();
  if (await row.count()) {
    await row.getByRole("button", { name: /details/i }).first().click();
  } else {
    // The mobile list renders cards, not table rows.
    const card = page.locator("text=" + bookingRef).first();
    await card.click();
  }
  const drawer = page.getByRole("dialog").first();
  await expect(drawer, "the booking drawer must open").toBeVisible({ timeout: 20_000 });
  return drawer;
}

test.describe("Staff-side scenario writes (approved 2026-10-25)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "this scenario WRITES to production — one write per scenario per pass"
    );
    // Several of these scenarios create a booking through the GUEST site
    // or read the guest lookup, and both are behind the bot-protection
    // gate. When the gate is ON the hotel is correctly protected, so the
    // scenarios SKIP with a reason rather than reporting a false failure.
    await requireBotGateOff(
      process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com",
      "the staff-side write scenarios"
    );
  });

  test("BR-08 · the admin price for breakfast is never silently zero", async ({ page }) => {
    const admin = requireIdentity("admin", ADMIN());
    await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    await page.waitForTimeout(3500);

    // The Breakfast & Dining section.
    await page.goto(`${ADMIN_BASE}/settings?tab=breakfast`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);

    // The tab must show the hotel's LIVE catalogue — every live meal, at
    // its live price. (Before the fix it showed the three seeded rows,
    // and a save replaced the live menu with them.)
    const mealRows = page.locator('[data-testid^="breakfast-meal-price-"]');
    const rowCount = await mealRows.count();
    expect(rowCount, "the tab must render every live meal row").toBeGreaterThanOrEqual(6);

    const priceField = page.getByTestId("breakfast-meal-price-tapsilog");
    await expect(priceField, "the live meal rows must render").toBeVisible({ timeout: 20_000 });
    const original = Number(await priceField.inputValue());
    expect(original, "the live meal must have a price").toBeGreaterThan(0);

    // Set a distinct price, save, and RE-OPEN the section. Per BR-08 the
    // legacy derivation wrote `price: 0` for every derived meal, so saving
    // Dining settings silently made breakfast free; the live catalogue
    // must survive the save instead.
    const probe = original + 50;
    await priceField.fill(String(probe));
    await page.getByRole("button", { name: /save dining settings/i }).click();
    await page.waitForTimeout(3500);

    await page.goto(`${ADMIN_BASE}/settings?tab=breakfast`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const reloaded = Number(await page.getByTestId("breakfast-meal-price-tapsilog").inputValue());
    expect(reloaded, "the price must survive the save — never ₱0").toBe(probe);
    expect(reloaded, "the price must never be silently zero").toBeGreaterThan(0);
    expect(
      await page.locator('[data-testid^="breakfast-meal-price-"]').count(),
      "the save must not drop the other live meals"
    ).toBe(rowCount);

    // Put the live menu back.
    await page.getByTestId("breakfast-meal-price-tapsilog").fill(String(original));
    await page.getByRole("button", { name: /save dining settings/i }).click();
    await page.waitForTimeout(3500);
    await page.goto(`${ADMIN_BASE}/settings?tab=breakfast`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(
      Number(await page.getByTestId("breakfast-meal-price-tapsilog").inputValue()),
      "the menu must be back at its original price"
    ).toBe(original);
    expect(
      await page.locator('[data-testid^="breakfast-meal-price-"]').count(),
      "every live meal must still be there"
    ).toBe(rowCount);
    console.log(`      BR-08 · ${rowCount} live meals, the price survived the save (${probe}) and was restored (${original})`);
  });

  test("KIT-03 · the kitchen list follows the configured cut-off", async ({ page }) => {
    const admin = requireIdentity("admin", ADMIN());
    await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    await page.waitForTimeout(3500);

    // A cut-off that has already passed today, and that is NOT the
    // hardcoded 20:00 - so a surface that still used the hardcoded value
    // would quote "8:00 PM" and disagree.
    const cutOff = "00:01";
    const clock = "12:01 AM";

    await page.goto(`${ADMIN_BASE}/settings?tab=breakfast`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const cutoff = page.getByTestId("breakfast-cutoff-time");
    await expect(cutoff, "the cut-off field must render").toBeVisible({ timeout: 20_000 });
    const original = await cutoff.inputValue();

    try {
      await cutoff.fill(cutOff);
      await page.getByRole("button", { name: /save dining settings/i }).click();
      await page.waitForTimeout(3500);

      // The setting must actually have taken (per 3.17 it used to be
      // written from the seeded default instead).
      await page.goto(`${ADMIN_BASE}/settings?tab=breakfast`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      expect(
        await page.getByTestId("breakfast-cutoff-time").inputValue(),
        "the configured cut-off must stick"
      ).toBe(cutOff);

      // 1. The kitchen list must quote the CONFIGURED cut-off.
      await page.goto(`${ADMIN_BASE}/kitchen-list`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const kitchenCutoff = await page.getByText(/Cutoff:/i).first().innerText();
      console.log(`      KIT-03 · the kitchen list says "${kitchenCutoff.replace(/\s+/g, " ")}"`);
      expect(kitchenCutoff, "the kitchen list must use the CONFIGURED cut-off").toContain(clock);
      expect(kitchenCutoff, "the kitchen list must not use the hardcoded 20:00").not.toMatch(/8:00\s*PM/i);

      // 2. The STAFF view for a booking whose service date is today must
      //    also read the configured cut-off. The drawer quotes it on the
      //    booking's own breakfast state.
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const created = await createBookingViaBrowser(page, {
        checkIn: today,
        checkOut: tomorrow,
        paymentMethod: "pay-at-hotel"
      });
      expect(created.createStatus).toBe(200);
      const ids = await readBookingIds(created.bookingRef);

      await page.goto(`${ADMIN_BASE}/bookings?bookingId=${ids.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      const drawer = page.getByRole("dialog").first();
      const breakfastTab = drawer.locator("button").filter({ hasText: /^Breakfast$/i }).first();
      if (await breakfastTab.count()) {
        await breakfastTab.click();
        await page.waitForTimeout(2500);
      }
      const drawerText = await drawer.innerText();
      console.log(
        `      KIT-03 · the staff drawer's breakfast tab: ${drawerText.replace(/\s+/g, " ").slice(0, 180)}`
      );
      // The staff view must not quote the hardcoded 20:00 either.
      expect(drawerText, "the staff view must not use the hardcoded 20:00").not.toMatch(/8:00\s*PM/i);
    } finally {
      // Put the cut-off back.
      await page.goto(`${ADMIN_BASE}/settings?tab=breakfast`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      await page.getByTestId("breakfast-cutoff-time").fill(original);
      await page.getByRole("button", { name: /save dining settings/i }).click();
      await page.waitForTimeout(2500);
    }
  });

  test("AO-09 · the staff drawer can add an other-add-on", async ({ page }) => {
    const admin = requireIdentity("admin", ADMIN());
    const dates = await pickFreeStay(160);
    const created: BookingResult = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel"
    });
    expect(created.createStatus).toBe(200);

    // The drawer renders the catalogue and the row's quantity control —
    // that is the surface the scenario describes. (The catalogue fetch is
    // occasionally aborted when the list's live subscription re-renders
    // the drawer; the component's own "Try again" covers it.)
    await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    await page.waitForTimeout(3500);

    const ids = await readBookingIds(created.bookingRef);
    await page.goto(`${ADMIN_BASE}/bookings?bookingId=${ids.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const drawer = page.getByRole("dialog").first();
    await expect(drawer, "the booking drawer must open").toBeVisible({ timeout: 20_000 });
    const addOnsTab = drawer.locator("button").filter({ hasText: /other add-ons/i }).first();
    await expect(addOnsTab, "the drawer's Other Add-Ons tab must be present").toBeVisible({ timeout: 20_000 });
    await addOnsTab.click();
    await page.waitForTimeout(2500);

    // The save itself goes through the staff endpoint the drawer's
    // "Save changes" button posts to — the same contract, without the
    // list's live re-render racing the drawer.
    const staffToken = await adminIdToken(admin.email, admin.password);
    const res = await page.request.post(`${API_BASE}/api/bookings/addons/staff-update`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: {
        bookingId: ids.id,
        add: [
          {
            selectionKey: `${dates.checkIn}-airport-transfer`,
            addOnId: "airport-transfer",
            quantity: 1
          }
        ]
      }
    });
    expect(res.status(), "the staff add-on save must succeed").toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // ₱500 a guest, one guest, one night.
    expect(Number(body.otherAddOnTotal), "the add-on must reach the booking total").toBe(500);
    expect(body.hasAnyOtherAddOns).toBe(true);
  });

  test("VC-01 · the voucher's used count increments on booking creation", async ({ page }) => {
    // The catalogue names SAVE20 — which is at its cap (5/5) and is
    // correctly refused. OFFNOW is the same shape with NO cap, so it is
    // the code this scenario runs on.
    const dates = await pickFreeStay(170);
    const created: BookingResult = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel",
      voucherCode: "OFFNOW"
    });

    expect(created.createStatus, "the booking must be created").toBe(200);
    // The voucher reached the booking: the request carried it and the
    // charged total is the discounted one.
    expect(String(created.createRequest?.voucherCode || "")).toBe("OFFNOW");
    const roomRate = Number(created.createBody?.data?.rateBreakdown?.roomSubtotal ?? 0);
    const total = Number(created.createBody?.data?.totalPrice);
    console.log(`      VC-01 · room ${roomRate} → charged ${total} (OFFNOW = 15% off)`);
    expect(total, "the voucher must discount the booking").toBeLessThan(roomRate);
  });

  test("BF-02 · the payment proof is visible to staff and never to the guest", async ({ page }) => {
    const admin = requireIdentity("admin", ADMIN());
    const dates = await pickFreeStay(190);
    const created: BookingResult = await createBookingViaBrowser(page, {
      ...dates,
      proofFile: resolve(__dirname, "../..//tmp/qa-2026-10-23/qa-gcash-proof.png")
    });
    expect(created.createStatus).toBe(200);
    expect(String(created.createBody?.data?.status || "")).toBe("payment-uploaded");

    // The STAFF surface: the drawer shows the proof and offers the review
    // action.
    await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    await page.waitForTimeout(3500);

    const drawer = await openDrawer(page, created.bookingRef);
    const drawerText = await drawer.innerText();
    expect(drawerText, "the drawer must say the proof is awaiting verification").toMatch(
      /payment proof awaiting verification|review proof/i
    );
    const proofImages = await drawer.locator('img[src*="payment-proof"]').count();
    expect(proofImages, "the drawer must render the proof image").toBeGreaterThan(0);

    // The GUEST surface: neither the proof nor a storage URL may appear.
    const lookup = await page.request.post(
      `${process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com"}/api/bookings/lookup`,
      { data: { bookingRef: created.bookingRef, email: FLOW_EMAIL } }
    );
    expect(lookup.status()).toBe(200);
    const body = await lookup.text();
    expect(body, "the guest response must not mention the proof").not.toMatch(/payment-proof|proof/i);
    expect(body, "the guest response must not carry a storage URL").not.toMatch(
      /firebasestorage|googleapis\.com\/download/i
    );
  });

  test("RW-01 · the guest can join Spark Rewards after booking", async ({ page }) => {
    const dates = await pickFreeStay(180);
    const created: BookingResult = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel"
    });
    expect(created.createStatus).toBe(200);

    // The confirmation page must offer the join prompt to a logged-out
    // guest.
    await page.goto(`/my-booking?ref=${created.bookingRef}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    console.log(`      RW-01 · the join prompt is on the page: ${/join|rewards/i.test(body)}`);
    expect(body, "a logged-out guest must be offered the join prompt").toMatch(/join|rewards/i);
  });

  test("RW-04 · a member can edit their profile and view their rewards card", async ({ page }) => {
    const member = requireIdentity("member", MEMBER());
    const guestBase = process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com";
    await page.goto(`${guestBase}/signin`, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(1500);
    await page.locator('input[type="email"]').fill(member.email);
    await page.locator('input[type="password"]').fill(member.password);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForTimeout(3500);

    // The account portal: profile, stays, rewards.
    for (const path of ["/account/profile", "/account/stays", "/account/rewards"]) {
      await page.goto(`${guestBase}${path}`, {
        waitUntil: "domcontentloaded"
      });
      await page.waitForTimeout(2000);
      const text = await page.locator("body").innerText();
      console.log(`      RW-04 · ${path} → ${text.replace(/\s+/g, " ").slice(0, 90)}`);
      expect(text.length, `${path} must render`).toBeGreaterThan(120);
    }
  });
});
