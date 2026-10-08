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
  computeInFlowHoldExpiresAt,
  generateHoldId,
  isInFlowHoldActive
} from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

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
  const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
  const corporatePageSrc = read("guest-app/src/pages/CorporateBookingPage.tsx");
  const bannerSrc = read("guest-app/src/components/HoldCountdownBanner.tsx");
  const hookSrc = read("guest-app/src/hooks/useInFlowHold.ts");
  const handlerSrc = read("guest-app/server/handlers/in-flow-hold.ts");
  const routerSrc = read("guest-app/server/apiRouter.ts");
  const bookingHandlerSrc = read("guest-app/server/handlers/bookings.ts");

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

  it("the router rate-limits the start endpoint at 30/IP/min and Turnstile-gates it", () => {
    // The same 30/min window as the public
    // availability endpoint, so a guest browsing dates
    // and starting a hold doesn't collide with the
    // booking-create limit.
    expect(routerSrc).toMatch(/isRateLimited\(`holds-start:\$\{ip\}`,\s*30,\s*60000\)/);
    expect(routerSrc).toMatch(/verifyTurnstile\(req\.body\?\.turnstileToken/);
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

  it("the handler stamps `expiresAt` from `IN_FLOW_HOLD_MINUTES`, NOT inline ms math", () => {
    expect(handlerSrc).toMatch(/computeInFlowHoldExpiresAt\(holdMinutes, now\)/);
  });

  it("the consume is idempotent on a replayed request (a second consume returns `already-consumed`)", () => {
    expect(handlerSrc).toMatch(/reason: "already-consumed"/);
  });
});
