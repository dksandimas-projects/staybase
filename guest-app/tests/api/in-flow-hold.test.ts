// Per IFH-01 (2026-10-08, per the in-flow hold decision):
// the public booking flow's Steps 2 + 3 countdown banner
// is a soft UX signal — the authoritative double-booking
// guarantee is the Firestore transaction in
// `handleCreateBooking`. This file pins the IFH-01
// contract so a future refactor cannot silently weaken
// the safety net or change the lifecycle without a
// matching update to `plan/docs/DECISIONS-FEATURES.md
// #IFH-01` + the spec MDs.
//
// The contract pinned below:
//
//   1. `IN_FLOW_HOLD_MINUTES` is a single shared constant
//      in `shared/utils/bookingInFlowHold.ts` (15 by
//      default; range 5..30). The `generateHoldId` +
//      `HOLD_ID_REGEX` helpers are the single sources of
//      the UUIDv4 id shape the URL + the server trust.
//   2. `StartBookingHoldSchema` rejects a missing
//      `holdId`, a non-UUIDv4 `holdId`, a `checkIn` /
//      `checkOut` not in YYYY-MM-DD, a non-positive
//      `numNights`, and a `checkOut` <= `checkIn`.
//   3. The `bookingHolds/{id}` collection is ephemeral —
//      the `Booking` type carries `inFlowHoldId` +
//      `inFlowHoldMinutes` as the audit link, NOT a
//      duplicate of the `holdExpiresAt` field. The two
//      holds (24h post-Confirm + 15min in-flow) are
//      distinct lifecycles that never share a writer.
//   4. The `handleCreateBooking` transaction in
//      `guest-app/server/handlers/bookings.ts` accepts
//      an OPTIONAL `holdId` (legacy pre-banner callers
//      stay green). When present, the post-commit
//      `handleConsumeInFlowHold` is best-effort
//      OUTSIDE the transaction — the booking
//      transaction's read-order (FOL-03) is unchanged.
//   5. The API router registers `holds/start` (Turnstile-
//      gated, 30/IP/min) + `holds/read` (60/IP/min) in
//      the existing catch-all — no new Vercel function,
//      the Hobby plan's 12-function cap is preserved.
//   6. The banner component `HoldCountdownBanner` is
//      only rendered on Step 2 + Step 3 (gated by
//      `isGuestDetailsStep || isReviewStep` in
//      `BookingPage.tsx` + the corporate equivalent in
//      `CorporateBookingPage.tsx`). Step 1 + Step 4
//      never render the banner.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StartBookingHoldSchema } from "@spark-inn/shared";
import {
  HOLD_ID_REGEX,
  IN_FLOW_HOLD_MINUTES,
  MAX_IN_FLOW_HOLD_MINUTES,
  MIN_IN_FLOW_HOLD_MINUTES,
  clampIntegerInRange,
  computeInFlowHoldExpiresAt,
  generateHoldId,
  isInFlowHoldActive,
  normalizeInFlowHoldMinutes
} from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

// Hoist the source-text reads to file scope so the
// follow-up describe block can reuse them without
// re-reading.
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const corporatePageSrc = read("guest-app/src/pages/CorporateBookingPage.tsx");
const bannerSrc = read("guest-app/src/components/HoldCountdownBanner.tsx");
const hookSrc = read("guest-app/src/hooks/useInFlowHold.ts");
const handlerSrc = read("guest-app/server/handlers/in-flow-hold.ts");
const routerSrc = read("guest-app/server/apiRouter.ts");
const bookingHandlerSrc = read("guest-app/server/handlers/bookings.ts");
const vercelSrc = read("guest-app/vercel.json");

describe("IFH-01 — Constants + helpers (shared/utils/bookingInFlowHold.ts)", () => {
  it("IN_FLOW_HOLD_MINUTES is 15 by default (industry norm for in-checkout holds)", () => {
    expect(IN_FLOW_HOLD_MINUTES).toBe(15);
  });

  it("the constant is bounded 5..30 minutes (any future change requires both bounds to move)", () => {
    expect(MIN_IN_FLOW_HOLD_MINUTES).toBe(5);
    expect(MAX_IN_FLOW_HOLD_MINUTES).toBe(30);
    expect(IN_FLOW_HOLD_MINUTES).toBeGreaterThanOrEqual(MIN_IN_FLOW_HOLD_MINUTES);
    expect(IN_FLOW_HOLD_MINUTES).toBeLessThanOrEqual(MAX_IN_FLOW_HOLD_MINUTES);
  });

  it("HOLD_ID_REGEX matches a UUIDv4 (8-4-4-4-12 hex, case-insensitive)", () => {
    expect("9a1f2c3d-4e5b-6a78-90ab-cdef12345678").toMatch(HOLD_ID_REGEX);
    expect("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE").toMatch(HOLD_ID_REGEX);
    expect("not-a-uuid").not.toMatch(HOLD_ID_REGEX);
    expect("9a1f2c3d-4e5b-6a78-90ab").not.toMatch(HOLD_ID_REGEX);
  });

  it("generateHoldId returns a UUIDv4-shaped string", () => {
    for (let i = 0; i < 8; i++) {
      const id = generateHoldId();
      expect(id).toMatch(HOLD_ID_REGEX);
    }
  });

  it("computeInFlowHoldExpiresAt stamps now + N minutes, NOT inline ms math", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    const expires = computeInFlowHoldExpiresAt(15, now);
    expect(expires).not.toBeNull();
    expect(expires!.toISOString()).toBe("2026-10-08T10:15:00.000Z");
  });

  it("computeInFlowHoldExpiresAt returns null for 0 / negative / non-finite minutes", () => {
    const now = new Date();
    expect(computeInFlowHoldExpiresAt(0, now)).toBeNull();
    expect(computeInFlowHoldExpiresAt(-5, now)).toBeNull();
    expect(computeInFlowHoldExpiresAt(NaN, now)).toBeNull();
    expect(computeInFlowHoldExpiresAt(null, now)).toBeNull();
    expect(computeInFlowHoldExpiresAt(undefined, now)).toBeNull();
  });

  it("isInFlowHoldActive treats `active` + future `expiresAt` as active", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    expect(
      isInFlowHoldActive(
        { status: "active", expiresAt: new Date("2026-10-08T10:14:59Z") },
        now
      )
    ).toBe(true);
  });

  it("isInFlowHoldActive treats past `expiresAt` as inactive, regardless of `status`", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    expect(
      isInFlowHoldActive(
        { status: "active", expiresAt: new Date("2026-10-08T09:59:59Z") },
        now
      )
    ).toBe(false);
  });

  it("isInFlowHoldActive treats `consumed` / `expired` as inactive even if `expiresAt` is future", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    expect(
      isInFlowHoldActive(
        { status: "consumed", expiresAt: new Date("2026-10-08T11:00:00Z") },
        now
      )
    ).toBe(false);
    expect(
      isInFlowHoldActive(
        { status: "expired", expiresAt: new Date("2026-10-08T11:00:00Z") },
        now
      )
    ).toBe(false);
  });
});

describe("IFH-01.2 — normalizeInFlowHoldMinutes (shared/utils/bookingInFlowHold.ts)", () => {
  it("returns the default for missing / non-finite / non-positive values", () => {
    expect(normalizeInFlowHoldMinutes(undefined)).toBe(IN_FLOW_HOLD_MINUTES);
    expect(normalizeInFlowHoldMinutes(null)).toBe(IN_FLOW_HOLD_MINUTES);
    expect(normalizeInFlowHoldMinutes(NaN)).toBe(IN_FLOW_HOLD_MINUTES);
    expect(normalizeInFlowHoldMinutes(0)).toBe(IN_FLOW_HOLD_MINUTES);
    expect(normalizeInFlowHoldMinutes(-3)).toBe(IN_FLOW_HOLD_MINUTES);
    expect(normalizeInFlowHoldMinutes("not a number")).toBe(IN_FLOW_HOLD_MINUTES);
  });

  it("clamps values below MIN_IN_FLOW_HOLD_MINUTES up to the floor", () => {
    expect(normalizeInFlowHoldMinutes(1)).toBe(MIN_IN_FLOW_HOLD_MINUTES);
    expect(normalizeInFlowHoldMinutes(MIN_IN_FLOW_HOLD_MINUTES - 1)).toBe(
      MIN_IN_FLOW_HOLD_MINUTES
    );
  });

  it("clamps values above MAX_IN_FLOW_HOLD_MINUTES down to the ceiling", () => {
    expect(normalizeInFlowHoldMinutes(60)).toBe(MAX_IN_FLOW_HOLD_MINUTES);
    expect(normalizeInFlowHoldMinutes(MAX_IN_FLOW_HOLD_MINUTES + 1)).toBe(
      MAX_IN_FLOW_HOLD_MINUTES
    );
  });

  it("returns in-range values verbatim (floored to integer)", () => {
    expect(normalizeInFlowHoldMinutes(15)).toBe(15);
    expect(normalizeInFlowHoldMinutes(15.7)).toBe(15);
    expect(normalizeInFlowHoldMinutes(MIN_IN_FLOW_HOLD_MINUTES)).toBe(
      MIN_IN_FLOW_HOLD_MINUTES
    );
    expect(normalizeInFlowHoldMinutes(MAX_IN_FLOW_HOLD_MINUTES)).toBe(
      MAX_IN_FLOW_HOLD_MINUTES
    );
  });
});

describe("IFH-01 — StartBookingHoldSchema (shared/schemas/booking.ts)", () => {
  // UUIDv4: version digit `4` at position 14, variant
  // digit `[89ab]` at position 19. `RESERVATION_ID_REGEX`
  // is the version-aware UUIDv1..5 regex from
  // `shared/utils/references.ts`.
  const validInput = {
    holdId: "9a1f2c3d-4e5b-4a78-90ab-cdef12345678",
    reservationId: "9a1f2c3d-4e5b-4a78-8abc-def123456789",
    roomType: "deluxe",
    checkIn: "2026-10-08",
    checkOut: "2026-10-10",
    numNights: 2
  };

  it("accepts a fully-valid input", () => {
    const result = StartBookingHoldSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects a missing `holdId`", () => {
    const { holdId, ...rest } = validInput;
    const result = StartBookingHoldSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUIDv4 `holdId`", () => {
    const result = StartBookingHoldSchema.safeParse({
      ...validInput,
      holdId: "not-a-uuid"
    });
    expect(result.success).toBe(false);
  });

  it("rejects a `checkIn` / `checkOut` not in YYYY-MM-DD", () => {
    expect(
      StartBookingHoldSchema.safeParse({ ...validInput, checkIn: "10/08/2026" }).success
    ).toBe(false);
    expect(
      StartBookingHoldSchema.safeParse({ ...validInput, checkOut: "2026-10-10T15:00:00Z" }).success
    ).toBe(false);
  });

  it("rejects a non-positive `numNights`", () => {
    expect(
      StartBookingHoldSchema.safeParse({ ...validInput, numNights: 0 }).success
    ).toBe(false);
    expect(
      StartBookingHoldSchema.safeParse({ ...validInput, numNights: -3 }).success
    ).toBe(false);
  });

  it("rejects a `checkOut` <= `checkIn`", () => {
    const sameDay = StartBookingHoldSchema.safeParse(validInput);
    // Sanity: the valid input is checkIn < checkOut, so
    // we need to construct a failing input explicitly.
    expect(
      StartBookingHoldSchema.safeParse({
        ...validInput,
        checkIn: "2026-10-10",
        checkOut: "2026-10-08"
      }).success
    ).toBe(false);
    expect(
      StartBookingHoldSchema.safeParse({
        ...validInput,
        checkIn: "2026-10-10",
        checkOut: "2026-10-10"
      }).success
    ).toBe(false);
    // The valid input itself is well-formed.
    expect(sameDay.success).toBe(true);
  });
});

describe("IFH-01 — Source-text pins", () => {
  it("BookingPage + CorporateBookingPage preallocate `holdId` via the shared helper", () => {
    expect(bookingPageSrc).toMatch(/generateHoldId/);
    expect(corporatePageSrc).toMatch(/generateHoldId/);
  });

  it("the banner component is gated to Step 2 + Step 3 in both flows", () => {
    expect(bookingPageSrc).toMatch(
      /isGuestDetailsStep \|\| isReviewStep/
    );
    expect(corporatePageSrc).toMatch(
      /currentStepKey === "guest-details" \|\| currentStepKey === "review"/
    );
  });

  it("the banner is honest about NOT being a hard inventory lock", () => {
    // The copy must mention the "if another guest books
    // first" hedge so a future "tighten the copy" change
    // is forced to also update the decision entry.
    expect(bannerSrc).toMatch(/another guest books first/);
  });

  it("the hook ticks every 1 second + resyncs every 30 seconds", () => {
    expect(hookSrc).toMatch(/TICK_MS = 1_000/);
    expect(hookSrc).toMatch(/RESYNC_MS = 30_000/);
  });

  it("the handler module is wired in the apiRouter catch-all (no new Vercel function)", () => {
    // The router imports the handler module — a new
    // Vercel function would mean a new top-level
    // `api/<name>.ts` file. The new routes must live
    // inside the existing catch-all.
    expect(routerSrc).toMatch(
      /from "\.\/handlers\/in-flow-hold"/
    );
    // Both new routes are dispatched by `domain === "holds"`.
    expect(routerSrc).toMatch(/domain === "holds" && action === "start"/);
    expect(routerSrc).toMatch(/domain === "holds" && action === "read"/);
  });

  it("the router rate-limits the start endpoint at 30/IP/min (no Turnstile — see fix/holds-start-turnstile)", () => {
    // The same 30/min window as the public
    // availability endpoint, so a guest browsing dates
    // and starting a hold doesn't collide with the
    // booking-create limit.
    //
    // Per the fix/holds-start-turnstile hotfix: the
    // start endpoint is NOT Turnstile-gated. The
    // useInFlowHold hook fires POST on Step 2 mount,
    // before the BookingPage's Turnstile widget (gated
    // to isReviewStep) has loaded a token. The actual
    // security gate is the booking transaction
    // (/api/bookings/create IS Turnstile-gated). A hold
    // is a soft UX signal, not a server-state change
    // with security implications. Rate limit is the
    // spam protection.
    expect(routerSrc).toMatch(/isRateLimited\(`holds-start:\$\{ip\}`,\s*30,\s*60000\)/);
    // Pin the absence: the start route's body
    // (the if-block gated on `domain === "holds" &&
    // action === "start"`) does NOT call
    // `verifyTurnstile` on `req.body?.turnstileToken`.
    // The other routes in apiRouter (bookings-create,
    // bookings-lookup, etc.) DO call verifyTurnstile,
    // so we narrow the assertion to the start route's
    // body.
    const startRouteBody = routerSrc.match(
      /domain === "holds" && action === "start" && req\.method === "POST"[\s\S]{0,800}?\);/
    );
    expect(startRouteBody).not.toBeNull();
    expect(startRouteBody![0]).not.toMatch(/verifyTurnstile/);
  });

  it("the consume call is OUTSIDE the booking transaction (best-effort, FOL-03 read-order unchanged)", () => {
    // The handler is imported by the booking
    // transaction file and called best-effort after
    // the `alreadyExistingBookingResponse` branch
    // (the post-transaction success path). The call
    // is not nested inside the `runTransaction`
    // callback.
    expect(bookingHandlerSrc).toMatch(/handleConsumeInFlowHold/);
    // The booking doc stamps the `inFlowHoldId` +
    // `inFlowHoldMinutes` fields.
    expect(bookingHandlerSrc).toMatch(/inFlowHoldId: holdId \|\| null/);
    expect(bookingHandlerSrc).toMatch(/inFlowHoldMinutes: holdId \? IN_FLOW_HOLD_MINUTES : null/);
  });

  it("the handler module is named `in-flow-hold.ts` and exports the three lifecycle entry points", () => {
    expect(handlerSrc).toMatch(/export async function handleStartInFlowHold/);
    expect(handlerSrc).toMatch(/export async function handleReadInFlowHold/);
    expect(handlerSrc).toMatch(/export async function handleConsumeInFlowHold/);
  });

  it("the handler stamps `expiresAt` from the per-hotel `inFlowHoldMinutes` (fallback to `IN_FLOW_HOLD_MINUTES` via normalize)", () => {
    // Per the IFH-01.2 (settings-routing) follow-up: the
    // start handler reads the settings doc and snapshots
    // the value — NOT the module constant.
    expect(handlerSrc).toMatch(
      /computeInFlowHoldExpiresAt\(effectiveHoldMinutes, now\)/
    );
  });

  it("the consume is idempotent on a replayed request (a second consume returns `already-consumed`)", () => {
    expect(handlerSrc).toMatch(/reason: "already-consumed"/);
  });
});

describe("IFH-01 follow-up — Janitor sweep cron", () => {
  it("the sweep handler is registered in the apiRouter (no new Vercel function, just a new catch-all branch)", () => {
    expect(routerSrc).toMatch(
      /domain === "holds" && action === "sweep"/
    );
  });

  it("the sweep uses the same `CRON_SECRET` auth as the existing PEX-06 expire cron", () => {
    expect(handlerSrc).toMatch(/process\.env\.CRON_SECRET/);
    expect(handlerSrc).toMatch(/req\.headers\?\.authorization/);
  });

  it("the sweep uses Firestore transactions with a per-doc recheck (a consumed hold is NOT re-marked `expired`)", () => {
    expect(handlerSrc).toMatch(/if \(freshData\.status === "consumed"\) return;/);
    expect(handlerSrc).toMatch(/if \(isInFlowHoldActive\(\{ status: freshData\.status, expiresAt \}, now\)\) \{/);
  });

  it("the sweep is ordered by `expiresAt ASC` (oldest deadlines swept first)", () => {
    expect(handlerSrc).toMatch(/\.orderBy\("expiresAt", "asc"\)/);
  });

  it("the sweep is registered as a daily cron in vercel.json (schedule: 0 2 * * *, Vercel Hobby-plan-compatible)", () => {
    // Per the Vercel Hobby plan limit ("Hobby accounts
    // are limited to daily cron jobs. This cron
    // expression (0 * * * *) would run more than once
    // per day") — the previous hourly schedule was
    // rejected at deploy time. The fix is in
    // `fix/vercel-hobby-hourly-cron`.
    expect(vercelSrc).toMatch(/"path":\s*"\/api\/holds\/sweep"/);
    expect(vercelSrc).toMatch(/"schedule":\s*"0 2 \* \* \*"/);
  });

  it("the sweep returns a `{ swept, scanned, runAt }` audit payload (idempotent re-fires report `swept: 0`)", () => {
    expect(handlerSrc).toMatch(/swept \+= 1;/);
    expect(handlerSrc).toMatch(/runAt: now\.toISOString\(\)/);
  });
});

describe("IFH-01.2 follow-up — Settings-routing (per-hotel `inFlowHoldMinutes`)", () => {
  const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
  const sharedUtilSrc = read("shared/utils/bookingInFlowHold.ts");

  it("the shared `normalizeInFlowHoldMinutes` clamps 5..30 (same shape as `normalizePaymentHoldWindowHours`)", () => {
    expect(sharedUtilSrc).toMatch(/DEFAULT_IN_FLOW_HOLD_MINUTES = IN_FLOW_HOLD_MINUTES/);
    expect(sharedUtilSrc).toMatch(
      /export function normalizeInFlowHoldMinutes\(raw: unknown\): number \{/
    );
    expect(sharedUtilSrc).toMatch(
      /Math\.min\(\s*MAX_IN_FLOW_HOLD_MINUTES,\s*Math\.max\(MIN_IN_FLOW_HOLD_MINUTES/
    );
    expect(sharedUtilSrc).toMatch(
      /if \(!Number\.isFinite\(value\) \|\| value <= 0\) return DEFAULT_IN_FLOW_HOLD_MINUTES/
    );
  });

  it("the AdminContext defaults `inFlowHoldMinutes: 15` + normalizes on hydrate (mirrors `paymentHoldWindowHours`)", () => {
    expect(adminContextSrc).toMatch(/inFlowHoldMinutes: 15,/);
    expect(adminContextSrc).toMatch(/normalizeInFlowHoldMinutes/);
    expect(adminContextSrc).toMatch(
      /inFlowHoldMinutes: normalizeInFlowHoldMinutes\(\(data as Partial<typeof hotelConfig>\)\?\.inFlowHoldMinutes\)/
    );
  });

  it("the start handler reads from `settings/hotelConfig.inFlowHoldMinutes` and falls back to the constant", () => {
    expect(handlerSrc).toMatch(
      /adminDb\.collection\("settings"\)\.doc\("hotelConfig"\)/
    );
    expect(handlerSrc).toMatch(
      /normalizeInFlowHoldMinutes\(\s*\(hotelConfig as \{ inFlowHoldMinutes\?: unknown \}\)\.inFlowHoldMinutes\s*\)/
    );
    expect(handlerSrc).toMatch(/holdMinutes: effectiveHoldMinutes/);
    expect(handlerSrc).toMatch(
      /computeInFlowHoldExpiresAt\(effectiveHoldMinutes, now\)/
    );
  });
});

describe("IFH-01.3 follow-up — Settings UI editor (Booking & Holds tab)", () => {
  const settingsPageSrc = read("admin-app/src/pages/SettingsPage.tsx");
  const sharedUtilSrc = read("shared/utils/bookingInFlowHold.ts");

  it("the Settings page adds a new 'holds' tab with the Clock4 icon", () => {
    // The TabId type is widened to include 'holds'.
    expect(settingsPageSrc).toMatch(/type TabId = .*"holds"/);
    // The VALID_TAB_IDS list includes 'holds'.
    expect(settingsPageSrc).toMatch(/"holds"\s*$/m);
    // The tabs array adds the Booking & Holds entry
    // with the Clock4 icon.
    expect(settingsPageSrc).toMatch(
      /id: "holds" as const, label: "Booking & Holds", icon: Clock4/
    );
  });

  it("the SettingsSaveKey type is widened to include 'holds' (the save-status map can track the new tab)", () => {
    expect(settingsPageSrc).toMatch(
      /type SettingsSaveKey = .*"holds"/
    );
  });

  it("the Booking & Holds form renders two number inputs with min/max validation", () => {
    // The form is gated behind `isAdmin` (same as
    // the Discounts tab — both surfaces are admin-only).
    expect(settingsPageSrc).toMatch(/activeTab === "holds"/);
    // The two inputs have the min/max attributes.
    expect(settingsPageSrc).toMatch(
      /id="paymentHoldWindowHours"[\s\S]{0,400}min=\{MIN_PAYMENT_HOLD_WINDOW_HOURS\}[\s\S]{0,200}max=\{MAX_PAYMENT_HOLD_WINDOW_HOURS\}/
    );
    expect(settingsPageSrc).toMatch(
      /id="inFlowHoldMinutes"[\s\S]{0,400}min=\{MIN_IN_FLOW_HOLD_MINUTES\}[\s\S]{0,200}max=\{MAX_IN_FLOW_HOLD_MINUTES\}/
    );
  });

  it("the `clampIntegerInRange` helper is the form-layer validation (Save is disabled when out of range)", () => {
    expect(sharedUtilSrc).toMatch(
      /export function clampIntegerInRange\(\s*raw: unknown,\s*min: number,\s*max: number\s*\): number \| null \{/
    );
    // Returns null for non-finite.
    expect(sharedUtilSrc).toMatch(/if \(!Number\.isFinite\(value\)\) return null;/);
    // Floors to integer.
    expect(sharedUtilSrc).toMatch(/const floored = Math\.floor\(value\);/);
    // Rejects out-of-range.
    expect(sharedUtilSrc).toMatch(/if \(floored < min \|\| floored > max\) return null;/);
  });

  it("the form calls `updateSettings('hotelConfig', {...})` for both fields, gated on the validate-and-normalize path", () => {
    // The save handler validates first (toast.error
    // if either value is out of range), then writes
    // both fields.
    expect(settingsPageSrc).toMatch(/handleSaveHolds/);
    expect(settingsPageSrc).toMatch(
      /paymentHoldWindowHours: paymentHoldWindowHoursValid!/
    );
    expect(settingsPageSrc).toMatch(
      /inFlowHoldMinutes: inFlowHoldMinutesValid!/
    );
  });

  it("the SaveActionFooter + SaveActionButton both accept the new `disabled` prop", () => {
    // SaveActionFooter's `disabled` prop type — the
    // JSDoc block + destructure are about 15 lines
    // apart, so use a 1500-char window.
    expect(settingsPageSrc).toMatch(
      /function SaveActionFooter[\s\S]{0,1500}disabled\?: boolean;/
    );
    // SaveActionButton's `disabled` prop type.
    expect(settingsPageSrc).toMatch(
      /function SaveActionButton[\s\S]{0,500}disabled\?: boolean;/
    );
  });
});

describe("IFH-01.3 — clampIntegerInRange (shared/utils/bookingInFlowHold.ts)", () => {
  it("returns null for non-finite / non-numeric input", () => {
    expect(clampIntegerInRange(undefined, 1, 72)).toBeNull();
    expect(clampIntegerInRange(null, 1, 72)).toBeNull();
    expect(clampIntegerInRange(NaN, 1, 72)).toBeNull();
    expect(clampIntegerInRange("not a number", 1, 72)).toBeNull();
  });

  it("returns null for out-of-range integers", () => {
    expect(clampIntegerInRange(0, 1, 72)).toBeNull();
    expect(clampIntegerInRange(73, 1, 72)).toBeNull();
    expect(clampIntegerInRange(4, 5, 30)).toBeNull();
    expect(clampIntegerInRange(31, 5, 30)).toBeNull();
  });

  it("returns the integer verbatim when in range (floored)", () => {
    expect(clampIntegerInRange(15, 5, 30)).toBe(15);
    expect(clampIntegerInRange(24, 1, 72)).toBe(24);
    expect(clampIntegerInRange(15.7, 5, 30)).toBe(15);
    expect(clampIntegerInRange(5, 5, 30)).toBe(5);
    expect(clampIntegerInRange(30, 5, 30)).toBe(30);
  });
});
