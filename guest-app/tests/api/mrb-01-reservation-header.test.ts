import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const types = readFileSync(resolve(__dirname, "../../../shared/types/index.ts"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");
const refs = readFileSync(resolve(__dirname, "../../../shared/utils/references.ts"), "utf8");
const fingerprint = readFileSync(resolve(__dirname, "../../../shared/utils/reservationFingerprint.ts"), "utf8");
const sharedIndex = readFileSync(resolve(__dirname, "../../../shared/index.ts"), "utf8");

describe("MRB-01 reservation header model", () => {
  describe("Reservation type (shared/types/index.ts)", () => {
    it("declares the full Reservation interface with the per-decision-#159 ownership split", () => {
      // The interface header is the contract — the per-field
      // pinning tests below are the prose; the existence of
      // the type itself is the wire.
      expect(types).toMatch(/export interface Reservation \{/);
    });

    it("owns the public ref + lead booker / contact", () => {
      expect(types).toMatch(/id: string/);
      expect(types).toMatch(/reservationRef: string/);
      expect(types).toMatch(/leadGuestName: string/);
      expect(types).toMatch(/leadGuestEmail: string/);
      expect(types).toMatch(/leadGuestPhone: string/);
      expect(types).toMatch(/memberId: string \| null/);
    });

    it("owns the shared date range (one set of dates per reservation, per owner decision)", () => {
      expect(types).toMatch(/checkIn: Date/);
      expect(types).toMatch(/checkOut: Date/);
      expect(types).toMatch(/numNights: number/);
    });

    it("owns the group totals + the snapshotted discount scope", () => {
      expect(types).toMatch(/originalSubtotal: number/);
      expect(types).toMatch(/discountScopeSnapshot: DiscountScope \| null/);
      expect(types).toMatch(/subtotal: number/);
      expect(types).toMatch(/totalPrice: number/);
    });

    it("owns the source / corporate / voucher / member context (single value per reservation)", () => {
      expect(types).toMatch(/source: BookingSource/);
      expect(types).toMatch(/isCorporate: boolean/);
      expect(types).toMatch(/corporateCode: string/);
      expect(types).toMatch(/companyName: string/);
      expect(types).toMatch(/voucherCode: string/);
      expect(types).toMatch(/memberDiscountPct: number/);
    });

    it("owns the money state + the consent fields + the aggregate counters + the PEX hold", () => {
      // Money state mirrors the booking but at reservation scope.
      expect(types).toMatch(/(?:paymentStatus: "awaiting-payment" \| "payment-uploaded" \| "payment-confirmed" \| "confirmed" \| "in-house" \| "completed" \| "cancelled"|paymentStatus: ReservationPaymentStatus)/);
      expect(types).toMatch(/paymentMethod: PaymentMethod/);
      // Consent — single per reservation (same T&C + privacy acceptance covers all rooms).
      expect(types).toMatch(/termsAccepted: boolean/);
      expect(types).toMatch(/termsAcceptedAt: Date \| null/);
      expect(types).toMatch(/termsVersion: string/);
      expect(types).toMatch(/privacyAccepted: boolean/);
      expect(types).toMatch(/privacyAcceptedAt: Date \| null/);
      expect(types).toMatch(/privacyVersion: string/);
      // Aggregate counters.
      expect(types).toMatch(/roomCount: number/);
      expect(types).toMatch(/activeRoomCount: number/);
      expect(types).toMatch(/cancelledRoomCount: number/);
      expect(types).toMatch(/checkedInRoomCount: number/);
      expect(types).toMatch(/checkedOutRoomCount: number/);
      // Unified PEX hold (no separate large-group timer per MRB-08).
      expect(types).toMatch(/holdExpiresAt: Date \| null/);
    });

    it("owns the requestFingerprint field (server-only, never client-supplied)", () => {
      // The fingerprint is the idempotency anchor — see the
      // `computeRequestFingerprint` helper + decision #159.
      expect(types).toMatch(/requestFingerprint: string/);
    });

    it("does NOT include per-room fields (the ownership split forbids the header from owning room-level state)", () => {
      // The header is reservation-authoritative. Per-room
      // fields (physical room / dates per room / occupancy /
      // rate / add-on / tax snapshots / registration / ID /
      // check-in / out / housekeeping) live on each child
      // `bookings/{id}`. Scope the negative match to the
      // Reservation interface body so a future Booking field
      // addition (which legitimately carries `roomId`) does
      // not false-fail this test.
      const reservationBlock = types.match(/export interface Reservation \{[\s\S]+?\n\}/);
      expect(reservationBlock).toBeTruthy();
      const body = reservationBlock![0];
      expect(body).not.toMatch(/roomId: string/);
      expect(body).not.toMatch(/numGuests: number/);
      expect(body).not.toMatch(/registration:/);
    });
  });

  describe("Booking type — the 4 reservation fields (compatibility copies)", () => {
    it("declares reservationId + reservationRef + reservationPosition + reservationRoomCount, all nullable on legacy bookings", () => {
      expect(types).toMatch(/reservationId: string \| null/);
      expect(types).toMatch(/reservationRef: string \| null/);
      expect(types).toMatch(/reservationPosition: number \| null/);
      expect(types).toMatch(/reservationRoomCount: number \| null/);
    });
  });

  describe("Firestore rules — reservations/ collection + the bookings implicit deny", () => {
    it("reservations/ is server-authoritative: read is staff, write is false", () => {
      expect(rules).toMatch(/match \/reservations\/\{reservationId\} \{[\s\S]+?allow read: if isStaff\(\);[\s\S]+?allow write: if false;/);
    });

    it("reservations/{id}/payments mirrors the booking payments rule (server-only create, no update/delete)", () => {
      // Slice a bounded window around the reservations match
      // so the inner `}` of the payments sub-block does not
      // close our outer slice early.
      const start = rules.indexOf("match /reservations/{reservationId}");
      expect(start).toBeGreaterThanOrEqual(0);
      const slice = rules.slice(start, start + 2500);
      expect(slice).toMatch(/match \/payments\/\{paymentId\} \{[\s\S]+?allow create: if false;/);
      expect(slice).toMatch(/allow update, delete: if false;/);
    });

    it("reservations/{id}/charges mirrors the booking charges rule (staff create with per-creator + bounds + void semantics)", () => {
      const start = rules.indexOf("match /reservations/{reservationId}");
      const slice = rules.slice(start, start + 2500);
      expect(slice).toMatch(/match \/charges\/\{chargeId\} \{[\s\S]+?allow create: if isStaff\(\)/);
      expect(slice).toMatch(/request\.resource\.data\.addedBy == request\.auth\.uid/);
      expect(slice).toMatch(/request\.resource\.data\.amount <= 1000000/);
      expect(slice).toMatch(/chargeId == "void-" \+ request\.resource\.data\.voidOf/);
    });

    it("the bookings/ update allowlist does NOT include the four reservation* fields (implicit deny by omission)", () => {
      // The implicit-deny contract — a future refactor that
      // widens the allowlist (e.g. by adding "reservationId" to
      // the list) breaks this test. Client writes to
      // reservationId, reservationRef, reservationPosition,
      // and reservationRoomCount are server-only.
      // Match the allowlist by anchoring to the closing
      // "updatedAt"\n        ]) — a stable close that is not
      // ambiguous with the comment's `[...]` reference.
      const start = rules.indexOf("match /bookings/{bookingId}");
      expect(start).toBeGreaterThanOrEqual(0);
      const slice = rules.slice(start, start + 3000);
      const allowlist = slice.match(/affectedKeys\(\)\.hasOnly\(\[[\s\S]+?"updatedAt"\s*\]/);
      expect(allowlist).toBeTruthy();
      const list = allowlist![0];
      expect(list).not.toMatch(/"reservationId"/);
      expect(list).not.toMatch(/"reservationRef"/);
      expect(list).not.toMatch(/"reservationPosition"/);
      expect(list).not.toMatch(/"reservationRoomCount"/);
    });

    it("the bookings/ update rule has a comment documenting the implicit-deny contract", () => {
      // The comment is the prose anchor for the test above —
      // a future refactor that deletes the comment also loses
      // the rationale for the implicit deny.
      const start = rules.indexOf("match /bookings/{bookingId}");
      const slice = rules.slice(start, start + 3000);
      expect(slice).toMatch(/MRB-01/);
      expect(slice).toMatch(/implicitly denied by omission/);
    });
  });

  describe("Reservation ref + ID utilities (shared/utils/references.ts)", () => {
    it("exports RESERVATION_REF_REGEX, isValidReservationRef, RESERVATION_ID_REGEX, isValidReservationId, generateReservationId", () => {
      expect(refs).toMatch(/export const RESERVATION_REF_REGEX = \/\^R-\\d\{8\}-\\d\{3,5\}\$\//);
      expect(refs).toMatch(/export function isValidReservationRef/);
      expect(refs).toMatch(/export const RESERVATION_ID_REGEX = \/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i/);
      expect(refs).toMatch(/export function isValidReservationId/);
      expect(refs).toMatch(/export function generateReservationId/);
    });
  });

  describe("Reservation fingerprint helper (shared/utils/reservationFingerprint.ts)", () => {
    it("exports computeRequestFingerprint + the FingerprintableReservationRequest interface", () => {
      expect(fingerprint).toMatch(/export interface FingerprintableReservationRequest/);
      expect(fingerprint).toMatch(/export function computeRequestFingerprint/);
    });

    it("the helper sorts room lines by (type, quantity) for byte-equivalence", () => {
      // The canonical order is the contract — a re-order in
      // the helper would break the dedup test.
      expect(fingerprint).toMatch(/\.sort\(\(a, b\) => \{[\s\S]+?a\.type !== b\.type/);
    });

    it("the helper trims + lowercases the email + uppercases the corporate/voucher codes", () => {
      expect(fingerprint).toMatch(/leadGuestEmail: String\(req\.leadGuestEmail \|\| ""\)\.trim\(\)\.toLowerCase\(\)/);
      expect(fingerprint).toMatch(/corporateCode: String\(req\.corporateCode \|\| ""\)\.trim\(\)\.toUpperCase\(\)/);
      expect(fingerprint).toMatch(/voucherCode: String\(req\.voucherCode \|\| ""\)\.trim\(\)\.toUpperCase\(\)/);
    });

    it("the helper uses a lazy-require for node:crypto (shared module stays environment-agnostic)", () => {
      // The lazy-require pattern is the only `node:` import in
      // the shared module — keeping it inside the function
      // means the client bundle does not pull in `node:crypto`.
      expect(fingerprint).toMatch(/require\("node:crypto"\) as typeof import\("node:crypto"\)/);
    });
  });

  describe("Shared barrel (shared/index.ts) re-exports the new utilities", () => {
    it("re-exports the reservation fingerprint module", () => {
      expect(sharedIndex).toMatch(/export \* from "\.\/utils\/reservationFingerprint"/);
    });
  });
});
