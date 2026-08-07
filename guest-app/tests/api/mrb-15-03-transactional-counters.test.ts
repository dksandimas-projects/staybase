// Per MRB-15-03 (2026-08-03): every reservation-header
// counter write site must be inside a `runTransaction`
// that reads the source of truth (the children via
// `where("reservationId", "==", id)`) BEFORE writing.
// Per FOL-03 (2026-08-07, decision #199): the children
// read happens BEFORE the writes in the same
// `runTransaction` (Firestore requires all reads to
// complete before all writes inside a transaction). The
// pre-FOL-03 handler did the read AFTER the writes — a
// transaction violation. The post-FOL-03 pattern reads
// the children first, then REPLACES the current
// booking's status with the post-update value
// (`"checked-in"` / `"checked-out"`) in the resulting
// `postUpdateChildStatuses` array before computing the
// count + the aggregate.
// The counter is "denormalized for fast UI; recomputed
// transactionally in MRB-04 / MRB-13" per the JSDoc
// on `Reservation` in `shared/types/index.ts` — so the
// counter ownership is:
//
//   - `roomCount`             → create + add-room
//   - `activeRoomCount`       → create + add-room + cancel
//   - `cancelledRoomCount`    → cancel (only)
//   - `checkedInRoomCount`    → check-in + check-out
//   - `checkedOutRoomCount`   → check-out (only)
//
// A counter that's initialized at create time but
// never updated on the corresponding status transition
// is a latent bug — the counter silently drifts to 0
// (or to whatever the create-time value was). The
// pre-MRB-15-03 `handleCheckinBooking` + `handleCheckoutBooking`
// handlers initialized `checkedInRoomCount: 0` /
// `checkedOutRoomCount: 0` at create time but never
// recomputed on the status transition — the counters
// were silently stuck at 0 forever. This file pins the
// new read path at the source level so a future
// refactor cannot silently revert to the buggy pattern.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural test
// (full create → check-in → check-out → read header
// counters) is the emulator follow-up.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Slice the source by handler function. The next
// `^export async function` (or `^const ` for the
// in-file shared schemas) marks the end of the
// current handler. The slice keeps the test
// resilient to other rewrites elsewhere in the file.
function sliceHandler(name: string): string {
  const start = bookingsHandlerSrc.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const after = bookingsHandlerSrc.slice(start);
  const nextExport = after.slice(1).search(/^export (async )?function/m);
  return nextExport > 0 ? after.slice(0, nextExport + 1) : after;
}

const checkinHandlerSrc = sliceHandler("handleCheckinBooking");
const checkoutHandlerSrc = sliceHandler("handleCheckoutBooking");
const createHandlerSrc = sliceHandler("handleCreateBooking");
const walkinHandlerSrc = sliceHandler("handleCreateWalkin");
const addRoomHandlerSrc = sliceHandler("handleAddRoomToReservation");
const cancelHandlerSrc = sliceHandler("handleCancelBooking");

describe("MRB-15-03 — Check-in handler recomputes `checkedInRoomCount` from children in the same transaction", () => {
  it("the check-in transaction reads children via `where(\"reservationId\", \"==\", bookingReservationId)`", () => {
    // The check-in handler must read the children
    // INSIDE the same runTransaction so the
    // post-write state of the just-checked-in
    // booking is included in the count. A pre-read
    // (or no read at all) would silently miss the
    // current booking's status flip.
    expect(
      checkinHandlerSrc,
      "expected handleCheckinBooking slice to be non-empty"
    ).toBeTruthy();
    expect(checkinHandlerSrc).toMatch(
      /where\("reservationId", "==", bookingReservationId\)/
    );
  });

  it("the check-in transaction writes `checkedInRoomCount` to the reservation header", () => {
    // The count is computed from the children's
    // post-update statuses (filter for `status === "checked-in"`)
    // and written in the same `transaction.update`
    // as the existing `paymentStatus` mirror. Per
    // FOL-03, the count reads from the
    // `postUpdateChildStatuses` array (the
    // pre-update read + the just-checked-in
    // booking's status replaced with `"checked-in"`),
    // not the raw pre-update read.
    expect(checkinHandlerSrc).toMatch(
      /checkedInRoomCount: newCheckedInCount/
    );
    expect(checkinHandlerSrc).toMatch(
      /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });

  it("the check-in counter write is inside `runTransaction` (the read + write are atomic)", () => {
    // The recompute lives inside the same
    // runTransaction that flips the booking to
    // "checked-in" — the read + write are atomic.
    expect(checkinHandlerSrc).toMatch(
      /adminDb\.runTransaction\([\s\S]*?checkedInRoomCount: newCheckedInCount[\s\S]*?\}\);/
    );
  });
});

describe("MRB-15-03 — Check-out handler recomputes `checkedInRoomCount` (decrement) + `checkedOutRoomCount` (increment) from children", () => {
  it("the check-out transaction reads children via `where(\"reservationId\", \"==\", bookingReservationId)`", () => {
    // Same pattern as check-in: the read is inside
    // the runTransaction so the just-checked-out
    // booking is included in the counts.
    expect(
      checkoutHandlerSrc,
      "expected handleCheckoutBooking slice to be non-empty"
    ).toBeTruthy();
    expect(checkoutHandlerSrc).toMatch(
      /where\("reservationId", "==", bookingReservationId\)/
    );
  });

  it("the check-out transaction writes BOTH `checkedInRoomCount` and `checkedOutRoomCount` to the reservation header", () => {
    // Both counters must be recomputed in the same
    // transaction. Writing only `checkedOutRoomCount`
    // (and leaving `checkedInRoomCount` at its
    // pre-checkout value) would make the two
    // counters inconsistent for the N>1 case.
    expect(checkoutHandlerSrc).toMatch(
      /checkedInRoomCount: newCheckedInCount,\s*\n\s*checkedOutRoomCount: newCheckedOutCount/
    );
    expect(checkoutHandlerSrc).toMatch(
      /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });
});

describe("MRB-15-03 — Counter ownership contract: the check-in + check-out handlers do NOT touch `activeRoomCount` / `cancelledRoomCount` / `roomCount`", () => {
  it("the check-in handler's transaction.update payload does not include `activeRoomCount` / `cancelledRoomCount` / `roomCount`", () => {
    // Counter ownership:
    //   - `roomCount`             → create + add-room
    //   - `activeRoomCount`       → create + add-room + cancel
    //   - `cancelledRoomCount`    → cancel (only)
    //   - `checkedInRoomCount`    → check-in + check-out
    //   - `checkedOutRoomCount`   → check-out (only)
    //
    // The check-in handler's only allowed header
    // write (in addition to `paymentStatus` + `updatedAt`)
    // is `checkedInRoomCount`. Slice the post-transaction
    // `update` payload and assert the counter set.
    const checkinUpdate = checkinHandlerSrc.match(
      /checkedInRoomCount: newCheckedInCount,[\s\S]{0,200}?\}\);/
    );
    expect(checkinUpdate, "expected the check-in transaction.update payload").toBeTruthy();
    if (checkinUpdate) {
      expect(checkinUpdate[0]).not.toMatch(/activeRoomCount:/);
      expect(checkinUpdate[0]).not.toMatch(/cancelledRoomCount:/);
      expect(checkinUpdate[0]).not.toMatch(/roomCount:/);
    }
  });

  it("the check-out handler's transaction.update payload does not include `activeRoomCount` / `cancelledRoomCount` / `roomCount`", () => {
    // Same ownership contract for the check-out
    // handler. The only allowed header write (in
    // addition to `paymentStatus` + `updatedAt`) is
    // the `checkedInRoomCount` decrement +
    // `checkedOutRoomCount` increment.
    const checkoutUpdate = checkoutHandlerSrc.match(
      /checkedInRoomCount: newCheckedInCount,[\s\S]{0,200}?\}\);/
    );
    expect(checkoutUpdate, "expected the check-out transaction.update payload").toBeTruthy();
    if (checkoutUpdate) {
      expect(checkoutUpdate[0]).not.toMatch(/activeRoomCount:/);
      expect(checkoutUpdate[0]).not.toMatch(/cancelledRoomCount:/);
      expect(checkoutUpdate[0]).not.toMatch(/roomCount:/);
    }
  });
});

describe("MRB-15-03 — N=1 + legacy null-reservationId byte-equivalence: legacy bookings still skip the header mirror", () => {
  it("the check-in handler's header write is gated on `bookingReservationId.length > 0`", () => {
    // Legacy pre-MRB-01 bookings (no `reservationId`)
    // skip the header write entirely — byte-equivalent
    // to pre-MRB-15-03 behavior. The gate is the
    // existing `bookingReservationId.length > 0` check
    // (introduced by MRB-05).
    expect(checkinHandlerSrc).toMatch(
      /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,800}?transaction\.update\(reservationRef/
    );
  });

  it("the check-out handler's header write is gated on `bookingReservationId.length > 0`", () => {
    // Same byte-equivalence gate for check-out.
    expect(checkoutHandlerSrc).toMatch(
      /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,1000}?transaction\.update\(reservationRef/
    );
  });
});

describe("MRB-15-03 — Create + add-room + walkin initialize the check-in / check-out counters to the right values", () => {
  it("the create handler initializes `checkedInRoomCount: 0` and `checkedOutRoomCount: 0` for every new reservation", () => {
    // Every new reservation starts with zero
    // checked-in + zero checked-out rooms. The
    // check-in + check-out transactions are the
    // only paths that increment either counter
    // after create time.
    expect(createHandlerSrc).toMatch(
      /roomCount: assignedRooms\.length,[\s\S]{0,500}?checkedInRoomCount: 0,\s*\n\s*checkedOutRoomCount: 0/
    );
  });

  it("the walkin handler initializes `checkedInRoomCount: 0` and `checkedOutRoomCount: 0` for every new walkin reservation", () => {
    // Walkin shares the same create-time
    // initialization. A walkin that arrives
    // already in "checked-in" status (rare but
    // possible — e.g. a guest at the front desk
    // who paid + was assigned a room in one
    // step) gets a special case: the initial
    // counter is N (not 0).
    expect(walkinHandlerSrc).toMatch(
      /roomCount: walkinRoomCount,[\s\S]{0,500}?checkedInRoomCount: status === "checked-in" \? walkinRoomCount : 0,\s*\n\s*checkedOutRoomCount: 0/
    );
  });

  it("the add-room handler does NOT touch `checkedInRoomCount` / `checkedOutRoomCount` (adding a room doesn't change the check-in state)", () => {
    // The add-room handler updates `roomCount` +
    // `activeRoomCount` + `subtotal` + `totalPrice`
    // + `aggregateRevenueAllocation` +
    // `actualDateRange`. The check-in / check-out
    // counters are NOT touched because the new
    // room inherits the pre-arrival state.
    const addRoomUpdate = addRoomHandlerSrc.match(
      /updatedHeader = \{[\s\S]{0,500}?actualDateRange: newActualDateRange,\s*\n\s*updatedAt: new Date\(\)/
    );
    expect(addRoomUpdate, "expected the add-room updatedHeader payload").toBeTruthy();
    if (addRoomUpdate) {
      expect(addRoomUpdate[0]).not.toMatch(/checkedInRoomCount:/);
      expect(addRoomUpdate[0]).not.toMatch(/checkedOutRoomCount:/);
    }
  });
});

describe("MRB-15-03 — Cancel handler is the SOLE owner of `cancelledRoomCount`", () => {
  it("the cancel handler's `reservationHeaderUpdate` writes `cancelledRoomCount` from the cancelled-children count", () => {
    // The cancel path increments `cancelledRoomCount`
    // by the count of children that were just
    // cancelled (NOT by `children.length` — a
    // partial cancel only bumps the counter for
    // the children we actually flipped). The
    // check-in / check-out paths do NOT touch
    // `cancelledRoomCount`.
    const cancelUpdate = cancelHandlerSrc.match(
      /const reservationHeaderUpdate: Record<string, any> = \{[\s\S]{0,500}?cancelledRoomCount: newCancelledRoomCount,[\s\S]{0,500}?activeRoomCount: newActiveRoomCount/
    );
    expect(
      cancelUpdate,
      "expected the cancel handler to write cancelledRoomCount: newCancelledRoomCount + activeRoomCount: newActiveRoomCount in the same transaction"
    ).toBeTruthy();
  });
});
