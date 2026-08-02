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

  it("renders special requests per room and reservation-wide payments once", () => {
    expect(receipt).toMatch(/requestBookings = receiptBookings\.filter/);
    expect(receipt).toMatch(/getReceiptRoomLabel\(receiptBooking, bookingIndex\)/);
    expect(receipt).toMatch(/const payments = selectedBookingPayments/);
  });
});
