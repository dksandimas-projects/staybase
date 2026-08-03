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
    // The recompute lives inside the same
    // `runTransaction` as the child update so it
    // reads the post-write child state. The helper
    // `computeReservationActualDateRange` is the
    // contract.
    expect(bookingsSrc).toMatch(
      /adminDb\s*\n\s*\.collection\("bookings"\)\s*\n\s*\.where\("reservationId", "==", bookingReservationId as string\)/
    );
    expect(bookingsSrc).toMatch(
      /const rescheduleActualDateRange = computeReservationActualDateRange\(\s*\n\s*existingReservationData\.checkIn,[\s\S]*?rescheduleChildrenDates\s*\n\s*\)/
    );
    // The recomputed range is written to the header
    // in the same `transaction.update(reservationDocRef, ...)`
    // call.
    expect(bookingsSrc).toMatch(/actualDateRange: rescheduleActualDateRange/);
  });

  it("handleRescheduleBooking represents the just-rescheduled child with its NEW dates in the recompute", () => {
    // The recompute overrides the just-rescheduled
    // child's dates with the post-write `checkInDate`
    // / `checkOutDate` (the new values the client
    // submitted). Every other child contributes its
    // current dates as-is.
    expect(bookingsSrc).toMatch(
      /if \(docSnap\.id === String\(bookingId\)\) \{\s*\n\s*\/\/ The just-rescheduled child — use the\s*\n\s*\/\/ new dates from `updatedBooking`[\s\S]*?return \{\s*\n\s*checkIn: checkInDate,\s*\n\s*checkOut: checkOutDate\s*\n\s*\};/
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
