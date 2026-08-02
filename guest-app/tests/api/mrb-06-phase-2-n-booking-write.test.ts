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

    it("first room uses the client's preallocated bookingId; subsequent rooms auto-mint", () => {
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
        /const bookingIdForThisRoom = bookingIdx === 0\s*\n\s*\? bookingId\s*\n\s*: adminDb\.collection\("bookings"\)\.doc\(\)\.id;/
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
        /roomId: assignedRoomForBooking\.id,\s*\n\s*roomNumber: String\(assignedRoomForBooking\.data\.roomNumber \|\| ""\),\s*\n\s*reservationPosition: bookingIdx \+ 1,\s*\n\s*reservationRoomCount: assignedRooms\.length,/
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
    it("multiplies the single-room totalPrice by assignedRooms.length for the header's group total", () => {
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
        /totalPrice: totalPrice \* assignedRooms\.length,/
      );
    });

    it("multiplies the single-room originalSubtotal by assignedRooms.length for the header's group total", () => {
      // Same pattern as `totalPrice`. The header
      // carries the aggregate pre-discount
      // subtotal across the N rooms.
      expect(handlers).toMatch(
        /originalSubtotal: totalPrice \* assignedRooms\.length,\s*\/\/ MRB-04: the proper originalSubtotal computation/
      );
    });

    it("multiplies the single-room subtotal by assignedRooms.length for the header's group total", () => {
      // Same pattern as `totalPrice` +
      // `originalSubtotal`. The header's
      // post-discount `subtotal` aggregates
      // across the N rooms.
      expect(handlers).toMatch(
        /subtotal: totalPrice \* assignedRooms\.length,\s*\/\/ MRB-04: the proper subtotal after add-on math/
      );
    });
  });

  describe("EXB-10 inventory check — N>1 total extra beds", () => {
    it("counts totalExtraBeds as extraBedCount * assignedRooms.length (not the single per-room count)", () => {
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
        /const totalExtraBeds = extraBedCount \* assignedRooms\.length;/
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
        /rooms: \(typeof bookingWriteRefs === "undefined" \? \[\] : bookingWriteRefs\)\.map\(\(w, idx\) => \{/
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
        /return \{\s*\n\s*bookingId: w\.ref\.id,\s*\n\s*roomId: r\.id,\s*\n\s*roomNumber: String\(r\.data\.roomNumber \|\| ""\),\s*\n\s*reservationPosition: idx \+ 1\s*\n\s*\};/
      );
    });
  });
});
