// Per FOL-03 (2026-08-07, per decision #199):
// `handleCheckinBooking` + `handleCheckoutBooking` in
// `guest-app/server/handlers/bookings.ts` have a Firestore
// `runTransaction` ordering bug. The pre-FOL-03 handlers did
// the childrenForCount `get()` AFTER the booking + room
// updates — a Firestore transaction violation that surfaces
// in production as a 500 from
// `/api/bookings/checkin` (and `/api/bookings/checkout`)
// for any booking with a `reservationId`. The SDK throws
// "Firestore transactions require all reads to be executed
// before all writes" before the `transaction.update(reservationRef, ...)`
// call ever runs, so the reservation header's
// `checkedInRoomCount` / `paymentStatus` / `checkedOutRoomCount`
// mirror is never written either.
//
// The pre-FOL-03 root cause: the MRB-15-03 work (2026-08-03)
// added the children-recompute inside the same transaction,
// but placed the `get()` after the writes. The comment
// explicitly noted "the just-checked-in booking is now
// `status: 'checked-in'`" — i.e. the read was supposed to
// observe the post-update state. The cleanest fix is to
// read the children BEFORE the writes, then REPLACE the
// current booking's status with the post-update value in
// the resulting `postUpdateChildStatuses` array before
// computing the count + the aggregate.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural round-trip
// (a check-in / check-out call with a `reservationId` no
// longer throws) is covered by the existing
// `bookings-checkout.test.ts` + `bookings-checkout-archive.test.ts`;
// the source-text guards below pin the ordering contract at
// the source level so a future "I'll just add this read
// after the writes" refactor breaks the test instead of
// silently regressing.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlersSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Slice each handler's FULL function body (from the
// `export async function` opener to the next
// `export async function` closer) so the ordering
// assertions target the right scope. The slices are
// generous (the whole function) so any future re-shape
// keeps the test targeting just the relevant handler.
const handleCheckinStart = handlersSrc.indexOf(
  "export async function handleCheckinBooking"
);
const handleCheckinEnd = handlersSrc.indexOf(
  "export async function handleCheckoutBooking"
);
const handleCheckinBody =
  handleCheckinStart >= 0 && handleCheckinEnd > handleCheckinStart
    ? handlersSrc.slice(handleCheckinStart, handleCheckinEnd)
    : "";

const handleCheckoutStart = handlersSrc.indexOf(
  "export async function handleCheckoutBooking"
);
const handleCheckoutEnd = handlersSrc.indexOf(
  "export async function handleLookupBooking",
  handleCheckoutStart
);
const handleCheckoutBody =
  handleCheckoutStart >= 0 && handleCheckoutEnd > handleCheckoutStart
    ? handlersSrc.slice(handleCheckoutStart, handleCheckoutEnd)
    : "";

describe("FOL-03 — `runTransaction` reads-before-writes contract in check-in + check-out", () => {
  describe("`handleCheckinBooking` — reads before writes", () => {
    it("the function body is locatable", () => {
      // Sanity: the slice exists. If a future refactor
      // re-shapes the function (e.g. extracts it to a
      // helper), the regex matchers below still pass on
      // the broader `handleCheckinBooking` symbol so
      // this guard is a one-line tripwire.
      expect(handleCheckinBody.length).toBeGreaterThan(0);
      expect(handleCheckinBody).toMatch(/export\s+async\s+function\s+handleCheckinBooking/);
    });

    it("the `childrenForCount` `get()` happens BEFORE the booking `transaction.update()` call", () => {
      // The contract: the SDK requires all reads to
      // complete before all writes inside a
      // `runTransaction`. The pre-FOL-03 handler did
      // the children `get()` after the booking + room
      // updates — a transaction violation. The
      // post-FOL-03 handler pre-reads the children and
      // uses the resulting `postUpdateChildStatuses`
      // array in the count + aggregate computation.
      //
      // The pattern: in the function body, the
      // childrenForCount read must come BEFORE the
      // first `transaction.update(bookingRef` call. We
      // use `indexOf` on the function body to pin the
      // ordering. The test is unambiguous: the read
      // pattern is the `get(adminDb.collection("bookings").where("reservationId", "==", bookingReservationId))`
      // call, and the write pattern is the first
      // `transaction.update(bookingRef` call.
      const childrenReadIdx = handleCheckinBody.indexOf(
        'adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)'
      );
      const firstUpdateIdx = handleCheckinBody.indexOf("transaction.update(bookingRef");
      expect(childrenReadIdx).toBeGreaterThan(0);
      expect(firstUpdateIdx).toBeGreaterThan(0);
      expect(childrenReadIdx).toBeLessThan(firstUpdateIdx);
    });

    it("the children statuses are pre-computed with the post-update value for the current booking", () => {
      // The post-FOL-03 pattern: the pre-read children
      // statuses are mapped through a ternary that
      // replaces the current booking's status with the
      // post-update value (`"checked-in"`). The
      // `postUpdateChildStatuses` array is what every
      // child's status WILL be after the writes commit,
      // so the count + aggregate are correct for the
      // post-update state.
      expect(handleCheckinBody).toMatch(
        /postUpdateChildStatuses\s*=\s*childrenForCount\.docs\.map\(\(d:\s*any\)\s*=>\s*d\.id\s*===\s*bookingId\s*\?\s*["']checked-in["']/
      );
    });

    it("the `transaction.update(reservationRef, ...)` uses `postUpdateChildStatuses` (not the raw pre-update read)", () => {
      // The contract: the reservation header's count
      // + aggregate are derived from the
      // `postUpdateChildStatuses` array (the
      // pre-update read + the just-checked-in
      // booking's status replaced with
      // `"checked-in"`). The pre-FOL-03 handler used
      // the raw pre-update read's `childStatuses`,
      // which didn't include the just-checked-in
      // booking in the count.
      expect(handleCheckinBody).toMatch(
        /postUpdateChildStatuses\.filter\(\(s\)\s*=>\s*s\s*===\s*["']checked-in["']\)\.length/
      );
      expect(handleCheckinBody).toMatch(
        /computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });
  });

  describe("`handleCheckoutBooking` — reads before writes", () => {
    it("the function body is locatable", () => {
      // Sanity: the slice exists.
      expect(handleCheckoutBody.length).toBeGreaterThan(0);
      expect(handleCheckoutBody).toMatch(/export\s+async\s+function\s+handleCheckoutBooking/);
    });

    it("the `childrenForCount` `get()` happens BEFORE the booking `transaction.update()` call", () => {
      // Same contract as the check-in handler. The
      // children `get()` must precede the first
      // `transaction.update(bookingRef` call in the
      // `handleCheckoutBooking` body.
      const childrenReadIdx = handleCheckoutBody.indexOf(
        'adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)'
      );
      const firstUpdateIdx = handleCheckoutBody.indexOf("transaction.update(bookingRef");
      expect(childrenReadIdx).toBeGreaterThan(0);
      expect(firstUpdateIdx).toBeGreaterThan(0);
      expect(childrenReadIdx).toBeLessThan(firstUpdateIdx);
    });

    it("the children statuses are pre-computed with the post-update value for the current booking", () => {
      // Same shape as the check-in handler. The
      // post-update value is `"checked-out"` (the
      // just-checked-out booking's new status).
      expect(handleCheckoutBody).toMatch(
        /postUpdateChildStatuses\s*=\s*childrenForCount\.docs\.map\(\(d:\s*any\)\s*=>\s*d\.id\s*===\s*bookingId\s*\?\s*["']checked-out["']/
      );
    });

    it("the `transaction.update(reservationRef, ...)` uses `postUpdateChildStatuses` for both counts + the aggregate", () => {
      // Same contract as the check-in handler — the
      // counts and the aggregate use
      // `postUpdateChildStatuses`. The check-out
      // handler computes BOTH the
      // `newCheckedInCount` (decrement) and the
      // `newCheckedOutCount` (increment) from the
      // post-update array.
      expect(handleCheckoutBody).toMatch(
        /postUpdateChildStatuses\.filter\(\(s\)\s*=>\s*s\s*===\s*["']checked-in["']\)\.length/
      );
      expect(handleCheckoutBody).toMatch(
        /postUpdateChildStatuses\.filter\(\(s\)\s*=>\s*s\s*===\s*["']checked-out["']\)\.length/
      );
      expect(handleCheckoutBody).toMatch(
        /computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });
  });

  describe("regression — the pre-FOL-03 read-after-write pattern is gone from both handlers", () => {
    it("the pre-FOL-03 `childrenForCount` + immediate `childStatuses` read pattern is gone", () => {
      // The pre-FOL-03 pattern looked like this (in
      // both handlers, AFTER the booking + room
      // updates):
      //
      //   if (bookingReservationId.length > 0) {
      //     const reservationRef = ...;
      //     const childrenForCount = await transaction.get(
      //       adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)
      //     );
      //     const childStatuses = childrenForCount.docs.map((d) => ...);
      //     const newCheckedInCount = childStatuses.filter(...).length;
      //     transaction.update(reservationRef, { checkedInRoomCount: ..., ... });
      //   }
      //
      // The post-FOL-03 pattern pre-computes
      // `postUpdateChildStatuses` BEFORE any writes
      // and uses it after the writes. The
      // `childStatuses` (without the `post` prefix)
      // variable is the pre-FOL-03 name — the absence
      // of the bare `childStatuses` read pattern
      // after the writes is the tripwire.
      //
      // Specifically: the pre-FOL-03 pattern placed
      // the `childrenForCount` + `childStatuses` read
      // INSIDE the `if (bookingReservationId.length > 0) { ... }`
      // block that runs AFTER the writes. The
      // post-FOL-03 pattern has the read OUTSIDE the
      // block (i.e., at the top of the transaction
      // body). The negative assertion: the
      // `transaction.get(adminDb.collection("bookings").where("reservationId", "==", bookingReservationId))`
      // call should NOT appear AFTER any
      // `transaction.update(bookingRef` call within
      // the same handler. We assert the read happens
      // BEFORE the first write for both handlers.
      const handlers = [
        { name: "checkin", slice: handleCheckinBody },
        { name: "checkout", slice: handleCheckoutBody }
      ];
      for (const { name, slice } of handlers) {
        const childrenReadIdx = slice.indexOf(
          'adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)'
        );
        const firstUpdateIdx = slice.indexOf("transaction.update(bookingRef");
        expect(
          childrenReadIdx,
          `${name} handler: childrenForCount read must come BEFORE the first transaction.update(bookingRef) call`
        ).toBeLessThan(firstUpdateIdx);
      }
    });
  });
});
