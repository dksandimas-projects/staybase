import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookings = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("MRB-04 Phase 5A — reservation-owned admin folio", () => {
  it("listens to the reservation total and canonical payment, refund, and charge ledgers", () => {
    expect(bookings).toContain('doc(db, "reservations", selectedBooking.reservationId)');
    expect(bookings).toContain('"reservations", selectedBooking.reservationId, "payments"');
    expect(bookings).toContain('"reservations", selectedBooking.reservationId, "refunds"');
    expect(bookings).toContain('"reservations", selectedBooking.reservationId, "charges"');
  });

  it("dual-reads transitional child ledgers and cleans up every listener", () => {
    expect(bookings).toMatch(/selectedFolioBookingIds\.map\(\(bookingId\) => \(\{[\s\S]+?"bookings", bookingId, "payments"/);
    expect(bookings).toMatch(/selectedFolioBookingIds\.map\(\(bookingId\) => \(\{[\s\S]+?"bookings", bookingId, "charges"/);
    expect(bookings).toMatch(/return \(\) => unsubscribes\.forEach\(\(unsubscribe\) => unsubscribe\(\)\)/);
  });

  it("writes new reservation charges with child attribution and voids in the original ledger", () => {
    expect(bookings).toMatch(/getSelectedChargeCollection[\s\S]+?"reservations"[\s\S]+?"charges"/);
    expect(bookings).toMatch(/selectedBooking\.reservationId \? \{ bookingId: selectedBooking\.id \} : \{\}/);
    expect(bookings).toMatch(/chargeToVoid\.ledgerOwner/);
    expect(bookings).toMatch(/chargeToVoid\.ledgerOwnerId/);
  });

  it("requires bookingId on reservation charges and preserves it on reversals", () => {
    const reservationRules = rules.slice(rules.indexOf("match /reservations/{reservationId}"));
    expect(reservationRules).toMatch(/hasOnly\(\[[^\]]+"bookingId"\]\)/);
    expect(reservationRules).toMatch(/request\.resource\.data\.bookingId is string/);
    expect(reservationRules).toMatch(/bookings\/\$\(request\.resource\.data\.bookingId\)\)\.data\.reservationId == reservationId/);
    expect(reservationRules).toMatch(/\.data\.bookingId == request\.resource\.data\.bookingId/);
  });

  it("uses reservation child IDs for room-billed store orders and live payments for verification", () => {
    expect(bookings).toContain("folioBookingIds");
    expect(bookings).toMatch(/selectedBookingPayments\.reduce\(\(s, p\) => s \+ p\.amount, 0\)/);
    expect(bookings).toMatch(/selectedBookingFolio\?\.balance/);
  });
});
