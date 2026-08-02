import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const types = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);
const folio = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingFolio.ts"),
  "utf8"
);
const rules = readFileSync(
  resolve(__dirname, "../../../firebase/firestore.rules"),
  "utf8"
);
const sharedIndex = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);

describe("MRB-04 folio migration — Phase 1 (types + subcollection rules + behavior-frozen helper)", () => {
  describe("ReservationPayment + ReservationCharge types", () => {
    it("declares ReservationPayment with reservationId + bookingId + amount + type fields", () => {
      // The reservation-level payment entry. Lives
      // at `reservations/{id}/payments/{paymentId}`.
      // `bookingId` is optional (for per-room
      // attribution; most reservation-level
      // payments leave it null). `amount` is
      // sign-aware: positive for a payment
      // collected, negative for a refund (the
      // CRL-01 negative-amount convention).
      expect(types).toMatch(
        /export interface ReservationPayment \{[\s\S]+?id: string;\s*\n\s*reservationId: string;/
      );
      expect(types).toMatch(
        /bookingId: string \| null;/
      );
      expect(types).toMatch(
        /type: "payment" \| "refund";/
      );
      expect(types).toMatch(
        /amount: number;/
      );
    });

    it("declares ReservationCharge with reservationId + bookingId + amount + voidOf fields", () => {
      // The reservation-level charge entry. Lives
      // at `reservations/{id}/charges/{chargeId}`.
      // The `voidOf` field mirrors the existing
      // `bookings/{id}/charges.voidOf` — a non-null
      // `voidOf` voids a prior charge (the per-
      // creator + bounds + void semantics). The
      // category field reuses the existing
      // `IncidentalChargeCategory` enum so the
      // UI can render the same options across
      // both surfaces.
      expect(types).toMatch(
        /export interface ReservationCharge \{[\s\S]+?id: string;\s*\n\s*reservationId: string;/
      );
      expect(types).toMatch(
        /voidOf: string \| null;/
      );
      expect(types).toMatch(
        /category: IncidentalChargeCategory;/
      );
    });

    it("declares ReservationFolioSummary with the canonical balance invariant fields", () => {
      // The behavior-frozen summary returned by
      // `getReservationFolioSummary`. The balance
      // invariant is `reservation balance ==
      // reservationTotal + chargesTotal −
      // paymentsTotal`. The `source` field records
      // which subcollection the data came from
      // (new reservation-subcollection vs legacy
      // booking-subcollection-legacy).
      expect(types).toMatch(
        /export interface ReservationFolioSummary \{/
      );
      expect(types).toMatch(/reservationTotal: number;/);
      expect(types).toMatch(/chargesTotal: number;/);
      expect(types).toMatch(/paymentsTotal: number;/);
      expect(types).toMatch(/balance: number;/);
      expect(types).toMatch(
        /source: "reservation-subcollection" \| "booking-subcollection-legacy";/
      );
    });
  });

  describe("Firestore rules — reservations/{id}/payments + charges subcollections", () => {
    it("payments subcollection: staff read + server-only create (no client create, no update/delete)", () => {
      // The reservation-level payments subcollection
      // mirrors the existing booking payments
      // subcollection: staff can read; clients
      // cannot create / update / delete (the server's
      // payment / refund APIs are the only write
      // path). The shape is the same as the existing
      // `bookings/{id}/payments` rule so the MRB-04
      // migration can land without a rules shape
      // change.
      expect(rules).toMatch(
        /match \/reservations\/\{reservationId\} \{[\s\S]+?match \/payments\/\{paymentId\} \{[\s\S]+?allow read: if isStaff\(\);[\s\S]+?allow create: if false;[\s\S]+?allow update, delete: if false;/
      );
    });

    it("charges subcollection: staff direct write with per-creator + bounds + void semantics", () => {
      // The reservation-level charges subcollection
      // mirrors the existing booking charges
      // subcollection: staff can read; staff can
      // create with the per-creator + bounds + void
      // semantics (the `addedBy == request.auth.uid`
      // + `addedAt == request.time` + the void-pair
      // check). The void check uses the new
      // `reservations/{id}/charges/{voidOf}` path
      // (not the legacy `bookings/{id}/charges`).
      expect(rules).toMatch(
        /match \/charges\/\{chargeId\} \{[\s\S]+?allow create: if isStaff\(\)[\s\S]+?request\.resource\.data\.addedBy == request\.auth\.uid[\s\S]+?request\.resource\.data\.addedAt == request\.time[\s\S]+?voidOf/
      );
    });
  });

  describe("Behavior-frozen helper — getReservationFolioSummary", () => {
    it("declares ReservationFolioSummaryInput with reservationId + reservationTotal + payments + charges + source fields", () => {
      // The minimal input shape. The caller supplies
      // pre-fetched payments + charges (the helper
      // is pure — no Firestore calls). The `source`
      // field records which subcollection the data
      // came from (the legacy adapter for
      // null-`reservationId` bookings sets
      // `booking-subcollection-legacy`; the new
      // subcollection path sets
      // `reservation-subcollection`).
      expect(folio).toMatch(
        /export interface ReservationFolioSummaryInput \{/
      );
      expect(folio).toMatch(
        /reservationId: string;/
      );
      expect(folio).toMatch(
        /reservationTotal: number;/
      );
      expect(folio).toMatch(
        /payments: FolioReservationPayment\[\];/
      );
      expect(folio).toMatch(
        /charges: FolioReservationCharge\[\];/
      );
      expect(folio).toMatch(
        /source: "reservation-subcollection" \| "booking-subcollection-legacy";/
      );
    });

    it("enforces the canonical balance invariant: balance == reservationTotal + chargesTotal − paymentsTotal", () => {
      // The MRB-04 balance invariant: `reservation
      // balance == reservationTotal + chargesTotal
      // − paymentsTotal`. A positive balance means
      // the guest owes money; a negative balance
      // means the guest is overpaid (refund
      // pending). The single-pass sign-aware sum
      // preserves the invariant at the math level
      // — no separate derivation that could drift.
      expect(folio).toMatch(
        /const balance = reservationTotal \+ chargesTotal - paymentsTotal;/
      );
    });

    it("computes paymentsTotal via a sign-aware reduce on payments + refunds (the dual-read pattern)", () => {
      // Per MRB-04 Phase 2.x (2026-08-02, per decision #159):
      // the helper sums BOTH `payments` (positive-amount
      // entries) AND `refunds` (the canonical negative-amount
      // refund source) into `paymentsTotal`. The reduces are
      // sign-aware: positive amounts (payments) add to the
      // total; negative amounts (refunds) subtract. The
      // single-pass sum preserves the invariant at the math
      // level (a 1000 payment + 200 refund = 800 total).
      // The CRL-01 negative-amount convention is honored.
      // The `refunds ?? []` default keeps Phase 1 callers
      // backward-compatible.
      expect(folio).toMatch(
        /const refunds = input\.refunds \?\? \[\];\s*\n\s*const paymentsTotal =\s*\n\s*input\.payments\.reduce\(\(sum, p\) => sum \+ \(Number\(p\.amount\) \|\| 0\), 0\) \+\s*\n\s*refunds\.reduce\(\(sum, r\) => sum \+ \(Number\(r\.amount\) \|\| 0\), 0\);/
      );
    });

    it("computes chargesTotal via a sign-aware reduce (adjustments + voids)", () => {
      // The charges reduce is sign-aware: positive
      // amounts (charges) add to the total; the
      // void pair (negative amount + original
      // charge) zeroes out (the caller is
      // responsible for pre-filtering the void pair
      // — see the doc block above the helper). The
      // same single-pass sum pattern as payments.
      expect(folio).toMatch(
        /const chargesTotal = input\.charges\.reduce\(\s*\n\s*\(sum, c\) => sum \+ \(Number\(c\.amount\) \|\| 0\),\s*\n\s*0\s*\n\s*\);/
      );
    });

    it("echoes the source flag on the returned summary (so the caller can branch on legacy vs new)", () => {
      // The returned summary carries the `source`
      // flag from the input. The admin UI uses this
      // to render a "legacy booking" badge; the
      // receipt path renders the same shape
      // regardless of source. The flag is the
      // canonical "did this data come from the new
      // reservation subcollections or the legacy
      // booking subcollections" marker.
      expect(folio).toMatch(
        /source: input\.source\s*\n\s*\};/
      );
    });
  });

  describe("Shared barrel re-exports", () => {
    it("re-exports the new types + helper from @spark-inn/shared", () => {
      // The `shared/index.ts` barrel re-exports
      // `./types` + `./utils/bookingFolio`, so the
      // new `ReservationPayment` + `ReservationCharge`
      // + `ReservationFolioSummary` types + the
      // `getReservationFolioSummary` helper are
      // auto-available to every workspace.
      expect(sharedIndex).toMatch(/export \* from "\.\/types";/);
      expect(sharedIndex).toMatch(/export \* from "\.\/utils\/bookingFolio";/);
    });
  });
});
