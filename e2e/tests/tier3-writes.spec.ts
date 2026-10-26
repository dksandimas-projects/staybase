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
import { requireBotGateOff } from "../support/bot-mode";
import { qaEnv } from "../support/env";
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
 *
 * `QA_RW01_EMAIL` lets a re-run use a fresh alias (a signup cannot be
 * repeated on an address that already has an auth user).
 */
const RW01_EMAIL =
  process.env.QA_RW01_EMAIL || "qa.rw01.signup+sparkinn.dev@gmail.com";
/**
 * NEVER commit a password. The account password lives in the gitignored
 * `e2e/.qa.env.local` (or the process env) like every other QA credential.
 */
const RW01_PASSWORD = qaEnv("QA_RW01_PASSWORD") || "";

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
 * Generate the REAL email-verification link for a QA identity.
 *
 * The server sends it through Resend; this pass has no inbox, so the
 * harness generates the identical link (the same
 * `generateEmailVerificationLink` call the server makes) and the browser
 * clicks it — so the app's own code path is what gets tested.
 */
async function getVerificationLink(email: string): Promise<string> {
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
  const out = execFileSync(process.execPath, [bundle, "--email", email], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ENV_FILE: process.env.ENV_FILE || "guest-app/.env.spark-inn-prod" }
  });
  const link = out.trim().split("\n").filter(Boolean).pop() || "";
  if (!link.startsWith("http")) {
    throw new Error("the verification link was not generated.");
  }
  return link;
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

/**
 * The store card that carries the given item name.
 *
 * The card root is the nearest ancestor with the `rounded-card` class — the
 * name itself sits in a nested block that does NOT hold the card's action
 * button, so scoping on the name alone finds the badge but not the button.
 */
function storeCard(page: any, name: string) {
  return page
    .getByRole("heading", { name, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-card')]");
}

/**
 * The admin store-catalogue row that carries the given item name — the
 * closest ancestor that also holds the row's "Edit" control.
 */
function adminStoreRow(page: any, name: string) {
  return page
    .getByText(name, { exact: true })
    .locator("xpath=ancestor::*[.//button[normalize-space()='Edit']][1]");
}

test.describe("Tier-3 scenario writes (approved 2026-10-26)", () => {
  // These scenarios walk a whole booking + staff flow and (RW-01) wait on
  // a Firebase rate-limited link generation, so they need more than the
  // suite's default 90 s.
  test.setTimeout(300_000);

  /**
   * The booking the current scenario has checked in, so the `afterEach`
   * can release its room even when the scenario fails half way through.
   */
  let checkedInBooking: { bookingId: string; token: string } | null = null;

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "this scenario WRITES to production — one write per scenario per pass"
    );
    // These scenarios create a booking through the GUEST site, which is
    // behind the bot-protection gate. When the gate is ON the hotel is
    // correctly protected, so the scenarios SKIP with a reason rather than
    // reporting a false failure.
    await requireBotGateOff(
      process.env.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com",
      "the Tier-3 write scenarios"
    );
    const active = await ensureRun();
    await tagBookingCreates(page, active.token);
  });

  test.afterEach(async ({ page }) => {
    // A booking left checked in HOLDS its room: the room's status is a
    // single field, not a date range, so the next scenario's check-in is
    // refused with "Assigned room is already occupied by another checked-in
    // booking". The release therefore has to run even when the scenario
    // failed half way through.
    if (!checkedInBooking) return;
    const { bookingId, token } = checkedInBooking;
    checkedInBooking = null;
    const res = await page.request.post(`${API_BASE}/api/bookings/checkout`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      data: {
        bookingId,
        // The folio carries a positive balance (the stay was never paid), so
        // the departure needs an unpaid reason. "other" is one of the
        // server's accepted shortcuts.
        unpaidCheckoutReason: "other"
      }
    });
    console.log(`      ST-04 · room released → check-out ${res.status()}`);
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
    // From four entries on, the ledger collapses behind an "N entries"
    // summary — expand it so the rows are in the tree.
    const entriesSummary = drawer.getByText(/^\d+ entries$/).first();
    if (await entriesSummary.count()) {
      await entriesSummary.click();
      await page.waitForTimeout(800);
    }
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

    // The first meal select that still holds a meal AND is editable is
    // the breakfast the guest bought. A slot the guest already removed
    // (or that was served) renders a DISABLED select, so it is skipped.
    const mealSelects = page.locator('select[aria-label^="Meal for"]');
    const count = await mealSelects.count();
    expect(count, "the manage-breakfast page must list the stay's meals").toBeGreaterThan(0);
    let target = -1;
    for (let i = 0; i < count; i++) {
      const select = mealSelects.nth(i);
      if (await select.isDisabled()) continue;
      if ((await select.inputValue()) !== "") {
        target = i;
        break;
      }
    }
    expect(target, "the paid breakfast must be listed as an editable meal").toBeGreaterThanOrEqual(0);
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
    expect(markBody.alreadyPaid, "the refund must not have been paid before").toBe(false);
    expect(markBody.refundEntry.status, "the refund must flip to paid").toBe("paid");
    expect(markBody.refundEntry.refundId).toBe(refundId);

    // The catalogue is explicit: the request must go to the GUEST origin
    // with a staff Bearer token.
    expect(markRes.url()).toContain("/api/refunds/mark-paid");
    const authHeader = markRes.request().headers()["authorization"] || "";
    expect(authHeader, "mark-paid must carry a staff Bearer token").toMatch(/^Bearer\s+\S+/);

    // The panel lists the PENDING liabilities only, so a settled refund
    // must leave it — the hotel no longer owes the guest that money.
    await page.waitForTimeout(3500);
    await expect(
      drawer2.getByTestId(`refund-row-${refundId}`),
      "a paid refund must no longer be listed as a pending liability"
    ).toHaveCount(0);
    await expect(
      page.getByText(/refund marked paid/i).first(),
      "the staff must be told the refund was settled"
    ).toBeVisible({ timeout: 15_000 });
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

    // The check-in gate needs the guest registration + an ID photo, and the
    // registration form is only offered once the booking is CONFIRMED —
    // `BookingRegistrationForm` renders nothing below that status. So the
    // booking is confirmed BEFORE the drawer is opened.
    const confirmRes = await page.request.post(`${API_BASE}/api/bookings/confirm`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: { bookingId: ids.id }
    });
    expect(confirmRes.status(), `bookings/confirm → ${await confirmRes.text()}`).toBe(200);

    await adminSignIn(page, admin);
    const drawer = await openDrawer(page, ids.id, created.bookingRef);

    // The check-in gate needs the guest registration + an ID photo.
    await openSection(page, "check-in");

    // A booking with NO registration renders the form straight away; a
    // booking whose registration is already complete renders a summary
    // with an "Edit registration" button. Handle both.
    const editRegistration = drawer.getByRole("button", { name: /edit registration/i }).first();
    if (await editRegistration.isVisible().catch(() => false)) {
      await editRegistration.click();
    }

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

    // Check in.
    const checkinRes = await page.request.post(`${API_BASE}/api/bookings/checkin`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
      data: { bookingId: ids.id }
    });
    const checkinText = await checkinRes.text();
    expect(checkinRes.status(), `bookings/checkin → ${checkinText}`).toBe(200);
    // From here on the room is held — the `afterEach` releases it.
    checkedInBooking = { bookingId: ids.id, token: staffToken };

    // ---- the guest opens the in-room shop -----------------------------
    await page.goto(`${API_BASE}/intercom/${ids.roomNumber}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);

    const lastName = page.getByPlaceholder("e.g. Santos");
    await expect(lastName, "the intercom must ask for the booking last name").toBeVisible({
      timeout: 25_000
    });
    // The guest types the last name EXACTLY as the booking carries it —
    // the server reads `guestDetails.lastName` (not a split of the full
    // name), so a shortened form would be refused.
    await lastName.fill(FLOW_LAST_NAME);
    await page.getByRole("button", { name: /start chatting/i }).click();
    await page.waitForTimeout(3500);

    // The store tab is labelled with the hotel's store name
    // (`config.storeName` — "Spark Essentials"), not the word "Shop".
    const shopTab = page
      .getByRole("button", { name: /spark essentials|shop/i })
      .first();
    await expect(shopTab, "the store tab must be there").toBeVisible({ timeout: 25_000 });
    await shopTab.click();
    await page.waitForTimeout(2500);

    // ---- clause 1: an out-of-stock item cannot be added ---------------
    const outOfStockCard = storeCard(page, "A7 Out Of Stock Test Item");
    await expect(outOfStockCard, "the out-of-stock item must be listed").toBeVisible({
      timeout: 20_000
    });
    await expect(
      outOfStockCard.getByText("Out of Stock", { exact: true }),
      "the item must be marked out of stock"
    ).toBeVisible({
      timeout: 20_000
    });
    const soldOut = outOfStockCard.getByRole("button", { name: /sold out/i }).first();
    await expect(soldOut, "an out-of-stock item must not be orderable").toBeDisabled();

    // ---- clause 2: put an in-stock item in the cart --------------------
    const probeCard = storeCard(page, "A7 Stock Probe Item");
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

    // "Cash on Delivery" needs no receipt screenshot (only the online
    // methods — gcash/paypal — do). Note the store's own method list
    // deliberately EXCLUDES "pay-at-hotel": it is the folio/check-out
    // option, not an in-room store method.
    const cashOnDelivery = page.locator('input[type="radio"][value="cod"]');
    await expect(cashOnDelivery, "cash on delivery must be offered").toBeAttached({ timeout: 15_000 });
    await cashOnDelivery.check({ force: true });

    // ---- the admin zeroes the stock while the item is in the cart ------
    const adminPage = await page.context().newPage();
    await adminSignIn(adminPage, admin);
    await adminPage.goto(`${ADMIN_BASE}/settings?tab=store`, { waitUntil: "domcontentloaded" });
    await adminPage.waitForTimeout(3500);

    const probeRow = adminStoreRow(adminPage, "A7 Stock Probe Item");
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
    // The catalogue restore is in a `finally`: a scenario that dies here
    // would otherwise leave the probe fixture at 0, and every later run
    // would find a sold-out probe item instead of a stockable one.
    try {
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

      // The cart must NOT be cleared — no order was placed. The floating
      // "My Basket" panel is hidden while the checkout drawer is open, so
      // the cart's own subtotal is what proves it: the Place Order button
      // carries the basket total, and it must still be ₱15 (one probe item).
      const placeOrder = page.getByRole("button", { name: /^place order/i }).first();
      await expect(placeOrder, "the basket must survive a refused order").toBeVisible({ timeout: 15_000 });
      expect(await placeOrder.innerText(), "the basket must still hold the item").toContain("15");
    } finally {
      // ---- restore the live catalogue ----------------------------------
      await adminPage.goto(`${ADMIN_BASE}/settings?tab=store`, { waitUntil: "domcontentloaded" });
      await adminPage.waitForTimeout(3000);
      const probeRow2 = adminStoreRow(adminPage, "A7 Stock Probe Item");
      await probeRow2.getByRole("button", { name: /^edit$/i }).first().click();
      const stockInput2 = adminPage.locator('input[name="stock"]').first();
      await expect(stockInput2).toBeVisible({ timeout: 15_000 });
      await stockInput2.fill(originalStock);
      await adminPage.getByRole("button", { name: /update item/i }).click();
      await adminPage.waitForTimeout(2500);
      console.log(`      ST-04 · the probe item's stock restored to ${originalStock}`);
    }
    await adminPage.close();
  });

  test("RW-03 · the drawer applies a points redemption and then undoes it", async ({ page }) => {
    const admin = requireIdentity("admin", ADMIN());
    const member = requireIdentity("member", MEMBER());
    const staffToken = await adminIdToken(admin.email, admin.password);

    // A signed-in member's booking is linked to the member automatically.
    await guestLogin(page, member);
    const dates = await pickFreeStay(270);
    const reuseRef = process.env.QA_REUSE_BOOKING_REF;
    let created: BookingResult | null = null;
    let ids: Awaited<ReturnType<typeof readBookingIds>>;
    if (reuseRef) {
      ids = await readBookingIds(reuseRef);
    } else {
      created = await createBookingViaBrowser(page, {
        ...dates,
        paymentMethod: "pay-at-hotel",
        email: member.email
      });
      expect(created.createStatus, "the booking must be created").toBe(200);
      ids = await readBookingIds(created.bookingRef);
    }
    expect(ids.memberId, "the booking must be linked to the member").not.toBe("");
    const total = created ? Number(created.createBody?.data?.totalPrice) : ids.totalPrice;
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
    const drawer = await openDrawer(page, ids.id, created?.bookingRef ?? reuseRef);
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

    const preview = drawer.getByText(/^Preview:/).first();
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
    const afterUndo = await readBookingIds(created?.bookingRef ?? reuseRef!);
    expect(afterUndo.totalPrice, "the undo must restore the booking total").toBe(total);
  });

  test("RW-01 · the signup issues a member number and the booking lands under My Stays", async ({
    page
  }) => {
    const member = requireIdentity("member", MEMBER());
    if (!RW01_PASSWORD) {
      test.skip(true, "No QA_RW01_PASSWORD — the signup scenario is not executed.");
    }

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
    // There is no inbox in this pass, so the harness generates the SAME
    // link the server sends and clicks it in the browser — the app's own
    // code path has to complete it.
    //
    // The link points at Firebase's OWN action handler
    // (`<project>.firebaseapp.com/__/auth/action?…&oobCode=…&continueUrl=…`).
    // That handler runs its own two-step confirmation — the guest clicks
    // "Complete verification", sees "Your email has been verified", and
    // clicks "Continue" — and only THEN is the guest sent to the server's
    // continue URL, `/account/profile?emailVerified=true`. The app must
    // notice that marker, refresh the stale id token (it still claims
    // `email_verified: false`) and re-run the registration so the past
    // bookings get linked.
    const verifyLink = await getVerificationLink(RW01_EMAIL);
    await page.goto(verifyLink, { waitUntil: "domcontentloaded" });
    const completeVerification = page.getByText(/complete verification/i).first();
    await expect(
      completeVerification,
      "the verification action page must offer its confirmation step"
    ).toBeVisible({ timeout: 60_000 });
    await completeVerification.click();

    const continueButton = page
      .getByRole("button", { name: /^continue$/i })
      .or(page.getByRole("link", { name: /^continue$/i }))
      .first();
    await expect(
      continueButton,
      "the verification action page must offer its continue step"
    ).toBeVisible({ timeout: 60_000 });
    await continueButton.click();

    await page.waitForURL(/\/account\/profile/, { timeout: 60_000 });
    // The app consumes the marker and takes it out of the URL.
    await page.waitForFunction(() => !window.location.href.includes("emailVerified=true"), undefined, {
      timeout: 45_000
    });
    await page.waitForTimeout(4000);

    const afterVerify = await page.locator("body").innerText();
    expect(
      afterVerify,
      "the member number must survive the verification"
    ).toMatch(/SR-\d{5}/);
    expect(
      afterVerify.match(/SR-\d{5}/)![0],
      "the member number must survive the verification"
    ).toBe(memberNumber);
    expect(
      afterVerify,
      "the 'verify your email' banner must clear once the link is clicked"
    ).not.toMatch(/verify your email/i);

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
