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
import { StartBookingHoldSchema, ExtendBookingHoldSchema } from "@spark-inn/shared";
import {
  HOLD_ID_REGEX,
  IN_FLOW_HOLD_MINUTES,
  MAX_IN_FLOW_HOLD_EXTENSIONS,
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

// Per IMT-01 (2026-10-13, `plan/project/ROADMAP.md §IMT`): an expired
// in-flow hold was an unrecoverable dead end. `holdId` was minted once
// per page instance and never re-rolled, `onPickNewRoom` only rewrote
// `?step=select-room`, Step 1's `continueParams` therefore re-added the
// SAME dead id, `/api/holds/read` answered HTTP 200 with
// `status: "expired"` (read-time evaluation), the hook's 404 →
// `POST /api/holds/start` branch therefore never fired — and the guest
// landed in a red-banner loop escapable only with a hard reload.
//
// The fix is narrow by design: re-roll the id on the EXPLICIT
// "Pick a new room" action only. Auto-reviving a dead hold on a plain
// re-entry would silently defeat the countdown (a guest who reloads the
// expired banner would get a fresh window forever), so the id must NOT
// be re-rolled from any other call site. The negative pin at the end of
// this block is what enforces that.
describe("IMT-01 — Expired-hold dead end fix (`holdId` re-roll)", () => {
  const statePattern = /const \[holdId, setHoldId\] = useState\(\(\) => generateHoldId\(\)\)/;

  // Pull the `onPickNewRoom` callback body out of a page source so the
  // ordering assertion can't be satisfied by a match elsewhere in the
  // file (both pages also call `generateHoldId` in the useState init).
  function onPickNewRoomBody(src: string): string {
    const marker = "onPickNewRoom={() => {";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, start + 700);
  }

  it("both flows destructure the SETTER alongside `holdId`", () => {
    expect(bookingPageSrc).toMatch(statePattern);
    expect(corporatePageSrc).toMatch(statePattern);
  });

  it("BookingPage.onPickNewRoom re-rolls the id BEFORE rewriting the URL", () => {
    const body = onPickNewRoomBody(bookingPageSrc);
    const rollAt = body.indexOf("setHoldId(generateHoldId())");
    const navAt = body.indexOf("setSearchParams(");
    expect(rollAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(-1);
    // Ordering is load-bearing: `continueParams` is rebuilt from the
    // `holdId` state on the next render, so rolling after the
    // navigation would still ship the dead id in the URL.
    expect(rollAt).toBeLessThan(navAt);
  });

  it("CorporateBookingPage.onPickNewRoom re-rolls the id BEFORE rewriting the URL", () => {
    const body = onPickNewRoomBody(corporatePageSrc);
    const rollAt = body.indexOf("setHoldId(generateHoldId())");
    const navAt = body.indexOf("setSearchParams(");
    expect(rollAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(-1);
    expect(rollAt).toBeLessThan(navAt);
  });

  it("`continueParams` reads `hold: holdId` in both flows, so the re-roll reaches the URL", () => {
    // Without this the whole fix is inert — the fresh id would never
    // travel to Step 2, and the hook would keep re-reading the dead doc.
    expect(bookingPageSrc).toMatch(/hold: holdId/);
    expect(corporatePageSrc).toMatch(/hold: holdId/);
  });

  it("`continueParams` is NOT memoized (a memo would strand the re-roll behind a stale closure)", () => {
    // Both pages build it as a render-body statement. A `useMemo` with a
    // dep array missing `holdId` would keep the OLD id in the URL and
    // silently reinstate the dead end.
    expect(bookingPageSrc).not.toMatch(
      /useMemo\([^)]*new URLSearchParams/
    );
    expect(corporatePageSrc).not.toMatch(
      /useMemo\([^)]*new URLSearchParams/
    );
  });

  it("the recovery action still exists on the expired state in the banner", () => {
    // IMT-01 changes WHO mints the id, not WHETHER the guest can recover.
    expect(bannerSrc).toMatch(/onPickNewRoom/);
    expect(bookingPageSrc).toMatch(/onPickNewRoom=\{\(\) =>/);
    expect(corporatePageSrc).toMatch(/onPickNewRoom=\{\(\) =>/);
  });

  it("NEGATIVE: `setHoldId` is called from exactly ONE site per page (explicit action only)", () => {
    // If a future change adds a second call site — e.g. an effect that
    // re-rolls whenever the hold reads as expired — the countdown becomes
    // unexpirable and the whole timer becomes decorative. This pin is the
    // enforcement mechanism for that design decision.
    expect((bookingPageSrc.match(/setHoldId\(/g) ?? []).length).toBe(1);
    expect((corporatePageSrc.match(/setHoldId\(/g) ?? []).length).toBe(1);
  });

  it("NEGATIVE: `useInFlowHold` still auto-stamps ONLY on a 404 (no auto-revive of a terminal hold)", () => {
    // The server-side counterpart to the pin above. If a future change
    // makes the hook POST /api/holds/start when the read reports a
    // terminal status, an expired hold silently revives on every remount
    // and the 15-minute window stops meaning anything.
    expect(hookSrc).toMatch(/readResponse\.status === 404 && startInput/);
    expect(hookSrc).not.toMatch(/status === "expired"/);
  });
});

// Per IMT-02 (2026-10-14): the `POST /api/holds/extend` request body.
// Runtime Zod coverage (not a source-text pin) because the whole point
// of the two-field shape is what it REJECTS — a pin on the schema's
// source text would pass happily while the object accepted a
// client-supplied `minutes`.
describe("IMT-02 — ExtendBookingHoldSchema (shared/schemas/booking.ts)", () => {
  const validHoldId = generateHoldId();
  const validReservationId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("accepts the minimal valid body (holdId + reservationId only)", () => {
    const parsed = ExtendBookingHoldSchema.safeParse({
      holdId: validHoldId,
      reservationId: validReservationId
    });
    expect(parsed.success).toBe(true);
  });

  it("REJECTS a client-supplied duration — the window must come from the hold doc", () => {
    // The load-bearing security property. A caller-supplied `minutes`
    // would be an unauthenticated way to pin a doc in "active" for as
    // long as they liked, defeating MAX_IN_FLOW_HOLD_EXTENSIONS.
    for (const key of ["minutes", "holdMinutes", "extraMinutes", "extendBy"]) {
      const parsed = ExtendBookingHoldSchema.safeParse({
        holdId: validHoldId,
        reservationId: validReservationId,
        [key]: 999
      });
      expect(parsed.success, `accepted a client-supplied \`${key}\``).toBe(false);
    }
  });

  it("REJECTS unknown keys (`.strict()` is what makes the above enforceable)", () => {
    const parsed = ExtendBookingHoldSchema.safeParse({
      holdId: validHoldId,
      reservationId: validReservationId,
      status: "active",
      expiresAt: "2026-10-14T12:00:00.000Z"
    });
    expect(parsed.success).toBe(false);
  });

  it("REJECTS a missing holdId / reservationId", () => {
    expect(
      ExtendBookingHoldSchema.safeParse({ reservationId: validReservationId }).success
    ).toBe(false);
    expect(
      ExtendBookingHoldSchema.safeParse({ holdId: validHoldId }).success
    ).toBe(false);
  });

  it("REJECTS a non-UUIDv4 holdId / reservationId", () => {
    expect(
      ExtendBookingHoldSchema.safeParse({
        holdId: "not-a-uuid",
        reservationId: validReservationId
      }).success
    ).toBe(false);
    expect(
      ExtendBookingHoldSchema.safeParse({
        holdId: validHoldId,
        reservationId: "also-not-a-uuid"
      }).success
    ).toBe(false);
  });

  it("does NOT require roomType / dates — an extension changes time, not the hold", () => {
    const parsed = ExtendBookingHoldSchema.safeParse({
      holdId: validHoldId,
      reservationId: validReservationId
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual(["holdId", "reservationId"]);
    }
  });
});

describe("IMT-02 — `POST /api/holds/extend` handler + route", () => {
  it("the extend handler is registered on the existing catch-all (no new Vercel function)", () => {
    expect(routerSrc).toMatch(
      /domain === "holds" && action === "extend" && req\.method === "POST"/
    );
    expect(routerSrc).toMatch(/handleExtendInFlowHold/);
  });

  it("rate-limited at 10/IP/min — tighter than start's 30", () => {
    // Extend is the call that extends doc lifetime, so it gets the
    // tighter budget. Pin the exact limiter so a future copy-paste of
    // start's 30 has to be deliberate.
    expect(routerSrc).toMatch(/isRateLimited\(`holds-extend:\$\{ip\}`, 10, 60000\)/);
  });

  it("is NOT Turnstile-gated (same reason as start — the token is not available on Step 2)", () => {
    // Extend must never grow a `verifyTurnstile` call. The hook fires
    // on Steps 2 + 3 before the Step-3-only widget has a token; see
    // `fix/holds-start-turnstile`.
    //
    // Two separate places a gate could appear, both checked: the route
    // branch in apiRouter, and the handler body itself. (The route
    // slice must start at the extend `if`, not before it — the start
    // route directly above discusses Turnstile at length in its
    // comments, which is the correct historical record and must not
    // fail this assertion.)
    const routeStart = routerSrc.indexOf(
      'if (domain === "holds" && action === "extend"'
    );
    const routeBlock = routerSrc.slice(
      routeStart,
      routerSrc.indexOf("handleExtendInFlowHold(req, res)")
    );
    expect(routeStart).toBeGreaterThan(-1);
    expect(routeBlock).not.toMatch(/verifyTurnstile/);

    const handlerStart = handlerSrc.indexOf(
      "export async function handleExtendInFlowHold"
    );
    const handlerBody = handlerSrc.slice(
      handlerStart,
      handlerSrc.indexOf("\n}", handlerStart)
    );
    expect(handlerBody).not.toMatch(/verifyTurnstile/);
  });

  it("reads the window from the doc's own holdMinutes, never from the request", () => {
    expect(handlerSrc).toMatch(
      /normalizeInFlowHoldMinutes\(data\.holdMinutes\)/
    );
    expect(handlerSrc).not.toMatch(/input\.(minutes|holdMinutes|extraMinutes)/);
  });

  it("validates with ExtendBookingHoldSchema and rejects non-POST", () => {
    expect(handlerSrc).toMatch(/ExtendBookingHoldSchema\.safeParse\(req\.body\)/);
    expect(handlerSrc).toMatch(/req\.method !== "POST"/);
  });

  it("all transaction reads complete BEFORE any write (GOTCHAS FOL-03)", () => {
    const start = handlerSrc.indexOf("export async function handleExtendInFlowHold");
    const body = handlerSrc.slice(start, handlerSrc.indexOf("\n}", start));
    const readAt = body.indexOf("await transaction.get(ref)");
    const writeAt = body.indexOf("transaction.update(ref");
    expect(readAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    // EXACTLY ONE read, and it precedes the write. Counting rather
    // than position-checking matters: the FOL-03 class is "ANY read
    // after ANY write", so an assertion that only checks where the
    // FIRST read sits passes happily when a second read is appended
    // after the update — which is precisely the antipattern this is
    // meant to catch.
    const reads = body.match(/await transaction\.get\(/g) ?? [];
    expect(reads.length).toBe(1);
    expect(readAt).toBeLessThan(writeAt);
    // No bare `ref.get()` / `ref.update()` shortcut either — both
    // bypass the transaction and reintroduce the read-modify-write
    // race on `extensionCount`.
    expect(body).not.toMatch(/(?<!transaction\.)ref\.get\(/);
    expect(body).not.toMatch(/(?<!transaction\.)ref\.update\(/);
  });

  it("gates on `canExtendInFlowHold` (the single authority for status + cap)", () => {
    const start = handlerSrc.indexOf("export async function handleExtendInFlowHold");
    const body = handlerSrc.slice(start, handlerSrc.indexOf("\n}", start));
    expect(body).toMatch(/canExtendInFlowHold\(\{/);
    // The gate must not be re-implemented inline alongside it.
    expect(body).not.toMatch(/extensionCount >|extensionCount >=|status === "consumed" &&/);
  });

  it("revives an expired hold to 'active' and stamps the counter + updatedAt", () => {
    const start = handlerSrc.indexOf("export async function handleExtendInFlowHold");
    const body = handlerSrc.slice(start, handlerSrc.indexOf("\n}", start));
    expect(body).toMatch(/status: "active"/);
    expect(body).toMatch(/extensionCount: nextExtensionCount/);
    expect(body).toMatch(/updatedAt: Timestamp\.fromDate\(now\)/);
    // Per the CVQ-04 answer, no dedicated timestamp field was added.
    expect(body).not.toMatch(/extendedAt:/);
  });

  it("uses the additive window helper (never a reset-from-now inline)", () => {
    const start = handlerSrc.indexOf("export async function handleExtendInFlowHold");
    const body = handlerSrc.slice(start, handlerSrc.indexOf("\n}", start));
    expect(body).toMatch(/computeExtendedInFlowHoldExpiresAt\(/);
    expect(body).not.toMatch(/now\.getTime\(\) \+ holdMinutes/);
  });

  it("`serializeHold` takes (docId, data) so post-update state can be constructed in JS", () => {
    // A transaction cannot observe the doc it just wrote (FOL-03), so
    // the extended handler must serialize a JS-built shape.
    expect(handlerSrc).toMatch(/function serializeHold\(\s*docId: string,/);
    expect(handlerSrc).toMatch(/extensionCount: Number\(raw\.extensionCount \?\? 0\)/);
  });

  it("`serializeHold` callers were all migrated to the new signature", () => {
    // Guards the refactor: a stale single-arg call is a compile error
    // today, but this pin documents that all four sites were visited.
    expect(handlerSrc).toMatch(/serializeHold\(existing\.id, existing\.data\(\)\)/);
    expect(handlerSrc).toMatch(/serializeHold\(fresh\.id, fresh\.data\(\)\)/);
    expect(handlerSrc).toMatch(/serializeHold\(snap\.id, snap\.data\(\)\)/);
  });

  it("the cap constant is exported from shared (never hardcoded in the handler)", () => {
    expect(handlerSrc).toMatch(/MAX_IN_FLOW_HOLD_EXTENSIONS/);
    expect(handlerSrc).not.toMatch(/extensionCount >= 3/);
    expect(MAX_IN_FLOW_HOLD_EXTENSIONS).toBe(3);
  });
});

describe("IMT-02 — no new Vercel function / no Firestore rules change", () => {
  it("the holds routes stay inside the single catch-all function", () => {
    // Every holds/* route is a branch in the existing router, so the
    // Hobby plan's 12-function cap is untouched by IMT-02.
    expect(routerSrc).toMatch(/domain === "holds" && action === "start"/);
    expect(routerSrc).toMatch(/domain === "holds" && action === "read"/);
    expect(routerSrc).toMatch(/domain === "holds" && action === "extend"/);
  });

  it("bookingHolds still has NO Firestore rules block (default-deny, Admin-SDK only)", () => {
    // The extend handler writes through the Admin SDK, which bypasses
    // rules. If a `match /bookingHolds/{id}` block ever appears, this
    // pin forces a re-review of the client trust model.
    const rulesSrc = read("firebase/firestore.rules");
    expect(rulesSrc).not.toMatch(/match \/bookingHolds/);
    expect(rulesSrc).toMatch(/match \/staffInventoryHolds/);
  });
});

// Per IMT-03 (2026-10-14): the "I need more time" UI. The endpoint
// exists as of IMT-02; this block pins that the guest can actually
// reach it, that the CTA respects the cap instead of letting them tap
// a 409, and that the announcement channel is not the ticking
// countdown.
describe("IMT-03 — `extendHold()` in useInFlowHold", () => {
  it("the hook exposes extendHold + the in-flight / error / canExtend state", () => {
    expect(hookSrc).toMatch(/extendHold: \(\) => Promise<ExtendHoldResult>/);
    expect(hookSrc).toMatch(/isExtending/);
    expect(hookSrc).toMatch(/extendError/);
    expect(hookSrc).toMatch(/canExtend/);
  });

  it("posts ONLY holdId + reservationId to /api/holds/extend", () => {
    // The endpoint's schema is `.strict()` — anything else is a 400.
    // Most importantly no duration: the window is server-derived.
    expect(hookSrc).toMatch(/"\/api\/holds\/extend"/);
    const body = hookSrc.slice(
      hookSrc.indexOf('"/api/holds/extend"'),
      hookSrc.indexOf('"/api/holds/extend"') + 700
    );
    expect(body).toMatch(/holdId,/);
    expect(body).toMatch(/reservationId: hold\.reservationId/);
    expect(body).not.toMatch(/minutes/i);
  });

  it("adopts the server's authoritative hold wholesale (no client-side timer restart)", () => {
    // The hook owns no separate countdown — it reads `hold.expiresAt`.
    // Pushing the server's shape in is what makes the existing 1s tick
    // and 30s resync carry over unchanged.
    expect(hookSrc).toMatch(/setHold\(json\.data as InFlowHoldView\)/);
    expect(hookSrc).toMatch(/setNow\(Date\.now\(\)\)/);
  });

  it("does NOT clobber the running countdown on failure", () => {
    // A failed extend must leave `hold` alone so the guest keeps their
    // remaining time and can still submit.
    const fn = hookSrc.slice(
      hookSrc.indexOf("const extendHold = useCallback"),
      hookSrc.indexOf("}, [holdId, hold, isExtending]);")
    );
    expect(fn).toMatch(/setExtendError\(message\)/);
    expect(fn).toMatch(/return \{ ok: false, error: message \}/);
    // No setHold on any failure branch: the only setHold in the
    // callback is inside the success path guarded by a success check.
    const setHoldAt = fn.indexOf("setHold(");
    const okGuardAt = fn.indexOf("if (!response.ok || !json || json.success !== true)");
    expect(setHoldAt).toBeGreaterThan(okGuardAt);
  });

  it("guards against a double-submit burning two extensions from one tap", () => {
    // The cap is finite (3), so a double-tap must not consume two.
    expect(hookSrc).toMatch(/if \(isExtending\) \{/);
  });

  it("NEGATIVE: the hook never calls its OWN extendHold — revival stays explicit", () => {
    // The server-side never-auto-revive rule (GOTCHAS) has a client
    // half: nothing inside the hook may invoke the extension. The only
    // legitimate call site is the banner CTA's onClick handler.
    //
    // Counted as a hard zero rather than pattern-matched: the
    // declaration is `const extendHold = useCallback(...)` (no paren
    // after the name) and the return object lists `extendHold,`, so
    // any `extendHold(` inside the hook body IS an invocation.
    const hookBody = hookSrc.slice(hookSrc.indexOf("export function useInFlowHold"));
    expect((hookBody.match(/extendHold\(\)/g) ?? []).length).toBe(0);
    // And no effect may reach for it either, whatever the shape.
    expect(hookBody).not.toMatch(/status === "expired"/);
  });

  it("delegates the cap gate to the shared helper instead of reimplementing it", () => {
    expect(hookSrc).toMatch(/import \{ canExtendInFlowHold \} from "@spark-inn\/shared"/);
    expect(hookSrc).toMatch(/canExtendInFlowHold\(\{/);
  });
});

describe("IMT-03 — HoldCountdownBanner extend CTA", () => {
  it("renders `hold-extend-cta` on BOTH the active and the expired state", () => {
    // Two distinct branches, so the count must be 2 — one is a
    // regression guard against the button silently existing only on
    // one of them.
    const matches = bannerSrc.match(/data-testid="hold-extend-cta"/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("disables the CTA in flight and exposes the state for tests", () => {
    expect(bannerSrc).toMatch(/disabled=\{isExtending\}/);
    expect(bannerSrc).toMatch(/data-state=\{isExtending \? "extending" : "idle"\}/);
  });

  it("meets the hard UI rules: 8px radius + 44px touch height", () => {
    // CLAUDE.md: no sharp corners (8px buttons), 44px minimum touch
    // height. `min-h-11` is the guest app's dominant convention.
    expect(bannerSrc).toMatch(/rounded-lg/);
    expect(bannerSrc).toMatch(/min-h-11/);
  });

  it("hides the CTA at the cap instead of letting the guest tap a 409", () => {
    expect(bannerSrc).toMatch(/\{canExtend \? \(/);
    expect(bannerSrc).toMatch(/canExtend/);
  });

  it("NEGATIVE: the cap number is NOT hardcoded in the banner", () => {
    // The component must consume `canExtend` from the hook, which
    // delegates to shared `canExtendInFlowHold`.
    expect(bannerSrc).not.toMatch(/MAX_IN_FLOW_HOLD_EXTENSIONS/);
    expect(bannerSrc).not.toMatch(/extensionCount >= \d/);
  });

  it("demotes 'Pick a new room' on the expired state and gives extend the primary slot", () => {
    // A guest watching the timer hit 0:00 wants to continue, not
    // restart — emphasis, not removal. Both CTAs stay reachable.
    expect(bannerSrc).toMatch(/data-testid="hold-pick-new-room-cta"/);
    const expired = bannerSrc.slice(
      bannerSrc.indexOf('data-state="expired"'),
      bannerSrc.indexOf("// Active state")
    );
    expect(expired).toMatch(/data-testid="hold-extend-cta"/);
    expect(expired).toMatch(/data-testid="hold-pick-new-room-cta"/);
    // The expired branch no longer promises an extension it may not
    // honour — the copy switches on `canExtend`.
    expect(expired).toMatch(/canExtend \?/);
  });

  it("shows honest inline copy when the server refuses (extendError)", () => {
    expect(bannerSrc).toMatch(/data-testid="hold-extend-error"/);
    expect(bannerSrc).toMatch(/extendError \?/);
  });

  it("the banner's CTA handler is the ONE call site of extendHold()", () => {
    expect(bannerSrc).toMatch(/const handleExtend = useCallback/);
    expect(bannerSrc).toMatch(/await extendHold\(\)/);
    // Both CTA branches route through the same handler rather than
    // inlining their own fetch.
    expect((bannerSrc.match(/onClick=\{handleExtend\}/g) ?? []).length).toBe(2);
  });

  it("announces through a dedicated sr-only live region, NOT the ticking banner", () => {
    expect(bannerSrc).toMatch(/className="sr-only" role="status" aria-live="polite"/);
    expect(bannerSrc).toMatch(/data-testid="hold-announcement"/);
  });

  it("NEGATIVE: the ticking active-state CONTAINER is not an aria-live region", () => {
    // Pre-existing defect, fixed in IMT-03: the banner carried
    // `role="status" aria-live="polite"` around a subtree that
    // re-renders every second, i.e. one screen-reader announcement per
    // second. It is now a plain `region`.
    //
    // Scoped to the container's OPENING TAG on purpose — the branch
    // also contains the deliberate `sr-only` announcement region,
    // which IS a live region and must stay one.
    const active = bannerSrc.slice(
      bannerSrc.indexOf("// Active state"),
      bannerSrc.length
    );
    const openingTag = active.slice(0, active.indexOf(">"));
    expect(openingTag).toMatch(/role="region"/);
    expect(openingTag).toMatch(/aria-label="Room hold status"/);
    expect(openingTag).not.toMatch(/aria-live/);
    expect(openingTag).not.toMatch(/role="status"/);
    // The pill keeps its own label for on-demand reading.
    expect(active).toMatch(/aria-label=\{`Time left:/);
  });

  it("all React hooks run before the early returns (no conditional-hook order break)", () => {
    const lastHook = bannerSrc.lastIndexOf("useCallback(");
    const firstReturn = bannerSrc.indexOf("if (!holdId) return null;");
    expect(lastHook).toBeGreaterThan(-1);
    expect(firstReturn).toBeGreaterThan(-1);
    expect(lastHook).toBeLessThan(firstReturn);
  });
});

// Per IMT-05 (2026-10-14): the banner must be brand-rebrandable.
// White-label is the whole point of `hotel.config.ts` — a hotel that
// changes `colors.primary` and gets a Spark-orange booking banner still
// is not rebranded.
describe("IMT-05 — banner uses brand tokens, not a hardcoded palette", () => {
  /**
   * Strip comments before running class-name pins.
   *
   * This codebase's house style is extremely verbose explanatory
   * comments, and those comments legitimately QUOTE class names to
   * explain them (e.g. "`bg-red-600` the established danger action").
   * Without this, every pin below would eventually fail on prose rather
   * than on code — and the obvious "fix" would be to delete the
   * explanation, which is backwards. Class pins read code; the
   * documentation pin (below) deliberately reads the comments.
   */
  const code = bannerSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");

  it("NEGATIVE: no indigo classes remain — indigo was the one-off", () => {
    // Verified before the change: indigo appeared in ZERO other
    // guest-app components. Every indigo class in the codebase lived
    // in this file, so it was an unbranded orphan rather than a house
    // convention.
    expect(code).not.toMatch(/indigo-\d/);
  });

  it("the active state is brand-tinted via the `primary` tokens", () => {
    expect(code).toMatch(/bg-primary-light/);
    expect(code).toMatch(/border-primary/);
    // Body copy stays gray: `text-primary` on `primary-light` is
    // 2.35:1 and would fail AA for the heading and sub-copy.
    expect(code).toMatch(/text-gray-900/);
    expect(code).toMatch(/text-gray-700/);
  });

  it("brand color is only ever carried by DECORATIVE elements, never reading text", () => {
    // Measured: #EA8A1A on #FEF3E2 is 2.35:1 — unusable for copy.
    // Brand color may appear as an accent (icon, border, button fill),
    // but any element using `text-primary` must be aria-hidden, i.e.
    // purely decorative and invisible to assistive tech.
    const brandTextLines = code
      .split("\n")
      .filter((line) => /text-primary(?!-)/.test(line));
    expect(brandTextLines.length).toBeGreaterThan(0);
    for (const line of brandTextLines) {
      expect(line).toMatch(/aria-hidden/);
    }
  });

  it("the PRIMARY CTA uses the brand token, not a palette color", () => {
    // This was the real hard-rule violation: after IMT-03 the
    // primary action on the expired state was `bg-red-600`.
    expect(code).toMatch(/bg-primary[^\"]*font-semibold text-gray-900/);
    expect(code).toMatch(/hover:bg-primary-dark/);
    expect(code).not.toMatch(/bg-red-600/);
  });

  it("CTAs use `text-gray-900`, NOT the app-wide `text-white` convention", () => {
    // Measured: #EA8A1A + white = 2.58:1 (fails AA).
    // #EA8A1A + gray-900 = 6.88:1 (passes). The rest of the app
    // still ships the 2.58:1 version — see the IMT-05 roadmap note.
    expect(code).not.toMatch(/bg-primary[^\"]*text-white/);
    expect(code).toMatch(/bg-primary[^\"]*text-gray-900/);
  });

  it("the danger + warning SURFACES stay semantic (not rebranded)", () => {
    // Deliberate. "Your hold expired" must not turn orange when a
    // client changes their brand color — it would destroy the signal.
    // These match the established app patterns: `border-amber-200
    // bg-amber-50` (11 uses) and `bg-red-600` danger actions (5 uses).
    expect(code).toMatch(/border-amber-200 bg-amber-50/);
    expect(code).toMatch(/border-red-300 bg-red-50/);
  });

  it("the countdown pill keeps semantic urgency tiers, with no brand color in the normal tier", () => {
    // A normal countdown in brand orange would compete with the
    // urgency signal; amber (<=3min) and red (<=1min) stay.
    expect(code).toMatch(/text-amber-700 ring-amber-200/);
    expect(code).toMatch(/text-red-700 ring-red-200/);
    expect(code).toMatch(/text-gray-700 ring-gray-200/);
  });

  it("documents the colour policy in the component header (so it survives the next refactor)", () => {
    // Reads the COMMENTS on purpose — this pin is about the reasoning
    // surviving, not about any class name.
    expect(bannerSrc).toMatch(/COLOR POLICY \(IMT-05\)/);
    expect(bannerSrc).toMatch(/semantic state signals, not brand/);
    // The stale "blue/indigo" description is gone.
    expect(bannerSrc).not.toMatch(/blue\/indigo banner/);
  });
});

// Per IMT-03 follow-up (2026-10-14): the owner asked for the "I need
// more time" CTA to appear only when the timer is nearly out, instead
// of sitting beside the countdown for the whole window.
//
// Two things are being pinned here, and the second is the important
// one: the ACTIVE state reveals on a countdown threshold, but the
// EXPIRED state must still offer it unconditionally. That is what makes
// the reveal safe — a guest who missed the window is not stranded,
// because the button is waiting for them on the red banner.
describe("IMT-03 follow-up — urgent-only CTA reveal", () => {
  const code = bannerSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");

  it("the reveal threshold is a named constant, not a magic number in the JSX", () => {
    expect(bannerSrc).toMatch(/const HOLD_EXTEND_CTA_REVEAL_SECONDS = 60/);
    expect(code).toMatch(/secondsLeft <= HOLD_EXTEND_CTA_REVEAL_SECONDS/);
  });

  it("the ACTIVE branch gates on the countdown threshold, not on `canExtend` alone", () => {
    // Regression guard: if this ever reverts to a bare `canExtend ?`
    // the button is back on screen for the whole 15 minutes, which is
    // the exact thing the owner asked to change.
    const active = code.slice(code.indexOf("const showExtendCta"));
    expect(active).toMatch(/canExtend && secondsLeft <= HOLD_EXTEND_CTA_REVEAL_SECONDS/);
    expect(active).toMatch(/\{showExtendCta \? \(/);
  });

  it("the threshold matches the countdown pill's red tier, so the reveal is motivated", () => {
    // Both are 60. The CTA appearing at the instant the pill already
    // turns red reads as intentional; an unrelated threshold would be
    // a fourth arbitrary state boundary.
    expect(code).toMatch(/secondsLeft <= 60/);
    const constant = bannerSrc.match(/HOLD_EXTEND_CTA_REVEAL_SECONDS = (\d+)/);
    expect(constant).not.toBeNull();
    expect(Number(constant![1])).toBe(60);
  });

  it("the EXPIRED branch still shows the CTA on `canExtend` alone — the safety net", () => {
    // This is what makes a narrow reveal window acceptable. Missing the
    // 60s reveal drops the guest onto the red banner, where "I need more
    // time" is the primary action — so no guest is ever stranded.
    const expired = code.slice(
      code.indexOf('data-state="expired"'),
      code.indexOf("const expiresAt = formatTime")
    );
    expect(expired).toMatch(/\{canExtend \? \(/);
    expect(expired).toMatch(/data-testid="hold-extend-cta"/);
    expect(expired).not.toMatch(/showExtendCta/);
  });

  it("documents why the threshold is not tighter than 60s", () => {
    // The reasoning is load-bearing: someone tightening this to 15s
    // would drop the slow-connection guest into the expired state.
    expect(bannerSrc).toMatch(/Why 60s and not a much tighter window/);
    expect(bannerSrc).toMatch(/exactly the flows that blow past 15 seconds/);
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
