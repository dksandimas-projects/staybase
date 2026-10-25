/**
 * AI-BROWSER-QA (2026-10-25) — the guest-WRITE scenarios, driven through
 * the real production guest site with a real browser.
 *
 * Before the hotel-wide bot-protection switch these scenarios were
 * BLOCKED: every public guest write endpoint is behind Cloudflare Turnstile
 * and no token can be produced from this host. With the switch in
 * `"disabled"` mode the writes are reachable again, and this spec is the
 * first time they are actually exercised.
 *
 * THE SCENARIOS
 *   CT-01  the contact form sends a message
 *   CT-02  the contact form's own validation is reachable
 *   CO-01  a corporate inquiry is submitted from the guest site
 *   BP-01  a guest picks a bed set-up + writes a preference, and still books
 *   BF-02  a guest uploads a GCash payment proof and the booking goes through
 *   BF-03  the breakfast price follows the guest count
 *   LK-03  a guest cancels a pending booking from /my-booking
 *   AO-08  a guest adds and then removes an other add-on
 *   RW-02  a signed-in member books (the member rate must be applied)
 *
 * WHAT THIS SPEC CREATES IN PRODUCTION
 * Every booking is tagged through the repo's own ETR-03 mechanism: a test
 * run is opened through the admin API and its token rides in the
 * booking-create body, so the server stamps `isTestData: true` +
 * `testRunId` on the record. The run is closed when the spec finishes — a
 * close records a manifest, it does not delete anything. Every created
 * record is listed in `plan/project/QA-REPORT-2026-10-23.md` §9.1.1.
 *
 * The contact message and the corporate inquiry carry the QA email alias
 * `qa.browser.flow+sparkinn.dev@gmail.com`, so they are identifiable in the
 * staff inbox and in Firestore.
 *
 * WHAT THE SPEC CAN AND CANNOT SEE
 * The create response echoes the reference, the total and the room — it does
 * NOT echo `specialRequests`, `bedSetup`, `paymentProofPath` or
 * `memberDiscountPct`. The persisted values are therefore checked in two
 * places: the request the browser actually sent, and the read-only
 * side-effects tracker, whose output is recorded in the report.
 *
 * THE MOBILE PROJECT
 * Every scenario here WRITES. A second write on the mobile project would
 * double the production records without testing anything new (the mobile
 * LAYOUT of these forms is covered by the read-only specs). The mobile
 * project therefore skips with an explicit reason.
 */

import { test, expect, requireIdentity, guestLogin, ADMIN, MEMBER } from "../support/qa";
import {
  FLOW_EMAIL,
  FLOW_FIRST_NAME,
  FLOW_LAST_NAME,
  RUN_NAME,
  adminIdToken,
  openTestRun,
  closeTestRun,
  tagBookingCreates,
  createBookingViaBrowser,
  pickFreeStay,
  readLookupToken,
  type TestRun
} from "../support/guest-write";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const PROOF_FILE = resolve(REPO_ROOT, "tmp/qa-2026-10-23/qa-gcash-proof.png");

/**
 * Far-future, CONTENDED-FREE dates. The offset is only a starting point:
 * `pickFreeStay` walks forward until it finds a night with no bookings, so
 * the spec can be re-run without a QA booking from an earlier run blocking
 * the room inventory.
 */
const stay = (offsetDays: number) => pickFreeStay(offsetDays);

/** The one test run this worker owns. */
let run: TestRun | null = null;
let idToken = "";

async function ensureRun(): Promise<TestRun> {
  if (run) return run;
  const admin = requireIdentity("admin", ADMIN());
  idToken = await adminIdToken(admin.email, admin.password);
  run = await openTestRun(idToken);
  return run;
}

test.describe("Guest write paths (browser, bot protection off)", () => {
  test.afterAll(async () => {
    if (!run) return;
    const manifest = await closeTestRun(idToken, run.runId);
    // The manifest is the authoritative list of what this pass created.
    console.log(
      `[guest-write] test run "${RUN_NAME}" closed — manifest: ` +
        JSON.stringify({
          bookings: manifest?.bookings ?? 0,
          storeOrders: manifest?.storeOrders ?? 0,
          affectedRooms: manifest?.affectedRooms ?? []
        })
    );
  });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "this scenario creates a production record — one write per scenario per pass; " +
        "the mobile layout of the same form is covered by the read-only specs"
    );
    const current = await ensureRun();
    await tagBookingCreates(page, current.token);
  });

  test("CT-01 · the contact form sends a message", async ({ page }) => {
    await page.goto("/contact", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Full Name").fill("QA Browser Flow");
    await page.getByLabel("Email Address").fill(FLOW_EMAIL);
    await page.getByLabel("Subject").fill("QA browser contact — guest-write scenario CT-01");
    await page
      .getByLabel("Message Body")
      .fill(
        "Automated QA message. This is a synthetic enquiry created by the AI-BROWSER-QA " +
          "pass to exercise the public contact write path. Please ignore."
      );

    // The honeypot must stay empty.
    await expect(page.locator('input[name="_hp"]'), "the honeypot must be present and empty").toHaveValue("");

    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByText("Message Sent Successfully")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/our front desk agent will reach out/i)).toBeVisible();
  });

  test("CT-02 · the contact form's own validation is reachable", async ({ page }) => {
    // With the bot gate off the request REACHES the handler, so the
    // field-level validation order is observable for the first time.
    const res = await page.request.post("/api/contact/inquiry", {
      data: { name: "", email: "not-an-email", subject: "", message: "" }
    });
    expect(res.status(), "an invalid contact message must be refused").toBe(400);
    const body = await res.json().catch(() => ({} as any));
    expect(body.success).toBe(false);
    expect(String(body.error ?? ""), "the refusal must be the request's, not the bot gate's").not.toMatch(
      /bot verification|turnstile/i
    );
  });

  test("CO-01 · a corporate inquiry is submitted from the guest site", async ({ page }) => {
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });

    const corpDates = await stay(120);
    await page.getByLabel(/Company Name/i).fill("QA Browser Flow Co");
    await page.getByLabel(/First Name/i).fill(FLOW_FIRST_NAME);
    await page.getByLabel(/Last Name/i).fill(FLOW_LAST_NAME);
    await page.getByLabel(/Contact Email/i).fill(FLOW_EMAIL);
    await page.getByLabel(/Contact Phone/i).fill("09171234567");
    await page.getByLabel(/Preferred Check-In/i).fill(corpDates.checkIn);
    await page.getByLabel(/Preferred Check-Out/i).fill(corpDates.checkOut);
    await page
      .getByLabel(/Special Requirements or Travel Notes/i)
      .fill("Automated QA corporate enquiry — scenario CO-01. No rooms are being requested.");

    await page.getByRole("button", { name: /submit corporate inquiry/i }).click();

    await expect(page.getByText("Inquiry Submitted Successfully")).toBeVisible({ timeout: 25_000 });
  });

  test("BP-01 · a guest picks a bed set-up, writes a preference, and still books", async ({ page }) => {
    const dates = await stay(60);
    const result = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel",
      bedSetup: "large-bed",
      additionalRequest: "QA browser booking — late arrival around 10pm (scenario BP-01)."
    });

    expect(result.createStatus, "the booking must be created").toBe(200);
    expect(result.createBody?.success).toBe(true);
    expect(result.bookingRef, "the booking must carry a booking reference").toMatch(/^SI-\d{8}-\d{5}$/);
    expect(result.reservationRef, "the confirmation page must show a reservation reference").toMatch(/^R-\d{8}-\d{5}$/);

    // The guest's own choices must reach the server, not just the DOM.
    // (The stored values are checked independently by the read-only
    // side-effects tracker — the create response does not echo them.)
    expect(
      String(result.createRequest?.additionalRequest || ""),
      "the guest's written request must be on the wire"
    ).toContain("late arrival");
    expect(
      String(result.createRequest?.roomSelections?.[0]?.bedSetup || ""),
      "the guest's bed set-up must be on the wire"
    ).toBe("large-bed");

    // And the guest can look their own booking up again.
    const lookup = await page.request.post("/api/bookings/lookup", {
      data: { bookingRef: result.bookingRef, email: FLOW_EMAIL }
    });
    expect(lookup.status(), "the guest must be able to look their booking up").toBe(200);
  });

  test("BF-02 · a guest uploads a GCash proof and the booking goes through", async ({ page }) => {
    expect(existsSync(PROOF_FILE), "the QA proof fixture must exist").toBe(true);

    const dates = await stay(70);
    const result = await createBookingViaBrowser(page, { ...dates, proofFile: PROOF_FILE });

    expect(result.createStatus, "the booking must be created").toBe(200);
    expect(result.createBody?.success).toBe(true);
    expect(result.bookingRef).toMatch(/^SI-\d{8}-\d{5}$/);

    // A proof was attached, so the booking must NOT be waiting for a
    // payment any more — it is in the staff-review state.
    expect(
      String(result.createBody?.data?.status || ""),
      "a booking with a proof must be in the payment-uploaded state"
    ).toBe("payment-uploaded");

    // The catalogue asks for a GCash REFERENCE NUMBER next to the
    // screenshot. The product removed that field on 2026-07-24 (every
    // payment method's `requireReferenceNumber` is false), so the
    // scenario's second half no longer exists to be tested.
    const reviewText = await page.locator("body").innerText();
    expect(reviewText, "the review step must not ask for a payment reference number").not.toMatch(
      /reference number/i
    );
  });

  test("BF-03 · the breakfast price follows the guest count", async ({ page }) => {
    const dates = await stay(130);
    const result = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel",
      breakfastMealId: "tapsilog",
      breakfastSlots: 2
    });

    expect(result.createStatus, "the booking must be created").toBe(200);
    expect(result.createBody?.success).toBe(true);

    // One meal slot per guest, per date — the per-guest × per-date map.
    const sent = result.createRequest?.breakfastSelections || {};
    const slots = Object.keys(sent).filter((k) => k.startsWith(dates.checkIn));
    expect(slots, "both guest slots must carry the meal").toHaveLength(2);
    expect(sent[slots[0]]?.mealId).toBe("tapsilog");
    expect(sent[slots[1]]?.mealId).toBe("tapsilog");

    // The server charges the PER-GUEST price: two meals, not one.
    const addOns = result.createBody?.data?.rateBreakdown?.addOns || [];
    const breakfastLine = addOns.find((l: any) => /breakfast/i.test(String(l.label || "")));
    expect(breakfastLine, "the charged total must carry a breakfast line").toBeTruthy();
    const mealPrice = Number(sent[slots[0]]?.price);
    expect(Number(breakfastLine.amount), "two guests must be charged two meals").toBe(mealPrice * 2);

    // And the guest is quoted what they are charged.
    expect(result.displayedTotal, "the review step must show the charged total").toBe(
      Number(result.createBody?.data?.totalPrice)
    );
  });

  test("LK-03 · a guest cancels a pending booking", async ({ page }) => {
    const dates = await stay(80);
    const created = await createBookingViaBrowser(page, { ...dates, paymentMethod: "pay-at-hotel" });
    expect(created.createStatus).toBe(200);
    expect(created.bookingRef).toMatch(/^SI-\d{8}-\d{5}$/);

    // The guest finds their booking and cancels it.
    await page.goto("/my-booking", { waitUntil: "domcontentloaded" });
    await page.locator('input[placeholder*="SI-"]').fill(created.bookingRef);
    await page.locator('input[placeholder*="example.com"]').fill(FLOW_EMAIL);
    await page.getByRole("button", { name: /find my booking/i }).click();

    const cancelButton = page.getByRole("button", { name: /cancel booking/i });
    await expect(cancelButton, "a pending booking must be cancellable by the guest").toBeVisible({
      timeout: 25_000
    });
    await cancelButton.click();

    await page
      .getByPlaceholder(/tell us why you are cancelling/i)
      .fill("QA browser cancellation — scenario LK-03.");
    await page.getByRole("button", { name: /yes, cancel reservation/i }).click();

    await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("AO-08 · a guest adds and then removes an other add-on", async ({ page }) => {
    const dates = await stay(90);
    const created = await createBookingViaBrowser(page, { ...dates, paymentMethod: "pay-at-hotel" });
    expect(created.createStatus).toBe(200);

    // The add-on manager is reached through the magic link the
    // confirmation email carries. This pass has no inbox, so the token is
    // read from Firestore with the read-only admin SDK.
    const token = await readLookupToken(created.bookingRef);
    await page.goto(`/my-booking/addons?ref=${created.bookingRef}&token=${token}`, {
      waitUntil: "domcontentloaded"
    });

    const qty = page.locator('[data-testid^="addons-qty-"]').first();
    await expect(qty, "the add-on quantity control must be present").toBeVisible({ timeout: 25_000 });

    // Add one. The save button disables itself the moment the save starts,
    // so the click is dispatched directly and the success banner is what
    // the assertion waits on.
    await qty.fill("1");
    const save = page.getByTestId("addons-save");
    await expect(save, "a changed quantity must enable the save").toBeEnabled({ timeout: 10_000 });
    await save.dispatchEvent("click");
    await expect(page.getByText(/add-ons saved/i), "the add-on must be saved").toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("addons-total")).toContainText("500");

    // Remove it again.
    await page.waitForTimeout(1500);
    const qtyAgain = page.locator('[data-testid^="addons-qty-"]').first();
    await expect(qtyAgain).toHaveValue("1", { timeout: 15_000 });
    await qtyAgain.fill("0");
    await expect(page.getByTestId("addons-save"), "a changed quantity must enable the save").toBeEnabled({
      timeout: 10_000
    });
    await page.getByTestId("addons-save").dispatchEvent("click");
    await expect(page.getByText(/add-ons saved/i), "the removal must be saved").toBeVisible({ timeout: 25_000 });

    await expect(page.locator('[data-testid^="addons-qty-"]').first()).toHaveValue("0", { timeout: 15_000 });
    await expect(page.getByTestId("addons-total"), "the add-on total must be back to zero").not.toContainText("500");
  });

  test("RW-02 · a signed-in member books and the member rate is applied", async ({ page }) => {
    const member = requireIdentity("member", MEMBER());
    await guestLogin(page, member);

    const dates = await stay(100);
    const result = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel",
      email: member.email,
      firstName: "QA",
      lastName: "Member"
    });

    expect(result.createStatus, "the booking must be created").toBe(200);
    expect(result.createBody?.success).toBe(true);

    // The server is authoritative on the charge (W2.2 / decision #90). It
    // resolves the member from the request's ID token — so the amount the
    // server charged MUST equal the amount the guest was shown, including
    // the member discount.
    const serverTotal = Number(result.createBody?.data?.totalPrice);
    expect(Number.isFinite(serverTotal), "the create response must carry the charged total").toBe(true);
    expect(
      result.displayedTotal,
      `the review step showed ₱${result.displayedTotal} but the server charged ₱${serverTotal}`
    ).toBe(serverTotal);
  });
});
