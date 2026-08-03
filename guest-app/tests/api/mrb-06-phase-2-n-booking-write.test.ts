import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

describe("MRB-06 Phase 2 — N booking write loop + group totals + N>1 response", () => {
  describe("N booking write loop — each assigned room gets its own bookings/{id} doc", () => {
    it("iterates assignedRooms.length times to build per-room booking write refs", () => {
      // For N=1 (the default) the loop runs once
      // with `bookingIdx = 0`, byte-equivalent to
      // the pre-MRB-06 single write to
      // `bookingDocRef = newBooking`. For N>1 the
      // loop builds N `bookingWriteRefs` entries
      // — one per assigned room — and writes them
      // in the same transaction.
      expect(handlers).toMatch(
        /for \(let bookingIdx = 0; bookingIdx < assignedRooms\.length; bookingIdx\+\+\)/
      );
    });

    it("uses the booking id preallocated for each normalized room selection", () => {
      // The first room's `bookingId` is the client's
      // preallocated id (the historical contract).
      // The other N-1 rooms auto-mint via the
      // `adminDb.collection(\"bookings\").doc().id`
      // pattern (same shape as the walk-in path's
      // `generateReservationId` auto-mint, but for
      // booking ids — a follow-up can switch the
      // client to preallocating N ids once the N>1
      // client surface lands).
      expect(handlers).toMatch(
        /const bookingIdForThisRoom = assignedRoomForBooking\.selection\.bookingId;/
      );
    });

    it("writes each booking ref via transaction.set (one per assigned room)", () => {
      // The per-room booking writes happen in the
      // same `runTransaction` as the reservation
      // header write. A partial failure cannot
      // leave the reservation header without its
      // N child booking docs (or vice versa). The
      // `bookingWriteRefs` array is the canonical
      // N-write source.
      expect(handlers).toMatch(
        /for \(const \{ ref: writeRef, data: writeData \} of bookingWriteRefs\) \{\s*\n\s*transaction\.set\(writeRef, writeData\);/
      );
    });

    it("stamps per-room roomId + roomNumber + reservationPosition (1..N) + reservationRoomCount on each booking doc", () => {
      // The per-room fields that vary per iteration.
      // `roomId` + `roomNumber` are the assigned
      // room's data; `reservationPosition` is the
      // 1-indexed position in the assigned-rooms
      // list; `reservationRoomCount` is the total
      // N (same for every booking doc — the room
      // count is a reservation-level aggregate).
      expect(handlers).toMatch(
        /roomId: assignedRoomForBooking\.id,\s*\n\s*roomNumber: String\(assignedRoomForBooking\.data\.roomNumber \|\| ""\),[\s\S]*?reservationPosition: bookingIdx \+ 1,\s*\n\s*reservationRoomCount: assignedRooms\.length,/
      );
    });

    it("generates a per-booking lookupToken (each booking doc has its own magic link)", () => {
      // The pre-MRB-02 code generated a single
      // token per booking; for N>1 each booking
      // doc gets its own token (so each magic
      // link works independently). A future
      // MRB-04 follow-up can refactor to a
      // per-reservation token (one magic link
      // for the whole group, resolving to the
      // reservation header first).
      expect(handlers).toMatch(
        /lookupToken: generateLookupToken\(\)/
      );
    });
  });

  describe("Group totals on the reservation header — N>1 aggregation", () => {
    it("writes the already-aggregated reservation totalPrice", () => {
      // The header's `totalPrice` is the sum of
      // the N per-room totals. The per-type math
      // is the same for every room of the same
      // `roomType` + same dates + same guest
      // inputs, so the sum is
      // `roomCount * per-room value`. For N=1
      // (the default) `assignedRooms.length` is 1,
      // byte-equivalent to the pre-MRB-06
      // single-room value.
      expect(handlers).toMatch(
        /subtotal,\s*\n\s*totalPrice,/
      );
    });

    it("writes the aggregated pre-discount subtotal", () => {
      // Same pattern as `totalPrice`. The header
      // carries the aggregate pre-discount
      // subtotal across the N rooms.
      expect(handlers).toMatch(
        /originalSubtotal: subtotal,/
      );
    });

    it("writes the aggregated subtotal once", () => {
      // Same pattern as `totalPrice` +
      // `originalSubtotal`. The header's
      // post-discount `subtotal` aggregates
      // across the N rooms.
      expect(handlers).toMatch(
        /discountScopeSnapshot: snapshottedDiscountScope,\s*\n\s*subtotal,\s*\n\s*totalPrice,/
      );
    });
  });

  describe("EXB-10 inventory check — N>1 total extra beds", () => {
    it("sums the explicit extra-bed count across room stays", () => {
      // The per-room `extraBedCount` is the count
      // per room; for N=1 (the default) the total
      // `extraBedCount * 1` is byte-equivalent to
      // pre-MRB-06. For N>1 the reservation uses
      // `extraBedCount * assignedRooms.length`
      // extra beds in total (e.g. N=2 rooms with
      // extraBedCount=1 per room = 2 extra beds).
      // The inventory check must count the total
      // to avoid silently under-counting the
      // reservation's footprint.
      expect(handlers).toMatch(
        /const totalExtraBeds = validatedRoomStays\.reduce\(\s*\n\s*\(sum, stay\) => sum \+ stay\.extraBedCount,\s*\n\s*0\s*\n\s*\);/
      );
    });

    it("passes totalExtraBeds to checkExtraBedInventory (not the per-room extraBedCount)", () => {
      // The inventory helper takes the total
      // (not the per-room count) as the
      // "requested count" arg.
      expect(handlers).toMatch(
        /checkExtraBedInventory\(\s*\n\s*Math\.max\(0, Number\(hotelConfig\.extraBedInventory\) \|\| 0\),\s*\n\s*extraBedInUse,\s*\n\s*totalExtraBeds\s*\n\s*\)/
      );
    });
  });

  describe("N>1 response shape — echoes all N assigned rooms", () => {
    it("emits a `rooms` array in the success payload with N entries (one per assigned room)", () => {
      // The first room's id + number are echoed
      // in the legacy fields (`roomId` +
      // `roomNumber`) for backward compat with
      // the N=1 confirmation page. The `rooms`
      // array carries ALL N assignments (id +
      // number + position per room) so the N>1
      // confirmation can render the full group
      // view. For N=1 (the default) `rooms` is a
      // single-element array — byte-equivalent to
      // the pre-MRB-06 single fields.
      expect(handlers).toMatch(
        /rooms: finalRooms,/
      );
    });

    it("each `rooms` entry carries bookingId + roomId + roomNumber + reservationPosition", () => {
      // The N>1 confirmation page renders the
      // group view from this array. Each entry
      // is the canonical per-room data the
      // confirmation needs: the booking id
      // (auto-minted for rooms 2..N; client-
      // preallocated for room 1), the assigned
      // room's id + number, and the 1-indexed
      // position in the assigned-rooms list.
      expect(handlers).toMatch(
        /bookingId: write\.ref\.id,\s*\n\s*roomId: assigned\.id,\s*\n\s*roomNumber: String\(assigned\.data\.roomNumber \|\| ""\),\s*\n\s*roomType: assigned\.selection\.roomType,\s*\n\s*reservationPosition: index \+ 1,/
      );
    });
  });
});
