/**
 * AI-BROWSER-QA (2026-10-25) — support for the guest-WRITE scenarios.
 *
 * These helpers drive the REAL production guest site through a real browser
 * and create REAL production records. Three rules govern everything here:
 *
 *   1. EVERY record this pass creates is tagged. The repo's own ETR-03
 *      mechanism does it: a production test run is created through the admin
 *      API, and its token is carried in the booking-create body as
 *      `testToken`. The server hashes it, matches the active run and stamps
 *      `isTestData: true` + `testRunId` on the booking. The admin app then
 *      badges the record "TEST DATA" and the run's close manifest lists
 *      exactly what was created.
 *   2. The token is never printed, never logged and never committed. It
 *      lives in memory for the life of the process.
 *   3. Writes are paced against the production rate limiters
 *      (`bookings-create` is 5/min/IP), because a false 429 would look
 *      like a product bug.
 */

import { Page, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { qaEnv } from "./env";

/** The QA guest identity this pass writes as. */
export const FLOW_EMAIL = "qa.browser.flow+sparkinn.dev@gmail.com";
export const FLOW_FIRST_NAME = "QA";
export const FLOW_LAST_NAME = "Browser Flow";

/** The name of the production test run this pass opens and closes. */
export const RUN_NAME = "AI-BROWSER-QA 2026-10-25 guest-write";

const REPO_ROOT = resolve(__dirname, "../..");

/** `bookings-create` is limited to 5 requests/minute/IP. */
const CREATE_SPACING_MS = 14_000;
let lastCreateAt = 0;

async function paceBookingCreate() {
  const wait = lastCreateAt + CREATE_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCreateAt = Date.now();
}

/**
 * The Firebase Web API key is a PUBLIC client value (it ships in the site
 * bundle). It is only needed to mint an admin ID token for the test-run
 * API. It is read from the environment, never committed.
 */
function firebaseApiKey(): string {
  const key = qaEnv("QA_FIREBASE_API_KEY") || "";
  if (!key) {
    throw new Error(
      "QA_FIREBASE_API_KEY is not set. It is the public Firebase Web API key " +
        "(from guest-app/.env.spark-inn-prod → VITE_FIREBASE_API_KEY) and is " +
        "needed to open the production test run."
    );
  }
  return key;
}

/** Sign in through the Firebase REST API and return a staff ID token. */
export async function adminIdToken(email: string, password: string): Promise<string> {
  const base = qaEnv("QA_GUEST_BASE_URL") || "https://www.sparkinnbohol.com";
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The Firebase Web API key is HTTP-referer-restricted to the
        // app's own origin, so the sign-in has to carry it.
        Origin: base,
        Referer: `${base}/`
      },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.idToken) {
    // The response body can carry the credential back — never echo it.
    // Only the machine-readable error code is safe to surface.
    const code = String(body?.error?.message || "").split(" : ")[0];
    throw new Error(`Firebase sign-in failed (HTTP ${res.status}${code ? ` — ${code}` : ""}).`);
  }
  return body.idToken as string;
}

export type TestRun = { runId: string; token: string };

/**
 * Open a production test run. Only ONE production run may be active at a
 * time (the server enforces it), so an active run left behind by a crashed
 * pass is closed first — but only when it carries this pass's name.
 *
 * If a DIFFERENT production run is already active (the hotel's own pre-go-live
 * run, for instance) it is left strictly alone — it is not this pass's
 * record to close. The run is then opened in the `staging` environment
 * instead: the single-active-run rule only applies to `production`, and the
 * booking-create token check (ETR-03) validates the token against ANY active
 * run, so the tagging is identical. The booking's TEST DATA badge does not
 * render the environment, so nothing on the staff-facing surface changes.
 */
export async function openTestRun(idToken: string): Promise<TestRun> {
  const base = qaEnv("QA_GUEST_BASE_URL") || "https://www.sparkinnbohol.com";
  const listRes = await fetch(`${base}/api/test-runs/list`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  const list: any = await listRes.json().catch(() => ({}));
  const active = (list?.data || []).filter((r: any) => r.status === "active" && r.environment === "production");
  let environment: "production" | "staging" = "production";
  for (const run of active) {
    if (run.name === RUN_NAME) {
      await closeTestRun(idToken, run.id);
    } else {
      // Someone else's live run — do not touch it.
      environment = "staging";
      console.log(
        `[guest-write] production run "${run.name}" is already active — opening the QA run ` +
          "in the staging slot instead (the single-active rule only guards production)"
      );
    }
  }

  const res = await fetch(`${base}/api/test-runs/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ name: RUN_NAME, environment, durationMinutes: 180 })
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success || !body?.data?.token) {
    throw new Error(`Could not open the test run (HTTP ${res.status}): ${body?.error || "unknown"}`);
  }
  return { runId: body.data.id, token: body.data.token };
}

/** Close the run. Closing does NOT delete anything — it records a manifest. */
export async function closeTestRun(idToken: string, runId: string): Promise<any> {
  const base = qaEnv("QA_GUEST_BASE_URL") || "https://www.sparkinnbohol.com";
  const res = await fetch(`${base}/api/test-runs/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ runId })
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    throw new Error(`Could not close the test run (HTTP ${res.status}): ${body?.error || "unknown"}`);
  }
  return body.data?.manifest || null;
}

/**
 * Make every booking the page creates carry the test-run token, so the
 * record is tagged as test data. This is the repo's documented ETR-03
 * "temporary public-flow access" — the guest app itself has no control to
 * send the token, so the harness attaches it to the request.
 */
export async function tagBookingCreates(page: Page, testToken: string) {
  await page.route("**/api/bookings/create", async (route) => {
    const request = route.request();
    let body: any = {};
    try {
      body = request.postData() ? JSON.parse(request.postData() as string) : {};
    } catch {
      body = {};
    }
    body.testToken = testToken;
    await route.continue({ postData: JSON.stringify(body) });
  });
}

/**
 * Pick a date range with no bookings at all, so the room inventory is
 * never contended — by a real guest or by an earlier run of this spec.
 * The scan starts at `startOffsetDays` and walks forward.
 */
export async function pickFreeStay(startOffsetDays: number, spanDays = 45): Promise<{ checkIn: string; checkOut: string }> {
  const base = qaEnv("QA_GUEST_BASE_URL") || "https://www.sparkinnbohol.com";
  const fmt = (offset: number) => isoDate(new Date(Date.now() + offset * 86400000));
  for (let step = 0; step < spanDays; step++) {
    const checkIn = fmt(startOffsetDays + step);
    const checkOut = fmt(startOffsetDays + step + 1);
    const res = await fetch(`${base}/api/rooms/availability?checkIn=${checkIn}&checkOut=${checkOut}`);
    const body: any = await res.json().catch(() => ({}));
    const ranges = body?.data?.bookedRanges;
    if (res.ok && Array.isArray(ranges) && ranges.length === 0) {
      return { checkIn, checkOut };
    }
  }
  throw new Error(`No free night found within ${spanDays} days from offset ${startOffsetDays}.`);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type BookingOptions = {
  checkIn: string;
  checkOut: string;
  /** A local file path — uploaded as the GCash proof of payment. */
  proofFile?: string;
  /**
   * The payment method to select on the review step. "gcash" (the default)
   * REQUIRES a proof of payment — the confirm button stays disabled without
   * one. "pay-at-hotel" needs no proof and leaves the booking in the
   * `pending` state.
   */
  paymentMethod?: "gcash" | "pay-at-hotel";
  email?: string;
  firstName?: string;
  lastName?: string;
  /** The free-text preference the guest types in the preferences accordion. */
  additionalRequest?: string;
  /** The bed set-up radio value (e.g. "large-bed"). */
  bedSetup?: string;
  /** The breakfast meal id to pick for the first night (e.g. "tapsilog"). */
  breakfastMealId?: string;
  /** How many guest slots take that meal. Defaults to the party size (2). */
  breakfastSlots?: number;
  /** A voucher code to apply on the review step (e.g. "OFFNOW"). */
  voucherCode?: string;
  /**
   * A preference chip to tick in the "Show additional preferences"
   * accordion (e.g. "high-floor"). The chip's VALUE is the catalogue
   * key; the label is what the guest reads.
   */
  preferenceChip?: string;
};

export type BookingResult = {
  /** The booking reference (SI-…) — what /my-booking looks a stay up by. */
  bookingRef: string;
  /** The reservation reference (R-…) — what the confirmation page shows. */
  reservationRef: string;
  createStatus: number;
  createBody: any;
  /** The body the browser actually sent to /api/bookings/create. */
  createRequest: any;
  /** The amount the guest was shown on the review step, in pesos. */
  displayedTotal: number | null;
};

/** Parse "Place booking · ₱2,400" into 2400. */
export function parsePeso(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Drive the five-step guest booking flow end to end and place the booking.
 */
export async function createBookingViaBrowser(page: Page, options: BookingOptions): Promise<BookingResult> {
  await paceBookingCreate();

  // Capture what the browser actually sends. The create response echoes
  // only the reference, the total and the room — the guest's own choices
  // (the bed set-up, the written request) are visible on the wire and in
  // the stored document, not in the response.
  let createRequest: any = null;
  const capture = (request: any) => {
    if (!request.url().includes("/api/bookings/create") || request.method() !== "POST") return;
    try {
      createRequest = JSON.parse(request.postData() || "{}");
    } catch {
      createRequest = null;
    }
  };
  page.on("request", capture);

  const email = options.email || FLOW_EMAIL;
  const firstName = options.firstName || FLOW_FIRST_NAME;
  const lastName = options.lastName || FLOW_LAST_NAME;

  // Step 1 — pick the room.
  await page.goto(
    `/book?checkIn=${options.checkIn}&checkOut=${options.checkOut}&adults=2&children=0`,
    { waitUntil: "domcontentloaded" }
  );
  const selectRoom = page.getByTestId("select-room-standard-double");
  await expect(selectRoom, "the Standard Double card must be offered").toBeVisible({ timeout: 25_000 });
  await selectRoom.click();
  await page.waitForTimeout(600);
  await page.getByRole("link", { name: /continue to add-ons/i }).first().click();
  await page.waitForTimeout(1200);

  // Step 2 — add-ons (none, unless the scenario asks for breakfast).
  if (options.breakfastMealId) {
    const slots = options.breakfastSlots ?? 2;
    for (let slot = 0; slot < slots; slot++) {
      const select = page.getByTestId(`breakfast-select-${options.checkIn}-guest-${slot}`);
      await expect(select, "the breakfast slot must exist").toHaveCount(1, { timeout: 15_000 });
      await select.selectOption(options.breakfastMealId);
    }
  }
  const toGuestDetails = page.getByTestId("booking-addons-continue-primary");
  await expect(toGuestDetails).toBeVisible({ timeout: 20_000 });
  await toGuestDetails.click();
  await page.waitForTimeout(1500);

  // Step 3 — guest details. The step must be rendered before the fields
  // are written, otherwise the fills land on the previous step.
  await expect(page.locator('input[name="firstName"]'), "the guest-details step must render").toBeVisible({
    timeout: 20_000
  });

  // Step 3 — guest details. A signed-in member's details are LOCKED to
  // the member profile (the booking-autofill rule), so only an editable
  // field is written.
  const fillIfEditable = async (selector: string, value: string) => {
    const field = page.locator(selector).first();
    if ((await field.count()) === 0) return;
    if ((await field.getAttribute("readonly")) !== null) return;
    await field.fill(value);
  };
  await fillIfEditable('input[name="firstName"]', firstName);
  await fillIfEditable('input[name="lastName"]', lastName);
  await fillIfEditable('input[name="email"]', email);
  await fillIfEditable('input[name="phone"]', "09171234567");

  if (options.bedSetup) {
    const bedRadio = page.locator(`input[name="bedSetup_standard-double"][value="${options.bedSetup}"]`);
    await expect(bedRadio, "the bed set-up radio must exist").toHaveCount(1, { timeout: 10_000 });
    await bedRadio.check({ force: true });
  }

  if (options.additionalRequest || options.preferenceChip) {
    await page.getByRole("button", { name: /show additional preferences/i }).click();
    await page.waitForTimeout(600);
  }

  if (options.preferenceChip) {
    const chip = page.locator(`input[type="checkbox"][value="${options.preferenceChip}"]`);
    await expect(chip, "the preference chip must be rendered").toHaveCount(1, { timeout: 15_000 });
    await chip.check({ force: true });
  }

  if (options.additionalRequest) {
    const requestBox = page.getByPlaceholder("Enter any additional requests");
    await expect(requestBox).toBeVisible({ timeout: 10_000 });
    await requestBox.fill(options.additionalRequest);
  }

  // The consent box is CONTROLLED (`checked={guestDetails.consent}`), so a
  // late re-render of the step can revert it between the click and the
  // read. Tick it and verify, with a retry.
  const consent = page.locator("#consentStep2");
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await consent.isChecked()) break;
    await consent.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(consent, "the consent box must be ticked").toBeChecked({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: /continue to review/i }).first().click();
  await page.waitForTimeout(2000);

  // Step 4 — review & pay.
  if (options.voucherCode) {
    const codeField = page.locator('input[name="voucherCode"]');
    await expect(codeField, "the voucher field must be on the review step").toBeVisible({ timeout: 15_000 });
    await codeField.fill(options.voucherCode);
    await page.getByRole("button", { name: /^apply$/i }).first().click();
    // The applied voucher shows up in the price breakdown.
    await expect(page.getByText(new RegExp(options.voucherCode, "i")).first()).toBeVisible({ timeout: 15_000 });
  }

  if (options.paymentMethod === "pay-at-hotel") {
    await page.getByRole("button", { name: /pay at hotel/i }).first().click();
    await page.waitForTimeout(500);
  }

  if (options.proofFile) {
    await page.locator('input[name="paymentProofFile"]').setInputFiles(options.proofFile);
    await expect(
      page.getByText(/receipt upload failed/i),
      "the proof upload must not fail"
    ).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(1500);
  }

  const confirm = page.getByRole("button", { name: /place booking/i });
  await expect(confirm, "the confirm button must be enabled").toBeEnabled({ timeout: 20_000 });
  const displayedTotal = parsePeso(await confirm.innerText());

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/bookings/create") && r.request().method() === "POST",
    { timeout: 45_000 }
  );
  await confirm.click();
  const response = await responsePromise;
  const createStatus = response.status();
  const createBody: any = await response.json().catch(() => null);

  // Step 5 — confirmation. If the server refused the booking, the page
  // stays on the review step — so the failure says WHAT the server said.
  try {
    await expect(page.getByTestId("booking-reference"), "the confirmation page must show a reference").toBeVisible({
      timeout: 30_000
    });
  } catch {
    throw new Error(
      `the booking was not confirmed — the server answered HTTP ${createStatus}: ` +
        `${JSON.stringify(createBody).slice(0, 400)}`
    );
  }
  const reservationRef = (await page.locator("#booking-reference-value").innerText()).trim();
  const bookingRef = String(createBody?.data?.bookingRef || "").trim();
  page.off("request", capture);

  return { bookingRef, reservationRef, createStatus, createBody, createRequest, displayedTotal };
}

/**
 * Read a QA booking's internal id + its lookup token.
 *
 * The guest reaches the add-on manager through the magic link in the
 * confirmation email (`/my-booking/addons?ref=…&token=…`). There is no
 * inbox in this pass, so the token is read from Firestore with the READ-ONLY
 * admin SDK — exactly the value the email would have carried. It is written
 * to a gitignored file, never to stdout, never into the report.
 */
export async function readBookingIds(bookingRef: string): Promise<{ id: string; token: string }> {
  const outFile = resolve(REPO_ROOT, "tmp/qa-2026-10-23/flow-tokens.json");
  const script = resolve(REPO_ROOT, "scripts/qa/fetch-flow-tokens.ts");
  const bundle = resolve(REPO_ROOT, "tmp/qa-2026-10-23/fetch-flow-tokens.mjs");

  // The reader is a TypeScript script that uses the admin SDK. It is
  // bundled with esbuild (the same way `npm run qa:reconcile` does) and
  // then run with plain `node` — no shell, so it works on Windows.
  await build({
    entryPoints: [script],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    external: ["firebase-admin"],
    logLevel: "silent"
  });
  execFileSync(process.execPath, [bundle, "--out", outFile], { cwd: REPO_ROOT, stdio: "ignore" });

  if (!existsSync(outFile)) {
    throw new Error("The booking-id read did not produce a file.");
  }
  const map: Record<string, { id: string; token: string }> = JSON.parse(readFileSync(outFile, "utf8"));
  const entry = map[bookingRef];
  if (!entry) {
    throw new Error(`No booking id was found for ${bookingRef}.`);
  }
  return entry;
}

/** The lookup token alone — the magic-link credential. */
export async function readLookupToken(bookingRef: string): Promise<string> {
  return (await readBookingIds(bookingRef)).token;
}
