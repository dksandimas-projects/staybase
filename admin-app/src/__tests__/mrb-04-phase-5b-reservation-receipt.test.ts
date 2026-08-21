import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookings = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const context = readFileSync(resolve(__dirname, "../context/AdminContext.tsx"), "utf8");

describe("MRB-04 Phase 5B — reservation-aware receipt", () => {
  const start = bookings.indexOf("const printBookingReceiptPDF");
  const end = bookings.indexOf("const selectedBookingCheckInReadiness", start);
  const receipt = bookings.slice(start, end);

  it("selects and deterministically orders every reservation child", () => {
    expect(receipt).toMatch(/filter\(\(booking\) => booking\.reservationId === b\.reservationId\)/);
    expect(receipt).toMatch(/reservationPosition/);
    expect(receipt).toMatch(/left\.bookingRef\.localeCompare\(right\.bookingRef\)/);
    expect(receipt).toMatch(/: \[b\]/);
  });

  it("uses the reservation reference in headers, footer, and filename", () => {
    expect(receipt).toMatch(/b\.reservationRef \|\| b\.bookingRef/);
    expect(receipt).toMatch(/"Reservation Reference" : "Booking Reference"/);
    expect(receipt).toMatch(/isReservationReceipt \? "Reservation Ref" : "Booking Ref"/);
    expect(receipt).toMatch(/`\$\{receiptFileStem\}-receipt\.pdf`/);
  });

  it("itemizes stored pricing allocations for every child room", () => {
    expect(receipt).toMatch(/receiptBookings\.forEach\(\(receiptBooking, bookingIndex\)/);
    expect(receipt).toMatch(/receiptBooking\.rateBreakdown/);
    expect(receipt).toMatch(/breakdown\.roomLines\.forEach/);
    expect(receipt).toMatch(/breakdown\.addOns\.forEach/);
    expect(receipt).toMatch(/breakdown\.deductions\.forEach/);
    expect(receipt).toMatch(/formatAmount\(receiptBooking\.totalPrice\)/);
  });

  it("totals the reservation once and keeps folio-only charges separate", () => {
    expect(receipt).toMatch(/"Reservation Total" : "Booking Total"/);
    expect(receipt).toMatch(/selectedFolioBaseTotal : b\.totalPrice/);
    expect(receipt).toMatch(/"Folio total", formatAmount\(receiptFolio\.grandTotal\)/);
  });

  it("aggregates VAT from stored child allocations", () => {
    expect(receipt).toMatch(/receiptBookings\.reduce\(\(totals, receiptBooking\)/);
    expect(receipt).toMatch(/getBookingVatBreakdown\(\{[\s\S]+?totalPrice: receiptBooking\.totalPrice/);
    expect(receipt).toMatch(/totals\.vatAmount \+ roomVat\.vatAmount/);
  });

  it("attributes room-specific store and incidental charges", () => {
    expect(receipt).toMatch(/getReceiptAttribution\(order\.bookingId\)/);
    expect(receipt).toMatch(/getReceiptAttribution\(\(charge as IncidentalCharge\)\.bookingId\)/);
    expect(context).toMatch(/bookingId\?: string \| null/);
  });

  // Per feat/special-requests-redirect (2026-08-21): the
  // PDF receipt no longer renders a "Special Requests" section.
  // The public /book form no longer collects the field, the
  // admin walk-in / calendar create paths now write an empty
  // string, and the intercom amber banner is the only admin
  // surface that surfaces the value (for in-flight bookings
  // that already carry one). The previous test asserted the
  // filter block + the per-room label render; both are gone.
  it("does not render a Special Requests section in the receipt", () => {
    expect(receipt).not.toMatch(/requestBookings = receiptBookings\.filter/);
    expect(receipt).not.toMatch(/drawPdfSectionTitle\(pdf, "Special Requests"/);
  });

  it("still renders reservation-wide payments once", () => {
    expect(receipt).toMatch(/const payments = selectedBookingPayments/);
  });
});
