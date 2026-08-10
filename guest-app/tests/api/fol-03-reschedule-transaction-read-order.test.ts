// Per FOL-03 (2026-08-07, per decision #199) +
// FOL-03 audit follow-up (2026-08-10): the reschedule
// handler in `guest-app/server/handlers/bookings.ts`
// (`handleRescheduleBooking`) had the same Firestore
// `runTransaction` ordering bug as the original
// `handleCheckinBooking` + `handleCheckoutBooking`. The
// pre-fix handler did the `rescheduleChildrenSnap` `get()`
// for the `actualDateRange` recompute AFTER the booking +
// room `transaction.update()` calls — a transaction
// violation that surfaced in production as a 400 from
// `POST /api/bookings/reschedule` for any booking with a
// `reservationId` (multi-room reservations, post-MRB-01).
// The SDK threw the canonical error
// "Firestore transactions require all reads to be
// executed before all writes" before the
// `transaction.update(reservationDocRef, ...)` call ever
// ran, so the header's `actualDateRange` recompute was
// never written either.
//
// The pre-fix root cause: the MRB-14 work (2026-08-03)
// added the children-recompute inside the same
// transaction but placed the `get()` after the writes.
// The comment explicitly noted "the just-rescheduled
// child is now `status: 'checked-in'`" — i.e. the read
// was supposed to observe the post-update state. The
// fix pre-reads the children at the top of the
// transaction (right after the reservation header read),
// then REPLACES the just-rescheduled child's entry in
// the resulting `rescheduleChildrenDates` array with
// the NEW dates from the in-memory `checkInDate` /
// `checkOutDate`. The post-update state is constructed
// in JavaScript, not observed via a re-read.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural round-trip
// (a reschedule call with a `reservationId` no longer
// throws) is covered by the existing
// `mrb-14-reschedule-preserves-header.test.ts`; the
// source-text guards below pin the ordering contract
// at the source level so a future "I'll just add this
// read after the writes" refactor breaks the test
// instead of silently regressing.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlersSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Slice the reschedule handler's FULL function body
// (from the `export async function handleRescheduleBooking`
// opener to the next `export async function` closer) so
// the ordering assertions target the right scope.
const handleRescheduleStart = handlersSrc.indexOf(
  "export async function handleRescheduleBooking"
);
const handleRescheduleEnd = handlersSrc.indexOf(
  "export async function handleAddRoomToReservation",
  handleRescheduleStart
);
const handleRescheduleBody =
  handleRescheduleStart >= 0 && handleRescheduleEnd > handleRescheduleStart
    ? handlersSrc.slice(handleRescheduleStart, handleRescheduleEnd)
    : "";

describe("FOL-03 — `runTransaction` reads-before-writes contract in `handleRescheduleBooking`", () => {
  it("the function body is locatable", () => {
    expect(handleRescheduleBody.length).toBeGreaterThan(0);
    expect(handleRescheduleBody).toMatch(/export\s+async\s+function\s+handleRescheduleBooking/);
  });

  it("the children `get()` for `actualDateRange` happens BEFORE the booking `transaction.update()` call", () => {
    // The contract: the SDK requires all reads to
    // complete before all writes inside a
    // `runTransaction`. The pre-fix handler did the
    // children `get()` after the booking + room
    // updates — a transaction violation. The fix
    // pre-reads the children at the top of the
    // transaction (right after the reservation header
    // read) and substitutes the just-rescheduled
    // child's NEW dates in JavaScript.
    //
    // The pattern: in the function body, the
    // `rescheduleChildrenSnap` read must come BEFORE
    // the first `transaction.update(bookingRef` call.
    // We use `indexOf` on the function body to pin the
    // ordering contract at the source level.
    const childrenReadMatch = handleRescheduleBody.match(
      /rescheduleChildrenSnap\s*=\s*await\s+transaction\.get\(rescheduleChildrenQuery\)/
    );
    expect(childrenReadMatch, "expected the children `get()` to exist").toBeTruthy();
    const bookingWriteMatch = handleRescheduleBody.match(
      /transaction\.update\(\s*bookingRef\s*,/
    );
    expect(bookingWriteMatch, "expected the booking `transaction.update()` to exist").toBeTruthy();
    const childrenReadIndex = handleRescheduleBody.indexOf(childrenReadMatch![0]);
    const bookingWriteIndex = handleRescheduleBody.indexOf(bookingWriteMatch![0]);
    expect(
      childrenReadIndex,
      "the children `get()` must come BEFORE the booking `transaction.update()` (FOL-03 contract)"
    ).toBeLessThan(bookingWriteIndex);
  });

  it("the `rescheduleChildrenSnap` `get()` is NOT inside the post-write `actualDateRange` block", () => {
    // The pre-fix pattern: the children read lived
    // INSIDE the `if (reservationDocRef && existingReservationData)`
    // block, AFTER the booking + room
    // `transaction.update()` calls. The fix moves
    // the read to the TOP of the transaction (right
    // after the reservation header read) so the
    // late `actualDateRange` block is pure compute
    // + writes — no reads.
    //
    // We assert the read is BEFORE the booking write
    // (the previous test) + the read is NOT inside
    // any post-write block. The simpler regex-based
    // check: the source should not have a
    // `rescheduleChildrenSnap = await transaction.get`
    // line anywhere after the first
    // `transaction.update(bookingRef` call.
    const childrenReadMatch = handleRescheduleBody.match(
      /rescheduleChildrenSnap\s*=\s*await\s+transaction\.get\(rescheduleChildrenQuery\)/
    );
    expect(childrenReadMatch).toBeTruthy();
    const bookingWriteMatch = handleRescheduleBody.match(
      /transaction\.update\(\s*bookingRef\s*,/
    );
    expect(bookingWriteMatch).toBeTruthy();
    const childrenReadIndex = handleRescheduleBody.indexOf(childrenReadMatch![0]);
    const bookingWriteIndex = handleRescheduleBody.indexOf(bookingWriteMatch![0]);
    // The children read must be BEFORE the booking write.
    // (The function body has exactly one such read by design.)
    expect(childrenReadIndex).toBeLessThan(bookingWriteIndex);
    // And the read should not reappear after the write.
    const secondOccurrence = handleRescheduleBody.indexOf(
      childrenReadMatch![0],
      childrenReadIndex + 1
    );
    expect(
      secondOccurrence,
      "the children `get()` must appear exactly once, before the booking write"
    ).toBe(-1);
  });

  it("the pre-read array substitutes the just-rescheduled child's NEW dates in JavaScript", () => {
    // The fix's invariant: the `rescheduleChildrenDates`
    // array (built from the pre-read) substitutes
    // `checkInDate` / `checkOutDate` (the NEW dates
    // from the in-memory function scope) for the
    // just-rescheduled child. The pre-fix code
    // tried to observe the post-update state via a
    // re-read; the post-fix code constructs it in
    // JavaScript.
    const mapMatch = handleRescheduleBody.match(
      /rescheduleChildrenDates\s*=\s*rescheduleChildrenSnap\.docs\.map\(\(docSnap\)[\s\S]*?\}\);/
    );
    expect(mapMatch, "expected the pre-read `.map()`").toBeTruthy();
    // The `.map()` should detect the just-rescheduled
    // child by id and return the NEW dates.
    expect(mapMatch![0]).toMatch(
      /if\s*\(\s*docSnap\.id\s*===\s*String\(bookingId\)\s*\)\s*\{[\s\S]*?checkIn:\s*checkInDate,\s*checkOut:\s*checkOutDate/
    );
  });

  it("the late `actualDateRange` block does NOT call `transaction.get`", () => {
    // The pre-fix pattern: the `actualDateRange`
    // block did `rescheduleChildrenSnap = await
    // transaction.get(rescheduleChildrenQuery)`
    // after the booking + room writes. The fix
    // removes that late read; the late block is
    // pure compute (uses the pre-built
    // `rescheduleChildrenDates` array from the
    // top of the transaction).
    //
    // We check the late `actualDateRange` block
    // (the call to `computeReservationActualDateRange`)
    // does NOT contain any `transaction.get` call.
    const lateBlockMatch = handleRescheduleBody.match(
      /computeReservationActualDateRange\([\s\S]*?\}\);/
    );
    expect(lateBlockMatch, "expected the `actualDateRange` block").toBeTruthy();
    // The block must NOT contain a `transaction.get(...)` call.
    expect(lateBlockMatch![0]).not.toMatch(/transaction\.get\(/);
  });
});
