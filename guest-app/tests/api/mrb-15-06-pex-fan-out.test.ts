// Per MRB-15-06 (2026-08-03): the PEX (Pending-booking
// Expiry, decision #147) fan-out audit. Every path
// that touches `holdExpiresAt` uses the shared
// `computeHoldExpiresAt` helper from
// `shared/utils/bookingOccupancy.ts` and the shared
// `isBookingOccupyingRoom` occupancy rule. The
// PEX-01..06 contract is:
//
//   - `holdExpiresAt` is a single field on the
//     booking doc + the reservation header. The
//     shared helper is the only authority for
//     stamping the value (every call site reads
//     the same `paymentHoldWindowHours` config +
//     uses the same Date math).
//   - Create: stamps `holdExpiresAt` from
//     `computeHoldExpiresAt(hotelConfig.paymentHoldWindowHours, now)`
//     when the booking is `pending`. Null for
//     `payment-uploaded` (the staff-review state —
//     no auto-expiry, per PEX-04).
//   - Walk-in: `holdExpiresAt: null` (the staff is
//     creating the booking, not waiting on a guest
//     action — no auto-expiry, per the PEX-01 spec).
//   - Add-room: inherits the header's
//     `holdExpiresAt` (a pre-arrival reservation
//     has a unified hold per PEX-01). The new
//     child reads `reservation.holdExpiresAt` from
//     the header; it does NOT stamp a fresh value.
//   - Reschedule: the reschedule transaction does
//     NOT write `holdExpiresAt` (Firestore's
//     field-level merge preserves the existing
//     value). The reschedule is a dates / room
//     change — it does not reset the hold clock.
//   - Reject payment + re-upload: stamps a fresh
//     `holdExpiresAt` from `paymentRejectedAt` (per
//     PEX-04). The retained `paymentProofPath` /
//     legacy `paymentProofUrl` are audit evidence
//     only — the `holdExpiresAt` is the only
//     expiry authority.
//   - Hold-expiry cron: uses
//     `isBookingOccupyingRoom` as the
//     authoritative gate (a Firestore coarse
//     filter as a cheap pre-selector). The cron
//     does NOT stamp `holdExpiresAt` — it retires
//     the booking by flipping the status + the
//     CRL-02 audit metadata.
//   - `isBookingOccupyingRoom` is the only reader
//     of `holdExpiresAt` for the room-availability
//     decision (per the JSDoc on `Booking.holdExpiresAt`).
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural test
// (full create → reject → re-upload → expire cron)
// is the emulator follow-up.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const holdExpiryHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/hold-expiry.ts"),
  "utf8"
);
const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);
const bookingOccupancySharedSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingOccupancy.ts"),
  "utf8"
);
const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

describe("MRB-15-06 — `computeHoldExpiresAt` is the single stamping helper (every call site uses the shared helper)", () => {
  it("the helper is exported from `shared/utils/bookingOccupancy.ts`", () => {
    // The shared helper is the canonical
    // stamping site — every handler that stamps
    // a `holdExpiresAt` reads from this single
    // export. A future handler that computes the
    // value locally (e.g. via a one-line
    // `new Date(now.getTime() + 24 * 60 * 60 *
    // 1000)`) would silently drift the math from
    // the rest of the system.
    expect(bookingOccupancySharedSrc).toMatch(
      /export function computeHoldExpiresAt\([\s\S]{0,500}?\): Date \| null/
    );
  });

  it("`handleCreateBooking` stamps `holdExpiresAt` via the shared helper (not a local computation)", () => {
    // The create handler's pending-booking path
    // calls `computeHoldExpiresAt(hotelConfig.paymentHoldWindowHours, now)`
    // — the same `(windowHours, now)` signature
    // every other call site uses. The
    // `payment-uploaded` branch stamps `null`
    // (the staff-review state — no auto-expiry).
    expect(bookingsHandlerSrc).toMatch(
      /holdExpiresAt: \(paymentProofPath \|\| paymentProofUrl\)[\s\S]{0,400}?computeHoldExpiresAt\(hotelConfig\.paymentHoldWindowHours, now\)/
    );
  });

  it("`handleCreateWalkin` stamps `holdExpiresAt: null` (staff-created bookings have no auto-expiry)", () => {
    // The walkin handler stamps `null` because
    // walk-ins are exempt from the guest-side
    // hold window (the staff is creating the
    // booking, not waiting on a guest action).
    // The JSDoc on lines 3572-3578 documents the
    // contract; the actual `holdExpiresAt: null`
    // stamp is at line ~4595 inside the
    // reservation header write block.
    expect(bookingsHandlerSrc).toMatch(
      /Walk-ins are exempt from the guest-side hold window/
    );
    expect(bookingsHandlerSrc).toMatch(
      /Walk-ins have no auto-expiry hold[\s\S]{0,500}?holdExpiresAt: null/
    );
  });

  it("`handleAddRoomToReservation` inherits the header's `holdExpiresAt` (no fresh stamp)", () => {
    // The add-room handler reads the header's
    // `reservation.holdExpiresAt` and stamps the
    // same value on the new child. A fresh
    // `computeHoldExpiresAt(...)` call here would
    // silently restart the hold clock — the new
    // room would get a fresh 24h hold while the
    // sibling rooms would still be on the
    // original clock. The unified-hold contract
    // (PEX-01) is the reason this is an
    // inheritance, not a fresh stamp.
    expect(bookingsHandlerSrc).toMatch(
      /holdExpiresAt: reservation\.holdExpiresAt \?\? null/
    );
  });

  it("`handleRescheduleBooking` does NOT write `holdExpiresAt` (the reschedule preserves the existing value)", () => {
    // The reschedule's `updatedBooking` block
    // (around line 9702+) does NOT include
    // `holdExpiresAt`. Firestore's field-level
    // merge preserves the existing value — the
    // reschedule is a dates / room change, not a
    // hold-clock reset. A future refactor that
    // adds `holdExpiresAt` to the reschedule's
    // update block would silently restart the
    // hold clock on every reschedule (the desk
    // can do that explicitly via "reject payment"
    // if the guest needs more time).
    const updatedBookingBlock = bookingsHandlerSrc.match(
      /updatedBooking = \{[\s\S]{0,3000}?transaction\.update\(bookingRef, updatedBooking\)/
    );
    expect(
      updatedBookingBlock,
      "expected the reschedule's updatedBooking block to be non-empty"
    ).toBeTruthy();
    if (updatedBookingBlock) {
      expect(updatedBookingBlock[0]).not.toMatch(/holdExpiresAt:/);
    }
  });

  it("`handleRejectPayment` stamps a fresh `holdExpiresAt` from the shared helper (re-uploads reset the clock)", () => {
    // The reject-payment handler stamps a fresh
    // `holdExpiresAt` from
    // `computeHoldExpiresAt(hotelConfig.paymentHoldWindowHours, paymentRejectedAt)`.
    // The re-upload resets the hold clock to
    // `paymentHoldWindowHours` from the moment
    // the staff rejected the proof. The
    // `holdExpiresAt` is the only expiry
    // authority — the retained
    // `paymentProofPath` / `paymentProofUrl` are
    // audit evidence only (per the JSDoc on
    // `Booking.holdExpiresAt`).
    expect(bookingsHandlerSrc).toMatch(
      /holdExpiresAt: newDeadline \? Timestamp\.fromDate\(newDeadline\) : null/
    );
    // The `newDeadline` is computed via the
    // shared helper — search for the
    // `computeHoldExpiresAt` call site in the
    // reject handler. The actual signature
    // threads `holdWindowHours` (the resolved
    // config value) + `updatedAt` (the canonical
    // `now` captured at the top of the handler).
    expect(bookingsHandlerSrc).toMatch(
      /const newDeadline = computeHoldExpiresAt\(holdWindowHours, updatedAt\)/
    );
  });
});

describe("MRB-15-06 — `isBookingOccupyingRoom` is the only reader of `holdExpiresAt` for the room-availability decision", () => {
  it("the helper is the authoritative gate (the schema's JSDoc on `Booking.holdExpiresAt` says so)", () => {
    // Per the JSDoc: "The `isBookingOccupyingRoom`
    // helper in `shared/utils/bookingOccupancy.ts`
    // is the only authority that should read this
    // field." A future reader that compares
    // `holdExpiresAt > now` directly would
    // silently drift the math.
    expect(sharedTypesSrc).toMatch(
      /`isBookingOccupyingRoom`[\s\S]{0,200}?is the only authority/
    );
  });

  it("the helper lives in `shared/utils/bookingOccupancy.ts` (the only place `holdExpiresAt` is read for occupancy)", () => {
    // The helper's signature accepts
    // `OccupancyInput` (which carries
    // `holdExpiresAt`). The body reads the
    // field for the `pending` deadline check.
    expect(bookingOccupancySharedSrc).toMatch(
      /export interface OccupancyInput \{[\s\S]{0,200}?holdExpiresAt/
    );
    expect(bookingOccupancySharedSrc).toMatch(
      /export function isBookingOccupyingRoom\([\s\S]{0,2000}?const deadline = booking\.holdExpiresAt/
    );
    // The stamping helper is
    // `computeHoldExpiresAt`.
    expect(bookingOccupancySharedSrc).toMatch(
      /export function computeHoldExpiresAt/
    );
  });
});

describe("MRB-15-06 — `/api/holds/expire` cron retires expired pending holds", () => {
  it("the route is registered as `POST` or `GET /api/holds/expire`", () => {
    // The cron is registered in
    // `guest-app/server/apiRouter.ts` as a
    // Vercel cron target. Vercel sets the
    // `x-cron-secret` header on every invocation
    // (or `Authorization: Bearer <CRON_SECRET>`).
    expect(apiRouterSrc).toMatch(
      /domain === "holds" && action === "expire" && \(req\.method === "POST" \|\| req\.method === "GET"\)/
    );
  });

  it("the cron handler gates on the `x-cron-secret` header (or `Authorization: Bearer <CRON_SECRET>`)", () => {
    // Per the JSDoc on
    // `handleHoldExpiryCron`: "the request must
    // carry a `x-cron-secret` header (or
    // `Authorization: Bearer <CRON_SECRET>`)
    // matching the server's `CRON_SECRET` env
    // var. Vercel sets that header on every cron
    // invocation." A missing / wrong secret
    // returns 401.
    expect(holdExpiryHandlerSrc).toMatch(
      /function isAuthorizedCronRequest\(req: VercelRequest\): boolean \{[\s\S]{0,800}?return false;/
    );
    // The handler invokes the auth check and
    // returns 401 on a failed check. The actual
    // shape is:
    //   if (!isAuthorizedCronRequest(req)) {
    //     return res
    //       .status(401)
    //       .json({...})
    //   }
    expect(holdExpiryHandlerSrc).toMatch(
      /if \(!isAuthorizedCronRequest\(req\)\) \{[\s\S]{0,500}?\.status\(401\)/
    );
  });

  it("the cron uses `isBookingOccupyingRoom` as the authoritative gate (the Firestore coarse filter is a cheap pre-selector)", () => {
    // Per the JSDoc on `handleHoldExpiryCron`:
    // "the per-doc eligibility recheck inside the
    // transaction (the `isBookingOccupyingRoom` +
    // `now` test) is the authoritative gate; the
    // coarse filter is a cheap pre-selector." A
    // future refactor that drops the per-doc
    // recheck would race a concurrent payment
    // upload (the booking might have moved out
    // of `pending` between the coarse query and
    // the per-doc transaction).
    expect(holdExpiryHandlerSrc).toMatch(
      /isBookingOccupyingRoom\(\{[\s\S]{0,500}?holdExpiresAt: freshData\.holdExpiresAt/
    );
  });

  it("the cron stamps `cancelledBy: \"system\"` + `cancellationSource: \"system\"` (per CRL-02)", () => {
    // The cron-driven retirement is a
    // server-initiated cancellation, so the
    // audit metadata is `cancelledBy: "system"`
    // + `cancellationSource: "system"`. The
    // canonical `EXPIRED_HOLD_CANCELLATION_REASON`
    // is preserved as the reason. Reports +
    // emails can switch on either field; the
    // `cancellationSource` is the new
    // discriminator (per CRL-02 / decision #159).
    expect(holdExpiryHandlerSrc).toMatch(
      /cancelledBy: SYSTEM_CANCELLATION_SOURCE,/
    );
    expect(holdExpiryHandlerSrc).toMatch(
      /cancellationSource: SYSTEM_CANCELLATION_SOURCE,/
    );
    expect(holdExpiryHandlerSrc).toMatch(
      /EXPIRED_HOLD_CANCELLATION_REASON/
    );
  });

  it("the cron's coarse filter excludes legacy bookings (no `holdExpiresAt` field)", () => {
    // Per the JSDoc: "Legacy bookings (no
    // `holdExpiresAt` field at all) are NOT
    // matched by the Firestore query — they
    // occupy indefinitely per
    // `isBookingOccupyingRoom`'s 'null deadline
    // = occupies' rule." The Firestore query
    // requires the field to exist (`.where(
    // "holdExpiresAt", "<", ...)`) so legacy
    // bookings are naturally excluded from the
    // coarse filter. The per-doc recheck in the
    // transaction would also skip them (the
    // helper returns `true` for null deadline
    // pending bookings).
    expect(holdExpiryHandlerSrc).toMatch(
      /\.where\("holdExpiresAt", "<", Timestamp\.fromDate\(now\)\)/
    );
  });
});

describe("MRB-15-06 — The schema's `Booking.holdExpiresAt` + `Reservation.holdExpiresAt` are the canonical types", () => {
  it("the schema declares `Reservation.holdExpiresAt: Date | null` (the unified hold for the whole reservation)", () => {
    expect(sharedTypesSrc).toMatch(
      /holdExpiresAt: Date \| null;/
    );
    // The JSDoc on `Reservation.holdExpiresAt`
    // documents the unified hold contract (per
    // PEX-01 + MRB-08: no separate per-child
    // timer for multi-room reservations).
    expect(sharedTypesSrc).toMatch(
      /Per PEX-01[\s\S]{0,300}?unified hold window for the whole reservation/
    );
  });

  it("the schema declares `Booking.holdExpiresAt?: Date | null` (the per-child mirror)", () => {
    // The per-child mirror is the same value
    // the header carries (inherited at create
    // time, preserved on reschedule). The
    // JSDoc says `isBookingOccupyingRoom` is
    // the only authority that should read it.
    expect(sharedTypesSrc).toMatch(
      /holdExpiresAt\?: Date \| null;/
    );
  });
});
