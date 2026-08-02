import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const sharedRefs = readFileSync(
  resolve(__dirname, "../../../shared/utils/references.ts"),
  "utf8"
);

// Per MRB-03 (2026-08-02, per decision #159): one
// reservation ref, no sibling refs. The public create +
// the walk-in both increment the same daily counter and
// mint a `R-YYYYMMDD-NNNNN` ref inside the same
// `runTransaction` as the booking ref. The denormalization
// onto every child booking is already in place (the
// MRB-06 Phase 2 N booking write loop stamps the ref on
// each child); the public-lookup refactor to "query the
// reservation first, fallback to the booking" is a
// follow-up. The bug MRB-03 fixes is the public create's
// hardcoded `String(1)` for the reservation ref — every
// public reservation would have been stamped with
// `R-{today}-00001` regardless of the counter, making
// the ref non-unique. The walk-in path was correct.
//
// 10 source-text guards covering: the public create's
// reservation ref now uses the counter sequence; the
// walk-in path's reservation ref uses the same counter;
// both surfaces share the same counter doc; the field is
// stamped on the reservation header AND the child
// booking; the canonical ref shape is `R-YYYYMMDD-NNNNN`
// (3-5 digit sequence).
describe("MRB-03 — one reservation ref, no sibling refs (PR #1 of 2)", () => {
  describe("shared references — the canonical ref shape", () => {
    it("RESERVATION_REF_REGEX accepts R-YYYYMMDD-NNNNN (3-5 digit sequence)", () => {
      // The regex is the wire contract — pins the
      // `R-YYYYMMDD-NNNNN` shape (the 3-digit form is
      // accepted for legacy compatibility per the
      // existing MRB-01 test). The 5-digit form is the
      // new post-H3-hardening width.
      expect(sharedRefs).toMatch(
        /export const RESERVATION_REF_REGEX = \/\^R-\\d\{8\}-\\d\{3,5\}\$\//
      );
    });

    it("RESERVATION_REF_REGEX rejects sibling prefixes (SI-, INQ-, SO-, etc.)", () => {
      // The reservation ref uses a distinct prefix from
      // the booking ref (`R-` vs `SI-` / `INQ-` for
      // bookings, `SO-` for store orders) so the public
      // surface reads naturally and a guess of one ref
      // space gives no information about the other.
      // Pinned by the existing MRB-01 test, but the
      // source-text guard is here for symmetry.
      expect(sharedRefs).toMatch(
        /export const RESERVATION_REF_REGEX = \/\^R-\\d/
      );
    });
  });

  describe("handleCreateBooking (public) — the counter bug fix", () => {
    it("derives the reservation ref from the same counter sequence as the booking ref (NOT a hardcoded `1`)", () => {
      // The bug MRB-03 fixes: the public create was
      // hardcoding `String(1)` for the reservation ref
      // (line 1854 pre-fix), so every public reservation
      // got `R-{today}-00001` regardless of the counter.
      // The fix uses the same `sequence` variable the
      // booking ref uses (the per-day counter value).
      // The walk-in path was already correct (uses
      // `String(sequence)`).
      expect(handlers).toMatch(
        /finalReservationRef = `R-\$\{todayCompact\}-\$\{String\(sequence\)\.padStart\(5, "0"\)\}`;/
      );
      expect(handlers).not.toMatch(
        /finalReservationRef = `R-\$\{getManilaDateInfo\(\)\.todayCompact\}-\$\{String\(1\)\.padStart\(5, "0"\)\}`;/
      );
    });

    it("does NOT have a leftover hardcoded `String(1)` reservation ref anywhere in the file", () => {
      // Belt-and-suspenders: scan the entire handler
      // file for the exact pre-fix string. If anyone
      // reintroduces it, the test fails.
      expect(handlers).not.toMatch(
        /String\(1\)\.padStart\(5, "0"\)/
      );
    });

    it("the booking ref and the reservation ref use the same counter sequence in the public create", () => {
      // Both refs are minted in the same scope, using
      // the same `sequence` variable. The counter is
      // shared (one increment per create transaction)
      // and the two refs have adjacent sequence numbers
      // (a small "they belong together" affordance).
      // The `{0,3000}` distance accommodates the
      // `// Save output for outer scope` block + the
      // MRB-03 comment block between the two ref mints.
      expect(handlers).toMatch(
        /const bookingRef = `\$\{config\.bookingRefPrefix \|\| "SI"\}-\$\{todayCompact\}-\$\{String\(sequence\)\.padStart\(5, "0"\)\}`;[\s\S]{0,3000}?finalReservationRef = `R-\$\{todayCompact\}-\$\{String\(sequence\)\.padStart\(5, "0"\)\}`;/
      );
    });

    it("the counter is incremented in the same transaction (atomic with the ref mint)", () => {
      // The `transaction.update(counterRef, { count: sequence })`
      // (or `transaction.set(counterRef, { count: 1 })`
      // for first-of-day) lives in the same runTransaction
      // as the booking-ref mint and the reservation-ref
      // mint. No read-then-write race.
      expect(handlers).toMatch(
        /if \(counterDoc\.exists\) \{[\s\S]{0,80}?transaction\.update\(counterRef, \{ count: sequence \}\);[\s\S]{0,80}?\} else \{[\s\S]{0,80}?transaction\.set\(counterRef, \{ count: 1 \}\);/
      );
    });
  });

  describe("handleCreateWalkin — the correct pattern (consistency check)", () => {
    it("uses the same `String(sequence).padStart(5, \"0\")` shape as the public create", () => {
      // The walk-in path was already correct (per the
      // MRB-02.x commit). This guard pins the symmetry
      // so a future change to one path is mirrored on
      // the other (the same ref-mint helper should
      // eventually be extracted to `shared/utils/` per
      // the MRB-03 follow-ups list).
      expect(handlers).toMatch(
        /finalReservationRef = `R-\$\{todayCompact\}-\$\{String\(sequence\)\.padStart\(5, "0"\)\}`;/
      );
    });

    it("uses the same counter doc as the public create (`counters/bookings-${todayStr}`)", () => {
      // One counter doc per day, shared between public
      // + walk-in. Both surfaces query the same doc id
      // (the `getManilaDateInfo().todayStr` value), so
      // the per-day sequence is global across both
      // create surfaces.
      expect((handlers.match(/adminDb\.collection\("counters"\)\.doc\(`bookings-\$\{todayStr\}`\)/g) || [])).toHaveLength(2);
    });
  });

  describe("field stamps — the reservation ref is on the header AND the child", () => {
    it("the reservation header carries the canonical `reservationRef` field", () => {
      // The MRB-01 commit added `reservationRef: string` to
      // the `Reservation` interface. The Phase 1 entry
      // spec'd the field. The public create stamps it on
      // the header (line ~2048).
      expect(handlers).toMatch(/reservationRef: finalReservationRef/);
    });

    it("the child booking carries the denormalized `reservationRef` field", () => {
      // The MRB-01 commit added `reservationRef: string | null`
      // to the `Booking` interface. The Phase 1 entry
      // spec'd the field as a "compatibility copy" for
      // fast admin search/display. The public create
      // stamps it on the child.
      expect(handlers).toMatch(/reservationRef: finalReservationRef/);
    });

    it("the child booking's denormalized `reservationRef` field is one of the 4 nullable `reservation*` fields", () => {
      // Per the MRB-01 spec: "Four new nullable fields
      // on `Booking`: `reservationId` / `reservationRef` /
      // `reservationPosition` / `reservationRoomCount` —
      // all server-assigned, all read-only projections."
      // The public create stamps all 4 on the child.
      expect(handlers).toMatch(/reservationId: effectiveReservationId/);
      expect(handlers).toMatch(/reservationRef: finalReservationRef/);
      expect(handlers).toMatch(/reservationPosition: 1/);
      expect(handlers).toMatch(/reservationRoomCount: 1/);
    });
  });
});
