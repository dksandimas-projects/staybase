/**
 * AI-BROWSER-QA (2026-10-26) — the last four Tier-3 scenario writes.
 *
 * These are the four scenarios the owner approved in the Tier-3 scope that
 * were still unexecuted when the 2026-10-23 pass closed:
 *
 *   FD-10   an admin refund with a method + reason, the over-refund refusal
 *           and the Front Desk role boundary
 *   BASE-04 the "Mark as paid" control on a pending refund
 *   ST-04   the in-room store refuses an order whose item was zeroed after
 *           it was already in the guest's cart
 *   RW-03   the drawer's points redemption — preview, apply, undo
 *   RW-01   the signup half — the member number is issued and the booking
 *           lands under My Stays
 *
 * THE CHAIN UNDER TEST (FD-10 + BASE-04)
 *   verify → refund → mark as paid
 * The chain is staged on ONE booking so the money never leaves the QA
 * ledger: the desk verifies the GCash proof (which is what makes the
 * booking "paid", which is what lets the guest cancel a paid breakfast
 * and create a pending refund liability), the desk records a refund, and
 * the desk then marks the breakfast liability paid.
 *
 * EVERYTHING IS TAGGED
 * Every booking is created through the repo's own ETR-03 mechanism: a
 * production test run is opened through the admin API and its token rides
 * in the booking-create body, so the server stamps `isTestData: true` +
 * `testRunId` on the record. Every created record is listed in
 * `plan/project/QA-REPORT-2026-10-23.md` §9.1.1.
 *
 * THE MOBILE PROJECT
 * Every scenario here WRITES. A second write on the mobile project would
 * double the production records without testing anything new, so the
 * mobile project skips with an explicit reason.
 */

import { test, expect, requireIdentity, guestLogin, staffLogin, ADMIN, FRONT_DESK, MEMBER } from "../support/qa";
import {
  FLOW_EMAIL,
  FLOW_LAST_NAME,
  adminIdToken,
  closeTestRun,
  createBookingViaBrowser,
  openTestRun,
  pickFreeStay,
  readBookingIds,
  tagBookingCreates,
  type BookingResult,
  type TestRun
} from "../support/guest-write";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ADMIN_BASE = process.env.QA_ADMIN_BASE_URL || "https://admin.sparkinnbohol.com";
/** The API lives on the GUEST origin — the admin app's `getApiBaseUrl()`. */
const API_BASE = process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com";
const REPO_ROOT = resolve(__dirname, "../..");
const PROOF_FILE = resolve(REPO_ROOT, "tmp/qa-2026-10-23/qa-gcash-proof.png");

/**
 * The QA alias RW-01 signs up with. It has no auth user yet, so the signup
 * creates a REAL member account — which is the point of the scenario. The
 * booking for the scenario is made with the same address, so the
 * registration link (which matches on `guestEmail`) has a stay to link.
 */
const RW01_EMAIL = "qa.rw01.signup+sparkinn.dev@gmail.com";
const RW01_PASSWORD = "SparkInn123!";

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

/**
 * Open a booking's drawer from the admin list, by its internal id.
 *
 * The deep link (`/bookings?bookingId=…`) is the reliable path, but it only
 * resolves once the booking is in the loaded list — so the row scan is
 * kept as the fallback.
 */
async function openDrawer(page: any, bookingId: string, bookingRef?: string) {
  await page.goto(`${ADMIN_BASE}/bookings?bookingId=${bookingId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const drawer = page.getByRole("dialog").first();
  if (await drawer.isVisible().catch(() => false)) return drawer;

  await page.goto(`${ADMIN_BASE}/bookings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (bookingRef) {
    const row = page.getByRole("row").filter({ hasText: bookingRef }).first();
    if (await row.count()) {
      await row.getByRole("button", { name: /details/i }).first().click();
    } else {
      const card = page.locator("text=" + bookingRef).first();
      await card.click();
    }
  }
  await expect(drawer, "the booking drawer must open").toBeVisible({ timeout: 25_000 });
  return drawer;
}

/** Sign in as the admin on the admin origin (the shared `staffLogin` helper). */
async function adminSignIn(page: any, identity: { email: string; password: string }) {
  await staffLogin(page, identity);
}

/**
 * Mark the QA email address as verified through the Firebase Admin SDK.
 *
 * There is no inbox in this pass, so the click on the emailed verification
 * link cannot be reproduced by hand. This performs exactly what that click
 * does — `emailVerified: true` on the QA auth user — and nothing else. It
 * is a WRITE, it touches one QA identity, and the report records it.
 */
async function verifyQaEmail(email: string): Promise<void> {
  const script = resolve(REPO_ROOT, "scripts/qa/verify-qa-email.ts");
  const bundle = resolve(REPO_ROOT, "tmp/qa-2026-10-23/verify-qa-email.mjs");
  await build({
    entryPoints: [script],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    external: ["firebase-admin"],
    logLevel: "silent"
  });
  execFileSync(process.execPath, [bundle, "--email", email], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env: { ...process.env, ENV_FILE: process.env.ENV_FILE || "guest-app/.env.spark-inn-prod" }
  });
}

/**
 * Switch the booking drawer to one of its sections.
 *
 * The drawer is a tabbed surface — only the ACTIVE section is in the
 * accessibility tree (the other panels are `hidden`), so every assertion
 * that reaches into the drawer has to open its section first.
 */
async function openSection(page: any, section: "overview" | "check-in" | "folio" | "breakfast" | "addons" | "more") {
  const tab = page.locator(`#booking-drawer-tab-${section}`);
  await expect(tab, `the drawer's ${section} tab must be there`).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await page.waitForTimeout(1200);
}

/**
 * The staging booking for FD-10.
 *
 * `QA_REUSE_BOOKING_REF` lets a re-run reuse an already-created QA booking
 * instead of creating another production record — the booking create is the
 * one step in this scenario that cannot be undone. The default (no env var)
 * is always a fresh booking, which is what the pass records.
 */
async function stageRefundChainBooking(page: any, dates: { checkIn: string; checkOut: string }) {
  const reuseRef = process.env.QA_REUSE_BOOKING_REF;
  if (reuseRef) {
    const ids = await readBookingIds(reuseRef);
    expect(ids.status, "the reused booking must already be paid").toBe("payment-confirmed");
    return { created: null as BookingResult | null, ids, total: ids.totalPrice, alreadyPaid: true };
  }
  const created = await createBookingViaBrowser(page, {
    ...dates,
    proofFile: PROOF_FILE,
    breakfastMealId: "tapsilog",
    breakfastSlots: 2
  });
  expect(created.createStatus, "the booking must be created").toBe(200);
  const ids = await readBookingIds(created.bookingRef);
  const total = Number(created.createBody?.data?.totalPrice);
  expect(total, "the booking must carry a total").toBeGreaterThan(0);
  return { created, ids, total, alreadyPaid: false };
}

test.describe("Tier-3 scenario writes (approved 2026-10-26)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "this scenario WRITES to production — one write per scenario per pass"
    );
    const active = await ensureRun();
    await tagBookingCreates(page, active.token);
  });

  test.afterAll(async () => {
    if (!run) return;
    const manifest = await closeTestRun(idToken, run.runId);
    console.log(
      `[tier3] test run closed — manifest: ` +
        JSON.stringify(manifest, null, 2).slice(0, 2000)
    );
  });

  test("FD-10 + BASE-04 · the refund chain — verify → refund → mark as paid, and the over-refund refusal", async ({
    page
  }) => {
    const admin = requireIdentity("admin", ADMIN());
    const frontDesk = requireIdentity("front desk", FRONT_DESK());
    const staffToken = await adminIdToken(admin.email, admin.password);

    // ---- setup: a PAID booking with a breakfast ----------------------
    // The breakfast matters: the guest can only cancel a PAID meal, and
    // that cancellation is what creates the pending refund liability
    // BASE-04 needs.
    const dates = await pickFreeStay(210);
    const { created, ids, total, alreadyPaid } = await stageRefundChainBooking(page, dates);
    const bookingRef = created?.bookingRef ?? process.env.QA_REUSE_BOOKING_REF!;

    // ---- step 1: the desk verifies the proof and records the payment --
    if (!alreadyPaid) {
      const verifyRes = await page.request.post(`${API_BASE}/api/bookings/verify-and-record-payment`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
        data: {
          bookingId: ids.id,
          // The endpoint requires a client-preallocated id (10–32 alphanumerics).
          paymentId: `qaPay${Date.now()}`,
          amount: total,
          method: "gcash",
          transactionReference: "QA-TIER3-FD10-REF",
          note: "AI-BROWSER-QA 2026-10-26 refund chain"
        }
      });
      const verifyText = await verifyRes.text();
      expect(verifyRes.status(), `verify-and-record-payment → ${verifyText}`).toBe(200);
      const verifyBody = JSON.parse(verifyText);
      expect(verifyBody.success).toBe(true);
    }

    // ---- step 2: the admin records a refund (FD-10) -------------------
    await adminSignIn(page, admin);
    const drawer = await openDrawer(page, ids.id, bookingRef);
    // The payment ledger + the refund form live in the Folio section.
    await openSection(page, "folio");

    const recordRefund = drawer.getByRole("button", { name: /record refund/i }).first();
    await expect(recordRefund, "the admin must be offered the refund form").toBeVisible({
      timeout: 20_000
    });

    await recordRefund.click();
    const refundModal = page.getByRole("dialog", { name: /record refund/i });
    await expect(refundModal, "the refund modal must open").toBeVisible({ timeout: 15_000 });

    await refundModal.getByLabel(/refund amount/i).fill("100");
    await refundModal.getByLabel(/refund method/i).selectOption("cash");
    await refundModal
      .getByLabel(/^reason$/i)
      .fill("AI-BROWSER-QA 2026-10-26 — a full refund of one breakfast slot");

    const refundResponse = page.waitForResponse(
      (r: any) => r.url().includes("/api/bookings/add-refund") && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await refundModal.getByRole("button", { name: /approve and record refund/i }).click();
    const refundRes = await refundResponse;
    const refundText = await refundRes.text();
    expect(refundRes.status(), `add-refund → ${refundText}`).toBe(200);
    expect(JSON.parse(refundText).success).toBe(true);

    // The refund must appear in the ledger, in RED (the catalogue requires
    // the refund to read as a negative entry).
    await page.waitForTimeout(2500);
    const ledger = drawer.getByText(/Refund —/).first();
    await expect(ledger, "the refund must be listed in the payment ledger").toBeVisible({
      timeout: 20_000
    });
    const refundAmountCell = drawer.locator("span.text-red-600").first();
    await expect(refundAmountCell, "the refund must be rendered in red").toBeVisible();
    expect(await refundAmountCell.innerText()).toContain("-");

    // ---- step 3: the over-refund must be refused by the SERVER -------
    await drawer.getByRole("button", { name: /record refund/i }).first().click();
    const overModal = page.getByRole("dialog", { name: /record refund/i });
    await expect(overModal).toBeVisible({ timeout: 15_000 });
    // More than the net collected amount.
    await overModal.getByLabel(/refund amount/i).fill(String(total + 5000));
    await overModal.getByLabel(/refund method/i).selectOption("cash");
    await overModal.getByLabel(/^reason$/i).fill("AI-BROWSER-QA 2026-10-26 — deliberate over-refund probe");

    const overResponse = page.waitForResponse(
      (r: any) => r.url().includes("/api/bookings/add-refund") && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await overModal.getByRole("button", { name: /approve and record refund/i }).click();
    const overRes = await overResponse;
    const overText = await overRes.text();
    expect(overRes.status(), "an over-refund must be rejected").toBe(400);
    expect(overText, "the rejection must name the net collected amount").toContain(
      "Refund exceeds the net collected amount"
    );
    // The form must keep the reason so the staff can correct it.
    await expect(
      overModal.getByText(/Refund exceeds the net collected amount/i),
      "the modal must show the server's refusal"
    ).toBeVisible({ timeout: 15_000 });
    await overModal.getByRole("button", { name: /^cancel$/i }).click();

    // ---- step 4: the Front Desk must NOT be offered the refund form ---
    const deskPage = await page.context().newPage();
    await adminSignIn(deskPage, frontDesk);
    await deskPage.goto(`${ADMIN_BASE}/bookings?bookingId=${ids.id}`, {
      waitUntil: "domcontentloaded"
    });
    await deskPage.waitForTimeout(3000);
    const deskDrawer = deskPage.getByRole("dialog").first();
    await expect(deskDrawer, "the drawer must open for the front desk").toBeVisible({
      timeout: 25_000
    });
    await openSection(deskPage, "folio");
    await expect(
      deskDrawer.getByRole("button", { name: /record refund/i }),
      "the Front Desk role must not be offered the refund form"
    ).toHaveCount(0);
    await deskPage.close();

    // ---- step 5: BASE-04 — the guest cancels the paid breakfast -------
    // The guest magic link is /my-booking/breakfast?ref=…&token=…
    await page.goto(`/my-booking/breakfast?ref=${bookingRef}&token=${ids.token}`, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(3000);

    // The first meal select that still holds a meal is the breakfast the
    // guest bought.
    const mealSelects = page.locator('select[aria-label^="Meal for"]');
    const count = await mealSelects.count();
    expect(count, "the manage-breakfast page must list the stay's meals").toBeGreaterThan(0);
    let target = -1;
    for (let i = 0; i < count; i++) {
      if ((await mealSelects.nth(i).inputValue()) !== "") {
        target = i;
        break;
      }
    }
    expect(target, "the paid breakfast must be listed").toBeGreaterThanOrEqual(0);
    await mealSelects.nth(target).selectOption("");

    const saveResponse = page.waitForResponse(
      (r: any) => r.url().includes("/api/bookings/breakfast/update") && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: /save changes/i }).click();
    const saveRes = await saveResponse;
    const saveText = await saveRes.text();
    expect(saveRes.status(), `breakfast/update → ${saveText}`).toBe(200);
    expect(JSON.parse(saveText).success).toBe(true);
    // The response reports how many refund liabilities the cancellation
    // created — a paid meal creates one.
    const saveBody = JSON.parse(saveText);
    expect(
      Number(saveBody?.data?.refundLiabilityCreated || 0),
      "cancelling a PAID breakfast must create a pending refund liability"
    ).toBeGreaterThan(0);

    // ---- step 6: BASE-04 — the desk marks the refund paid -------------
    await page.goto(`${ADMIN_BASE}/bookings?bookingId=${ids.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const drawer2 = page.getByRole("dialog").first();
    await expect(drawer2).toBeVisible({ timeout: 25_000 });

    await openSection(page, "breakfast");

    const refundsPanel = drawer2.getByTestId("booking-drawer-breakfast-refunds");
    await expect(refundsPanel, "the Refunds due panel must be there").toBeVisible({ timeout: 20_000 });
    await expect(refundsPanel.getByText(/refund due/i).first(), "a pending refund must be listed").toBeVisible();

    const advanced = drawer2.locator('[data-testid^="refund-mark-paid-advanced-"]').first();
    await expect(advanced, "the Mark-as-paid (advanced) control must be there").toBeVisible({
      timeout: 20_000
    });
    const refundId = (await advanced.getAttribute("data-testid"))!.replace("refund-mark-paid-advanced-", "");

    await advanced.click();
    const markForm = page.getByTestId("mark-refund-paid-advanced-form");
    await expect(markForm, "the advanced mark-paid form must open").toBeVisible({ timeout: 15_000 });
    await markForm.getByTestId("mark-refund-paid-method").selectOption("cash");
    await markForm.getByPlaceholder("e.g. bank slip number").fill("QA-TIER3-BASE04");
    await markForm.getByPlaceholder("e.g. refunded via bank transfer").fill("AI-BROWSER-QA 2026-10-26");

    const markResponse = page.waitForResponse(
      (r: any) => r.url().includes("/api/refunds/mark-paid") && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await markForm.getByRole("button", { name: /^mark as paid$/i }).click();
    const markRes = await markResponse;
    const markText = await markRes.text();
    expect(markRes.status(), `refunds/mark-paid → ${markText}`).toBe(200);
    const markBody = JSON.parse(markText);
    expect(markBody.success).toBe(true);

    // The catalogue is explicit: the request must go to the GUEST origin
    // with a staff Bearer token.
    expect(markRes.url()).toContain("/api/refunds/mark-paid");
    const authHeader = markRes.request().headers()["authorization"] || "";
    expect(authHeader, "mark-paid must carry a staff Bearer token").toMatch(/^Bearer\s+\S+/);

    // The row must flip to paid.
    await page.waitForTimeout(3000);
    const row = drawer2.getByTestId(`refund-row-${refundId}`);
    await expect(row, "the refund row must still be listed").toBeVisible({ timeout: 20_000 });
    await expect(
      row.getByRole("button", { name: /mark as paid/i }),
      "a paid refund must not still offer Mark as paid"
    ).toHaveCount(0);
  });

  test("ST-04 · the in-room store refuses an order whose item was zeroed after it was in the cart", async ({
    page
  }) => {
    const admin = requireIdentity("admin", ADMIN());
    const staffToken = await adminIdToken(admin.email, admin.password);

    // ---- setup: a checked-in stay (the in-room store is room-scoped) ---
    const dates = await pickFreeStay(240);
    const created: BookingResult = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel"
    });
    expect(created.createStatus, "the booking must be created").toBe(200);
    const ids = await readBookingIds(created.bookingRef);
    expect(ids.roomNumber, "the booking must carry an allocated room").not.toBe("");

    await adminSignIn(page, admin);
    const drawer = await openDrawer(page, ids.id, created.bookingRef);

    // The check-in gate needs the guest registration + an ID photo.
    await openSection(page, "check-in");
    const editRegistration = drawer.getByRole("button", { name: /edit registration/i }).first();
    await expect(editRegistration, "the registration form must be offered").toBeVisible({
      timeout: 20_000
    });
    await editRegistration.click();

    const reg = drawer.locator('input[name="nationality"]').first();
    await expect(reg, "the registration form must render").toBeVisible({ timeout: 15_000 });
    await drawer.locator('input[name="dateOfBirth"]').first().fill("1990-01-15");
    await drawer.locator('select[name="gender"]').first().selectOption("female");
    await drawer.locator('select[name="purposeOfStay"]').first().selectOption("leisure");
    await drawer.locator('select[name="idType"]').first().selectOption("passport");
    await drawer.locator('input[name="idNumber"]').first().fill("QA-TIER3-ST04");
    await drawer.locator('textarea[name="address"]').first().fill("QA address, Bohol");
    await drawer.locator('input[name="emergencyContact"]').first().fill("QA contact 09170000000");
    const signature = drawer.locator('input[name="signatureStatus"]').first();
    await signature.check({ force: true });
    await drawer.getByRole("button", { name: /save registration/i }).click();
    await page.waitForTimeout(2500);

    // The guest ID attachment.
    const idPhotoInput = drawer.locator('input[type="file"][accept*="image"]').first();
    await expect(idPhotoInput, "the guest ID upload must be offered").toBeAttached({ timeout: 15_000 });
    await idPhotoInput.setInputFiles(PROOF_FILE);
    await page.waitForTimeout(3500);

    // Confirm + check in.
    const confirmRes = await page.request.post(`${API_BASE}/api/bookings/confirm`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: { bookingId: ids.id }
    });
    expect(confirmRes.status(), `bookings/confirm → ${await confirmRes.text()}`).toBe(200);

    const checkinRes = await page.request.post(`${API_BASE}/api/bookings/checkin`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: { bookingId: ids.id }
    });
    const checkinText = await checkinRes.text();
    expect(checkinRes.status(), `bookings/checkin → ${checkinText}`).toBe(200);

    // ---- the guest opens the in-room shop -----------------------------
    await page.goto(`${API_BASE}/intercom/${ids.roomNumber}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);

    const lastName = page.getByPlaceholder("e.g. Santos");
    await expect(lastName, "the intercom must ask for the booking last name").toBeVisible({
      timeout: 25_000
    });
    await lastName.fill(FLOW_LAST_NAME.split(" ").pop() || FLOW_LAST_NAME);
    await page.getByRole("button", { name: /start chatting/i }).click();
    await page.waitForTimeout(3500);

    const shopTab = page.getByRole("button", { name: /shop/i }).first();
    await expect(shopTab, "the Shop tab must be there").toBeVisible({ timeout: 25_000 });
    await shopTab.click();
    await page.waitForTimeout(2500);

    // ---- clause 1: an out-of-stock item cannot be added ---------------
    const outOfStockCard = page.locator("div").filter({ hasText: "A7 Out Of Stock Test Item" }).last();
    await expect(outOfStockCard.getByText("Out of Stock"), "the item must be marked out of stock").toBeVisible({
      timeout: 20_000
    });
    const soldOut = outOfStockCard.getByRole("button", { name: /sold out/i }).first();
    await expect(soldOut, "an out-of-stock item must not be orderable").toBeDisabled();

    // ---- clause 2: put an in-stock item in the cart --------------------
    const probeCard = page.locator("div").filter({ hasText: "A7 Stock Probe Item" }).last();
    await expect(probeCard.getByRole("button", { name: /^add$/i }).first()).toBeVisible({
      timeout: 20_000
    });
    await probeCard.getByRole("button", { name: /^add$/i }).first().click();
    await page.waitForTimeout(1200);

    const checkout = page.getByRole("button", { name: /checkout/i }).first();
    await expect(checkout, "the basket must offer Checkout").toBeVisible({ timeout: 15_000 });
    await checkout.click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /choose payment method/i }).click();
    await page.waitForTimeout(1200);

    // "Pay at Hotel" needs no receipt screenshot (only gcash/bank do).
    const payAtHotel = page.locator('input[type="radio"][value="pay-at-hotel"]');
    await expect(payAtHotel, "pay-at-hotel must be offered").toBeAttached({ timeout: 15_000 });
    await payAtHotel.check({ force: true });

    // ---- the admin zeroes the stock while the item is in the cart ------
    const adminPage = await page.context().newPage();
    await adminSignIn(adminPage, admin);
    await adminPage.goto(`${ADMIN_BASE}/settings?tab=store`, { waitUntil: "domcontentloaded" });
    await adminPage.waitForTimeout(3500);

    const probeRow = adminPage.locator("div").filter({ hasText: "A7 Stock Probe Item" }).last();
    const editItem = probeRow.getByRole("button", { name: /^edit$/i }).first();
    await expect(editItem, "the store item must be editable").toBeVisible({ timeout: 25_000 });
    await editItem.click();
    const stockInput = adminPage.locator('input[name="stock"]').first();
    await expect(stockInput, "the stock field must be there").toBeVisible({ timeout: 15_000 });
    const originalStock = await stockInput.inputValue();
    expect(Number(originalStock), "the probe item must start with stock").toBeGreaterThan(0);
    await stockInput.fill("0");
    await adminPage.getByRole("button", { name: /update item/i }).click();
    await adminPage.waitForTimeout(3000);
    console.log(`      ST-04 · the probe item's stock went ${originalStock} → 0`);

    // ---- the guest places the order — the server must refuse ----------
    const orderResponse = page.waitForResponse(
      (r: any) => r.url().includes("/api/store/create-order") && r.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: /place order/i }).click();
    const orderRes = await orderResponse;
    const orderText = await orderRes.text();
    expect(orderRes.status(), "the server must refuse the order").toBe(409);
    const orderBody = JSON.parse(orderText);
    expect(orderBody.success).toBe(false);
    expect(orderBody.error, "the refusal must be a stock error").toMatch(/stock/i);

    await expect(
      page.getByText(/no longer has enough stock/i).first(),
      "the guest must be told the item is out of stock"
    ).toBeVisible({ timeout: 20_000 });

    // The cart must NOT be cleared — no order was placed.
    await expect(
      page.getByText(/your basket/i).first(),
      "the basket must survive a refused order"
    ).toBeVisible({ timeout: 15_000 });

    // ---- restore the live catalogue ------------------------------------
    await adminPage.goto(`${ADMIN_BASE}/settings?tab=store`, { waitUntil: "domcontentloaded" });
    await adminPage.waitForTimeout(3000);
    const probeRow2 = adminPage.locator("div").filter({ hasText: "A7 Stock Probe Item" }).last();
    await probeRow2.getByRole("button", { name: /^edit$/i }).first().click();
    const stockInput2 = adminPage.locator('input[name="stock"]').first();
    await expect(stockInput2).toBeVisible({ timeout: 15_000 });
    await stockInput2.fill(originalStock);
    await adminPage.getByRole("button", { name: /update item/i }).click();
    await adminPage.waitForTimeout(2500);
    console.log(`      ST-04 · the probe item's stock restored to ${originalStock}`);
    await adminPage.close();

    // ---- release the room ---------------------------------------------
    const checkoutRes = await page.request.post(`${API_BASE}/api/bookings/checkout`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: { bookingId: ids.id }
    });
    console.log(`      ST-04 · check-out → ${checkoutRes.status()} ${await checkoutRes.text()}`);
  });

  test("RW-03 · the drawer applies a points redemption and then undoes it", async ({ page }) => {
    const admin = requireIdentity("admin", ADMIN());
    const member = requireIdentity("member", MEMBER());
    const staffToken = await adminIdToken(admin.email, admin.password);

    // A signed-in member's booking is linked to the member automatically.
    await guestLogin(page, member);
    const dates = await pickFreeStay(270);
    const created: BookingResult = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel",
      email: member.email
    });
    expect(created.createStatus, "the booking must be created").toBe(200);
    const ids = await readBookingIds(created.bookingRef);
    expect(ids.memberId, "the booking must be linked to the member").not.toBe("");
    const total = Number(created.createBody?.data?.totalPrice);
    expect(total).toBeGreaterThan(0);

    // The redemption panel only renders for a CONFIRMED booking.
    const confirmRes = await page.request.post(`${API_BASE}/api/bookings/confirm`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: { bookingId: ids.id }
    });
    expect(confirmRes.status(), `bookings/confirm → ${await confirmRes.text()}`).toBe(200);

    // Top the member's balance up — the live balance (13) is below the
    // configured 100-point minimum, so a redemption cannot be attempted
    // without it.
    const adjustRes = await page.request.post(`${API_BASE}/api/members/manual-adjust`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: {
        memberId: ids.memberId,
        amount: 500,
        reason: "AI-BROWSER-QA 2026-10-26 RW-03 redemption test"
      }
    });
    const adjustText = await adjustRes.text();
    expect(adjustRes.status(), `members/manual-adjust → ${adjustText}`).toBe(200);

    await adminSignIn(page, admin);
    const drawer = await openDrawer(page, ids.id, created.bookingRef);
    // The redemption panel lives in the Folio section.
    await openSection(page, "folio");

    const panel = drawer.locator("h3").filter({ hasText: /spark rewards redemption/i }).first();
    await expect(panel, "the redemption panel must be rendered").toBeVisible({ timeout: 25_000 });

    // The live preview: enter the points and read the ₱ preview.
    const pointsInput = drawer
      .locator('label:has-text("Points to redeem") input[type="number"]')
      .first();
    await expect(pointsInput, "the points field must be there").toBeVisible({ timeout: 15_000 });
    await pointsInput.fill("100");
    await page.waitForTimeout(600);

    const preview = drawer.locator("span", { hasText: /^Preview:/ }).first();
    await expect(preview, "a live ₱ preview must be shown").toBeVisible({ timeout: 15_000 });
    const previewText = await preview.innerText();
    expect(previewText, "the preview must price the redemption").toContain("₱100");
    expect(previewText, "the preview must show the new total").toMatch(/new total/);

    // ---- apply ---------------------------------------------------------
    const redeemResponse = page.waitForResponse(
      (r: any) => r.url().includes("/api/members/redeem-points") && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await drawer.getByRole("button", { name: /apply points/i }).first().click();
    const redeemRes = await redeemResponse;
    const redeemText = await redeemRes.text();
    expect(redeemRes.status(), `members/redeem-points → ${redeemText}`).toBe(200);
    const redeemBody = JSON.parse(redeemText);
    expect(redeemBody.success).toBe(true);
    expect(redeemBody.data.pointsRedeemed).toBe(100);
    expect(redeemBody.data.pointsRedeemedValue).toBe(100);
    expect(redeemBody.data.totalPrice, "the total must drop by the redemption").toBe(total - 100);

    await page.waitForTimeout(2500);
    await expect(
      drawer.getByText(/redemption already applied/i).first(),
      "the panel must report the applied redemption"
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      drawer.getByRole("button", { name: /apply points/i }),
      "a second redemption must not be offered"
    ).toHaveCount(0);

    // The one-redemption-per-booking rule is enforced by the server too.
    const secondRes = await page.request.post(`${API_BASE}/api/members/redeem-points`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: { bookingId: ids.id, memberId: ids.memberId, pointsToRedeem: 100 }
    });
    const secondText = await secondRes.text();
    expect(secondRes.status(), "a second redemption must be refused").toBe(400);
    expect(secondText).toMatch(/already has a points redemption/i);

    // ---- undo -----------------------------------------------------------
    const undoResponse = page.waitForResponse(
      (r: any) => r.url().includes("/api/members/undo-redemption") && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await drawer.getByRole("button", { name: /undo redemption/i }).first().click();
    const undoRes = await undoResponse;
    const undoText = await undoRes.text();
    expect(undoRes.status(), `members/undo-redemption → ${undoText}`).toBe(200);
    expect(JSON.parse(undoText).success).toBe(true);

    await page.waitForTimeout(2500);
    await expect(
      drawer.getByRole("button", { name: /apply points/i }).first(),
      "the panel must offer a redemption again after the undo"
    ).toBeVisible({ timeout: 20_000 });

    // The booking's total is restored.
    const afterUndo = await readBookingIds(created.bookingRef);
    expect(afterUndo.totalPrice, "the undo must restore the booking total").toBe(total);
  });

  test("RW-01 · the signup issues a member number and the booking lands under My Stays", async ({
    page
  }) => {
    const member = requireIdentity("member", MEMBER());

    // ---- a booking made with the signup address -----------------------
    const dates = await pickFreeStay(300);
    const created: BookingResult = await createBookingViaBrowser(page, {
      ...dates,
      paymentMethod: "pay-at-hotel",
      email: RW01_EMAIL,
      firstName: "QA",
      lastName: "Signup"
    });
    expect(created.createStatus, "the booking must be created").toBe(200);

    // ---- the guest signs up --------------------------------------------
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    await page.locator('input[placeholder="Maria"]').fill("QA");
    await page.locator('input[placeholder="Santos"]').fill("Signup");
    await page.locator('input[placeholder="maria@example.com"]').fill(RW01_EMAIL);
    await page.locator('input[type="tel"]').first().fill("09171234567");
    await page.locator('input[type="password"]').nth(0).fill(RW01_PASSWORD);
    await page.locator('input[type="password"]').nth(1).fill(RW01_PASSWORD);
    await page.locator('input[type="checkbox"]').first().check({ force: true });

    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForTimeout(6000);

    // The signup lands on the profile portal, which issues the member
    // number.
    await page.waitForURL(/\/account\/profile/, { timeout: 30_000 });
    await page.waitForTimeout(3000);
    const profileText = await page.locator("body").innerText();
    expect(profileText, "the profile must show the member number").toMatch(/SR-\d{5}/);
    const memberNumber = profileText.match(/SR-\d{5}/)![0];
    console.log(`      RW-01 · the member number is ${memberNumber}`);

    // The email is unverified until the guest clicks the emailed link.
    // There is no inbox in this pass, so the harness performs exactly what
    // that click does.
    verifyQaEmail(RW01_EMAIL);

    // Re-registering now re-runs the link (the registration path is
    // idempotent — the member number is preserved).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const afterVerify = await page.locator("body").innerText();
    expect(
      afterVerify.match(/SR-\d{5}/)![0],
      "the member number must survive the re-registration"
    ).toBe(memberNumber);

    // ---- My Stays -------------------------------------------------------
    await page.goto("/account/stays", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const staysText = await page.locator("body").innerText();
    expect(
      staysText,
      "the booking made with the same address must appear under My Stays"
    ).toContain(created.bookingRef);
    console.log(`      RW-01 · ${created.bookingRef} is listed under My Stays`);

    // The member must not see the "join Spark Rewards" prompt any more.
    await page.goto("/my-booking?ref=" + created.bookingRef, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const lookupText = await page.locator("body").innerText();
    console.log(
      `      RW-01 · the join prompt is still offered: ${/join spark rewards/i.test(lookupText)}`
    );
    expect(
      lookupText,
      "a signed-in member must NOT be offered the join prompt again"
    ).not.toMatch(/join spark rewards/i);
  });
});
