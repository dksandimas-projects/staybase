import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const schemas = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);

// Slice the reschedule handler body out of the file so
// the guards below are scoped to `handleRescheduleBooking`
// — the create + walkin handlers have their own MRB-02.x
// tests, and the reschedule guards must not pick up their
// pattern by mistake.
function extractRescheduleHandler(): string {
  const start = handlers.indexOf("export async function handleRescheduleBooking");
  expect(start).toBeGreaterThanOrEqual(0);
  // The reschedule handler is the last export in the
  // file — `slice(start)` returns the handler body to
  // EOF.
  return handlers.slice(start);
}
const reschedule = extractRescheduleHandler();

describe("MRB-02.x reschedule — reservation header update", () => {
  describe("RescheduleBookingSchema — accepts optional reservationId", () => {
    it("imports RESERVATION_ID_REGEX from the shared references module (already present from prior imports)", () => {
      // The schema file already imports RESERVATION_ID_REGEX
      // for the WalkinBookingSchema (MRB-02.x walk-in). The
      // same import satisfies the reschedule schema's regex
      // validation. No new import is required.
      expect(schemas).toMatch(
        /import \{ RESERVATION_ID_REGEX \} from "\.\.\/utils\/references"/
      );
    });

    it("declares RescheduleBookingSchema as a strict Zod object with the reschedule body fields", () => {
      // The schema accepts `bookingId` + `roomId` +
      // `checkIn` + `checkOut` (all required) + an
      // optional `reason` (capped at 500 chars) + an
      // optional `reservationId` (UUIDv4, regex-validated).
      // `strict()` so a client can't add unexpected
      // fields (same posture as the create + walkin
      // schemas).
      expect(schemas).toMatch(
        /export const RescheduleBookingSchema = z\.object\(\{/
      );
      expect(schemas).toMatch(
        /bookingId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(64\),/
      );
      expect(schemas).toMatch(
        /roomId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(64\),/
      );
      expect(schemas).toMatch(/checkIn: z\.string\(\)\.regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\),/);
      expect(schemas).toMatch(/checkOut: z\.string\(\)\.regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\),/);
      expect(schemas).toMatch(
        /reason: z\.string\(\)\.trim\(\)\.max\(500\)\.optional\(\)\.default\(""\),/
      );
      expect(schemas).toMatch(
        /reservationId: z\.string\(\)\.trim\(\)\.regex\(RESERVATION_ID_REGEX\)\.optional\(\)/
      );
      expect(schemas).toMatch(/\}\)\.strict\(\);/);
    });
  });

  describe("Reservation header read — booking's existing reservationId is the canonical anchor", () => {
    it("imports RescheduleBookingSchema from @spark-inn/shared", () => {
      // The handler replaces the previous inline
      // `req.body || {}` parsing with a strict-Zod
      // parse so a future caller that adds unexpected
      // fields is rejected at the schema boundary.
      // The import is in the file-level @spark-inn/shared
      // import block at the top of `bookings.ts`.
      expect(handlers).toMatch(
        /WalkinBookingSchema,\s*\n\s*RescheduleBookingSchema,/
      );
    });

    it("uses RescheduleBookingSchema.safeParse to validate the body", () => {
      // Same posture as the create + walkin handlers.
      // A malformed body returns 400 with a generic
      // "required" error.
      expect(reschedule).toMatch(
        /const parsedReschedule = RescheduleBookingSchema\.safeParse\(req\.body \|\| \{\}\);/
      );
    });

    it("derives bookingReservationId from the existing booking's reservationId field (not from the body)", () => {
      // The reschedule re-uses the existing booking's
      // `reservationId` because the reschedule is a
      // modification of the same reservation group, not
      // a new reservation. The body's `reservationId`
      // is honored only when the booking's stored value
      // is null (a defensive migration path for a
      // future bulk reschedule tool).
      //
      // The hoist fix: `bookingReservationId` is
      // declared with `let` in the outer `try` scope
      // (alongside `existingReservationData`) so the
      // post-commit response payload can echo both the
      // `reservationId` and the header's `reservationRef`
      // — keeping the declaration inside the transaction
      // left them out of scope at the success branch
      // and surfaced as `bookingReservationId is not
      // defined` 400s. The IIFE is unchanged; only the
      // surrounding declaration moved.
      expect(reschedule).toMatch(
        /let bookingReservationId: string \| null = null;[\s\S]*?bookingReservationId = \(\(\) => \{/
      );
      expect(reschedule).toMatch(/String\(\(booking as any\)\.reservationId \|\| ""\)\.trim\(\)/);
    });
  });

  describe("Idempotency matrix — half-stamped state guard", () => {
    it("reads the reservation header early (before pricing math) so the 500 fires on inconsistent state", () => {
      // When the booking has a `reservationId` but
      // the header is missing, the state is
      // unrecoverable by the request — staff must
      // investigate. The 500 fires BEFORE the pricing
      // recompute so we don't waste work on a booking
      // that can't be saved.
      const reservationReadIdx = reschedule.search(
        /const existingReservationSnap = await transaction\.get\(reservationDocRef\)/
      );
      const pricingRecalcIdx = reschedule.search(
        /const manualNightlyRate = getLockedManualNightlyRate/
      );
      expect(reservationReadIdx).toBeGreaterThanOrEqual(0);
      expect(pricingRecalcIdx).toBeGreaterThan(reservationReadIdx);
    });

    it("throws RESERVATION_HEADER_WITHOUT_CHILD when the booking has a reservationId but the header is missing", () => {
      // The half-stamped state guard. The throw fires
      // when the booking carries a `reservationId` +
      // the `reservations/{id}` doc doesn't exist.
      // Legacy null-`reservationId` bookings skip the
      // header read entirely (no `reservationDocRef`
      // is built), so the legacy path is preserved.
      expect(reschedule).toMatch(
        /throw new Error\("RESERVATION_HEADER_WITHOUT_CHILD"\);/
      );
    });
  });

  describe("Error mapping — catch block maps the half-stamped state to 500", () => {
    it("RESERVATION_HEADER_WITHOUT_CHILD maps to 500 (not 400)", () => {
      // The reschedule catch block previously mapped
      // every error to 400 (because the staff can fix
      // validation / occupancy / pricing errors by
      // adjusting the input). The half-stamped state
      // is unrecoverable by the request, so the 500
      // signals staff to investigate rather than
      // retry.
      expect(reschedule).toMatch(
        /if \(error\?\.message === "RESERVATION_HEADER_WITHOUT_CHILD"\) \{\s*return res\.status\(500\)/
      );
    });

    it("preserves the pre-existing 400 catch-all for every other error", () => {
      // The pre-existing reschedule catch maps every
      // non-half-stamped error to 400. The MRB-02.x
      // port adds the 500 mapping for the
      // half-stamped state but keeps the 400 fallback
      // for validation / occupancy / pricing errors
      // (those are still recoverable by adjusting the
      // input).
      expect(reschedule).toMatch(
        /return res\.status\(400\)\.json\(\{ success: false, error: error\.message \|\| "Failed to move booking\." \}\);/
      );
    });
  });

  describe("Header update — fingerprint + totals + dates", () => {
    it("writes the reservation header update in the SAME transaction as the booking update", () => {
      // The header update is part of the same
      // `runTransaction` as the booking update. A
      // partial failure cannot leave the booking
      // with new dates while the header keeps the old
      // dates (which would silently break the
      // reservation-level totals + the room-occupancy
      // + the unified PEX hold).
      const headerUpdateIdx = reschedule.search(
        /transaction\.update\(reservationDocRef, \{/
      );
      const bookingUpdateIdx = reschedule.search(
        /transaction\.update\(bookingRef, updatedBooking\);/
      );
      expect(headerUpdateIdx).toBeGreaterThanOrEqual(0);
      expect(bookingUpdateIdx).toBeGreaterThanOrEqual(0);
      // The header update runs inside the same
      // transaction (between the booking read and the
      // `});` that closes the runTransaction
      // callback) — same scope.
      const runTxnCloseIdx = reschedule.indexOf(
        "    });\n\n    // Send email to guest"
      );
      expect(headerUpdateIdx).toBeLessThan(runTxnCloseIdx);
      expect(bookingUpdateIdx).toBeLessThan(runTxnCloseIdx);
    });

    it("updates the totals + fingerprint + actualDateRange (NOT the dates or the source / corporate / member context)", () => {
      // The reschedule re-uses the existing booking's
      // source / corporate / member context — only
      // the dates + room + rate change. The header's
      // `source` / `isCorporate` / `corporateCode` /
      // `companyName` / `voucherCode` /
      // `memberDiscountPct` / `discountScopeSnapshot`
      // are NOT in the update (the existing values
      // are preserved — the reschedule doesn't change
      // the lead booker's source, the corporate code,
      // or the voucher).
      //
      // Per MRB-14 (2026-08-03, per decision #180):
      // the header's `checkIn` / `checkOut` /
      // `numNights` are the ORIGINAL shared-dates
      // snapshot from create time and are now
      // IMMUTABLE. A reschedule of one child no longer
      // mutates the header's "shared" range — every
      // other surface (email subject, receipt PDF,
      // dashboard date filter, checkin reminder
      // cron) reads the header's original dates, not
      // the rescheduled child's new dates. The
      // child's new dates are its own
      // `bookings/{id}.checkIn` / `checkOut` /
      // `numNights`. The header's `actualDateRange`
      // (denormalized) tracks the per-child spread +
      // an `isDivergent` flag for the UI + email
      // surface to switch between "one shared range"
      // and "per-child dates" without re-fetching
      // the children.
      const headerUpdateBlock = reschedule.match(
        /transaction\.update\(reservationDocRef, \{[\s\S]+?\}\);/
      );
      expect(headerUpdateBlock).toBeTruthy();
      const body = headerUpdateBlock![0];
      // The forbidden keys must NOT appear inside the
      // update object. Pre-MRB-14 the reschedule did
      // `checkIn: Timestamp.fromDate(checkInDate)`,
      // `checkOut: Timestamp.fromDate(checkOutDate)`,
      // `numNights` — the bug MRB-14 fixes.
      expect(body).not.toMatch(/\bcheckIn: Timestamp\.fromDate/);
      expect(body).not.toMatch(/\bcheckOut: Timestamp\.fromDate/);
      expect(body).not.toMatch(/\bnumNights:/);
      // The MRB-14 contract: the header's totals
      // + the per-stream aggregate + the rescheduled
      // fingerprint + the recomputed `actualDateRange`
      // are the new update keys.
      expect(body).toMatch(/totalPrice: finalTotalPrice/);
      expect(body).toMatch(/subtotal: originalTotalPrice/);
      expect(body).toMatch(/originalSubtotal: originalTotalPrice/);
      expect(body).toMatch(/aggregateRevenueAllocation: updatedBooking\.revenueAllocation/);
      expect(body).toMatch(/requestFingerprint: rescheduleFingerprint/);
      expect(body).toMatch(/actualDateRange: rescheduleActualDateRange/);
      expect(body).toMatch(/updatedAt: now/);
      // Negative: source / corporate / member context
      // are NOT updated (reschedule doesn't change them).
      expect(body).not.toMatch(/source:\s*"online"/);
      expect(body).not.toMatch(/isCorporate:/);
    });

    it("computes a fresh rescheduleFingerprint from the new dates + the new room's type + the existing booking's context", () => {
      // The reschedule fingerprint is INTENTIONALLY
      // different from the original create's
      // fingerprint — the reschedule IS the legitimate
      // change to the fingerprint. The new fingerprint
      // uses: the new checkIn + checkOut, the new
      // room's `type` (post room read), the existing
      // booking's source / corporate / member context
      // (preserved across the reschedule), the
      // existing booking's `numAdults` /
      // `numChildren` / `extraBedCount` (the
      // reschedule doesn't change occupancy), and the
      // existing reservation header's `termsVersion`
      // + `privacyVersion` (read from
      // `existingReservationData`, not from settings —
      // a reschedule shouldn't re-read the policy
      // version, since the booking was created under
      // the original version).
      expect(reschedule).toMatch(
        /const rescheduleFingerprint = computeRequestFingerprint\(\{/
      );
      expect(reschedule).toMatch(/type: String\(room\.type \|\| ""\)\.trim\(\)/);
      expect(reschedule).toMatch(/leadGuestName: String\(booking\.guestName \|\| ""\)\.trim\(\)/);
      expect(reschedule).toMatch(/termsVersion: String\(existingReservationData\.termsVersion \|\| DEFAULT_TERMS_VERSION\)/);
    });
  });

  describe("Success response — echoes reservationId + reservationRef", () => {
    it("echoes reservationId + reservationRef in the success payload (empty for legacy null-reservationId bookings)", () => {
      // The reschedule success payload mirrors the
      // updated booking + the reservation linkage.
      // For legacy null-`reservationId` bookings the
      // `reservationId` + `reservationRef` are empty
      // strings (the booking has no header to echo).
      // For new MRB-02.x bookings the `reservationId`
      // is the existing booking's id (preserved across
      // the reschedule) + the `reservationRef` is the
      // header's `reservationRef`.
      expect(reschedule).toMatch(
        /reservationId: bookingReservationId \|\| "",/
      );
      expect(reschedule).toMatch(
        /reservationRef: String\(\(existingReservationData as any\)\?\.reservationRef \|\| ""\)/
      );
    });
  });
});
