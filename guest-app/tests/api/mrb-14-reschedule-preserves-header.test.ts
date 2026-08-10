// Per MRB-14 (2026-08-03, per decision #180 — proposed):
// source-text guards for the reschedule refactor +
// the `actualDateRange` recompute. The pre-MRB-14
// `handleRescheduleBooking` did
// `transaction.update(reservationDocRef, { checkIn,
// checkOut, numNights, ... })` which silently mutated
// the header's "shared" range to the rescheduled
// child's new dates — every other surface (email
// subject, receipt PDF, dashboard date filter,
// checkin reminder cron) inherited the wrong range.
// MRB-14 freezes the header's dates as the ORIGINAL
// shared snapshot from create time + recomputes the
// new `actualDateRange` field from every child. These
// tests pin both contracts at the source level so a
// future refactor cannot revert without breaking the
// guard.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);

describe("MRB-14 — reschedule refactor preserves the header's shared dates", () => {
  it("handleRescheduleBooking no longer updates the header's `checkIn` / `checkOut` / `numNights`", () => {
    // Slice the reschedule transaction's
    // `transaction.update(reservationDocRef, { ... })`
    // call. The header-update object must NOT contain
    // `checkIn` / `checkOut` / `numNights` keys —
    // those fields are now immutable shared-dates
    // snapshots from create time.
    const updateSlice = bookingsSrc.match(
      /transaction\.update\(reservationDocRef, \{[\s\S]*?requestFingerprint: rescheduleFingerprint,[\s\S]*?actualDateRange: rescheduleActualDateRange,[\s\S]*?updatedAt: now\s*\}\);/
    );
    expect(updateSlice, "expected the reschedule header-update object").toBeTruthy();
    if (!updateSlice) return;
    // The forbidden keys must not appear inside the
    // update object. The pre-MRB-14 pattern was:
    //   transaction.update(reservationDocRef, {
    //     checkIn: Timestamp.fromDate(checkInDate),
    //     checkOut: Timestamp.fromDate(checkOutDate),
    //     numNights,
    //     ...
    //   });
    expect(updateSlice[0]).not.toMatch(/\bcheckIn:\s*Timestamp\.fromDate/);
    expect(updateSlice[0]).not.toMatch(/\bcheckOut:\s*Timestamp\.fromDate/);
    expect(updateSlice[0]).not.toMatch(/\bnumNights:/);
  });

  it("handleRescheduleBooking recomputes `actualDateRange` from every child via `where(\"reservationId\", \"==\", ...)` inside the transaction", () => {
    // The recompute reads every child via the
    // `where("reservationId", "==", id)` query and
    // passes the per-child dates to
    // `computeReservationActualDateRange`. The read
    // is gated on `reservationDocRef && existingReservationData`
    // (only reservation-scope reschedules need the
    // recompute — legacy null-`reservationId` bookings
    // stay on the per-child path).
    //
    // Per the FOL-03 audit follow-up (2026-08-10):
    // the read happens at the TOP of the transaction
    // (right after the reservation header read), not
    // in the late `actualDateRange` block. The
    // `fol-03-reschedule-transaction-read-order.test.ts`
    // suite pins the FOL-03 ordering contract; this
    // test pins the MRB-14 `actualDateRange` contract
    // (the read is still present, the values it
    // returns still flow into the recompute).
    expect(bookingsSrc).toMatch(
      /adminDb\s*\n\s*\.collection\("bookings"\)\s*\n\s*\.where\("reservationId", "==", bookingReservationId as string\)/
    );
    expect(bookingsSrc).toMatch(
      /const rescheduleActualDateRange = computeReservationActualDateRange\(\s*\n\s*existingReservationData\.checkIn,[\s\S]*?rescheduleChildrenDates \|\| \[\][\s\S]*?\)/
    );
    // The recomputed range is written to the header
    // in the same `transaction.update(reservationDocRef, ...)`
    // call.
    expect(bookingsSrc).toMatch(/actualDateRange: rescheduleActualDateRange/);
  });

  it("handleRescheduleBooking represents the just-rescheduled child with its NEW dates in the recompute", () => {
    // The recompute overrides the just-rescheduled
    // child's dates with the NEW `checkInDate` /
    // `checkOutDate` (the values the client submitted).
    // Every other child contributes its current dates
    // as-is. The substitution happens in the
    // pre-read `.map()` at the TOP of the transaction
    // (per FOL-03 audit follow-up, 2026-08-10) — the
    // just-rescheduled child cannot be re-read after
    // the write, so the post-update state is
    // constructed in JavaScript from the in-memory
    // function scope.
    expect(bookingsSrc).toMatch(
      /if \(docSnap\.id === String\(bookingId\)\) \{[\s\S]*?return \{[\s\S]*?checkIn: checkInDate,[\s\S]*?checkOut: checkOutDate[\s\S]*?\};/
    );
  });
});

describe("MRB-14 — create paths initialise `actualDateRange: { ..., isDivergent: false }`", () => {
  it("handleCreateBooking initialises the field at create time", () => {
    // At create time every child shares the header's
    // dates, so `isDivergent: false` is the contract.
    // The field is written as a literal (not via the
    // helper — the helper is for the post-write
    // recompute where the children may have diverged).
    const newReservation = bookingsSrc.match(
      /const newReservation = \{[\s\S]*?requestFingerprint: reservationRequestFingerprint,[\s\S]*?actualDateRange: \{\s*earliestCheckIn: checkInDate,\s*latestCheckOut: checkOutDate,\s*isDivergent: false\s*\},[\s\S]*?createdBy: "guest"\s*\};/
    );
    expect(newReservation, "handleCreateBooking must initialise `actualDateRange`").toBeTruthy();
  });

  it("handleCreateWalkin initialises the field at create time", () => {
    // Same contract as handleCreateBooking — the
    // walkin path creates N children with the same
    // dates in one transaction.
    const newReservation = bookingsSrc.match(
      /const newReservation = \{[\s\S]*?requestFingerprint: buildWalkinFingerprint\(guestName\),[\s\S]*?actualDateRange: \{\s*earliestCheckIn: checkInDate,\s*latestCheckOut: checkOutDate,\s*isDivergent: false\s*\},[\s\S]*?createdBy: "staff"\s*\};/
    );
    expect(newReservation, "handleCreateWalkin must initialise `actualDateRange`").toBeTruthy();
  });
});
