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

describe("MRB-06 N>1 generalization — Phase 1 (schema + auto-assignment + header)", () => {
  describe("createBookingSchema — accepts roomCount", () => {
    it("declares roomCount as an optional integer (default 1, max 50)", () => {
      // The N>1 field. Default 1 (the historical
      // single-room case — byte-equivalent to
      // pre-MRB-06 for callers that don't supply the
      // field). Bounded at 50 to match the existing
      // `guests` upper bound.
      expect(handlers).toMatch(
        /roomCount: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)\.optional\(\)\.default\(1\)/
      );
    });
  });

  describe("Fingerprint — uses roomCount as roomLines[0].quantity", () => {
    it("echoes the request roomCount in the fingerprint's roomLines[0].quantity", () => {
      // The fingerprint is N-aware — a retry with
      // a different `roomCount` is a different
      // request (409 conflict), a retry with the
      // same `roomCount` is the same request
      // (replay). The fingerprint's
      // `roomLines[0].quantity` is the N value.
      // For N=1 (the default) this is byte-equivalent
      // to the pre-MRB-06 `quantity: 1`.
      expect(handlers).toMatch(
        /quantity: Math\.max\(1, Math\.floor\(Number\(roomCount\) \|\| 1\)\)/
      );
    });
  });

  describe("Auto-assignment — picks N distinct rooms (same-room-twice guard)", () => {
    it("iterates the candidates loop Math.max(1, floor(roomCount)) times", () => {
      // The outer loop iterates `roomCount` times
      // to assign N distinct rooms of the requested
      // `roomType`. For N=1 (the default) the outer
      // loop runs once, byte-equivalent to the
      // pre-MRB-06 behavior. The inner loop walks
      // the candidates in `roomNumber` order and
      // picks the first non-conflicting one.
      expect(handlers).toMatch(
        /for \(let outerIdx = 0; outerIdx < Math\.max\(1, Math\.floor\(Number\(roomCount\) \|\| 1\)\); outerIdx\+\+\)/
      );
    });

    it("skips already-assigned rooms in the same reservation (same-room-twice guard)", () => {
      // The same-room-twice guard is implicit in
      // the iteration order — once a candidate is
      // assigned, it's pushed to `assignedRoomIds`
      // and the next iteration skips it (the same
      // room can't be picked twice in the same
      // reservation). The guard is the
      // `assignedRoomIds.includes(candidate.id)` check
      // at the top of the inner loop.
      expect(handlers).toMatch(
        /if \(assignedRoomIds\.includes\(candidate\.id\)\) \{\s*continue;\s*\/\/ same-room-twice guard/
      );
    });

    it("throws 'Room no longer available' when the inner loop can't find a non-conflicting room", () => {
      // If the inner loop runs out of
      // non-conflicting candidates before
      // `roomCount` is satisfied, the entire
      // transaction aborts — no partial write.
      expect(handlers).toMatch(
        /if \(!foundThisRound\) \{\s*throw new Error\(sawLingeringCheckedInConflict \? ROOM_NOT_READY_PREVIOUS_GUEST_ERROR : "Room no longer available"\);/
      );
    });
  });

  describe("Header — roomCount reflects the N assignments", () => {
    it("stamps reservationRoomCount as assignedRooms.length (not the hardcoded 1)", () => {
      // The header's `reservationRoomCount` is
      // the total number of rooms in the
      // reservation — `assignedRooms.length` for
      // the N>1 case. Pre-MRB-06 this was
      // hardcoded to 1 (the single-room default);
      // post-MRB-06 it's the N value.
      expect(handlers).toMatch(
        /reservationPosition: 1,\s*\n\s*reservationRoomCount: assignedRooms\.length/
      );
    });
  });

  describe("Per-room fields are sourced from the FIRST assigned room (backward compat for the success response)", () => {
    it("exposes the FIRST assigned room as roomId + roomData for the response payload", () => {
      // For N=1 (the default) this is byte-equivalent
      // to the pre-MRB-06 `roomId` + `roomData`. For
      // N>1 the success response echoes the FIRST
      // room's id + number (the historical shape);
      // MRB-09 + the admin booking drawer follow-up
      // render the group view from the reservation
      // header (which has `roomCount` +
      // `reservationRoomCount`).
      expect(handlers).toMatch(
        /const roomId = assignedRooms\[0\]\.id;\s*\n\s*const roomData = assignedRooms\[0\]\.data;\s*\n\s*assignedRoomId = roomId;\s*\n\s*assignedRoomNumber = String\(roomData\.roomNumber \|\| ""\);/
      );
    });
  });
});
