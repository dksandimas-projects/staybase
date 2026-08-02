import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

function extractBetween(startMarker: string, endMarker: string): string {
  const start = handlers.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}

const resolver = extractBetween(
  "async function readTransactionalFolioSnapshot",
  "function calculateCheckoutPoints"
);
const confirmWithBalance = extractBetween(
  "export async function handleConfirmBookingWithBalance",
  "export async function handleCheckinBooking"
);
const checkout = extractBetween(
  "export async function handleCheckoutBooking",
  "export async function handleLookupBooking"
);

describe("MRB-04 Phase 4 — reservation-aware transactional folio reads", () => {
  describe("authoritative reservation path", () => {
    it("derives the reservation from the stored child linkage", () => {
      expect(resolver).toMatch(
        /const bookingReservationId = String\(\(bookingData as any\)\.reservationId \|\| ""\)\.trim\(\);/
      );
      expect(resolver).toMatch(
        /adminDb\.collection\("reservations"\)\.doc\(bookingReservationId\)/
      );
    });

    it("reads canonical reservation payments, refunds, and charges", () => {
      expect(resolver).toContain('reservationRef.collection("payments")');
      expect(resolver).toContain('reservationRef.collection("refunds")');
      expect(resolver).toContain('reservationRef.collection("charges")');
      expect(resolver).toMatch(/transaction\.get\(reservationPaymentsRef\)/);
      expect(resolver).toMatch(/transaction\.get\(reservationRefundsRef\)/);
      expect(resolver).toMatch(/transaction\.get\(reservationChargesRef\)/);
    });

    it("fails closed when a child points at a missing reservation header", () => {
      expect(resolver).toMatch(
        /if \(!reservationDoc\.exists\) \{\s*throw new Error\("RESERVATION_HEADER_WITHOUT_CHILD"\);/
      );
    });

    it("uses the reservation total rather than the selected room total", () => {
      expect(resolver).toMatch(
        /const totalPrice = Number\(reservationDoc\.data\(\)\?\.totalPrice\) \|\| 0;/
      );
      expect(resolver).toMatch(
        /computeServerFolioTotals\(\{\s*totalPrice,\s*incidentalTotal,\s*addToBillTotal,\s*collectedTotal/
      );
    });
  });

  describe("multi-room and transition compatibility", () => {
    it("discovers every child room from the reservationId", () => {
      expect(resolver).toMatch(
        /adminDb\.collection\("bookings"\)\.where\("reservationId", "==", bookingReservationId\)/
      );
      expect(resolver).toMatch(
        /childBookingsSnapshot\.docs\.forEach\(\(docSnap: any\) => childBookingIds\.add\(String\(docSnap\.id\)\)\)/
      );
    });

    it("includes transitional child-owned payments and charges", () => {
      expect(resolver).toContain('transaction.get(childRef.collection("payments"))');
      expect(resolver).toContain('transaction.get(childRef.collection("charges"))');
      expect(resolver).toMatch(
        /sumLedgerAmounts\(reservationPaymentsSnapshot\)\s*\+\s*sumLedgerAmounts\(reservationRefundsSnapshot\)\s*\+\s*transitionalCollectedTotal/
      );
      expect(resolver).toMatch(
        /sumLedgerAmounts\(reservationChargesSnapshot\)\s*\+\s*transitionalIncidentalTotal/
      );
    });

    it("sums billed add-to-bill orders across every child room", () => {
      expect(resolver).toMatch(
        /adminDb\.collection\("storeOrders"\)\.where\("bookingId", "==", childBookingId\)/
      );
      expect(resolver).toMatch(
        /sumBilledAddToBillOrders\(snapshots\.storeOrdersSnapshot\)/
      );
    });
  });

  describe("legacy adapter", () => {
    it("keeps null-reservationId bookings on their historical ledgers", () => {
      expect(resolver).toMatch(/if \(!bookingReservationId\) \{/);
      expect(resolver).toContain('bookingRef.collection("payments")');
      expect(resolver).toContain('bookingRef.collection("charges")');
      expect(resolver).toContain('source: "booking-subcollection-legacy"');
    });

    it("keeps the historical single-booking total for legacy rows", () => {
      expect(resolver).toMatch(
        /totalPrice: Number\(bookingData\.totalPrice\) \|\| 0/
      );
    });
  });

  describe("operational balance gates", () => {
    it("confirm-with-balance reads the resolver inside its transaction", () => {
      expect(confirmWithBalance).toMatch(
        /const folioSnapshot = await readTransactionalFolioSnapshot\(\{\s*transaction,\s*bookingRef,\s*bookingId,\s*bookingData: data\s*\}\);/
      );
      expect(confirmWithBalance).toMatch(
        /const computedBalance = folioSnapshot\.computedBalance;/
      );
      expect(confirmWithBalance).toMatch(
        /confirmedWithBalance: computedBalance/
      );
    });

    it("checkout gates against the reservation balance and snapshots that folio", () => {
      expect(checkout).toMatch(
        /const folioSnapshot = await readTransactionalFolioSnapshot\(\{\s*transaction,\s*bookingRef,\s*bookingId,\s*bookingData: freshBookingData\s*\}\);/
      );
      expect(checkout).toMatch(
        /const collectedTotal = folioSnapshot\.collectedTotal;/
      );
      expect(checkout).toMatch(
        /const checkoutFolioTotal = folioSnapshot\.folioTotal;/
      );
      expect(checkout).toMatch(
        /checkedOutWithBalance = folioSnapshot\.computedBalance;/
      );
    });

    it("preserves the unpaid-reason and role threshold gates", () => {
      expect(checkout).toMatch(
        /if \(checkedOutWithBalance > 0 && !safeUnpaidReason\) \{\s*throw new Error\("UNPAID_REASON_REQUIRED"\);/
      );
      expect(checkout).toMatch(
        /if \(needsAdminApproval && staffRole !== "admin"\) \{\s*throw new Error\(`THRESHOLD_EXCEEDED:/
      );
    });
  });
});
