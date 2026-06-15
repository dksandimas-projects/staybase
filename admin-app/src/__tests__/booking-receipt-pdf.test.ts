import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 audit S7.1 / Decision #82 — "Booking
// Confirmation Receipt PDF not implemented." Before this fix,
// `BookingsPage.tsx` only had `printRegistrationPDF`; front desk
// had no way to print/email a booking summary.
//
// Per `plan/features/EMAIL-PDF-STORAGE.md §Booking Confirmation Receipt`,
// the receipt must include:
//   - Header: brand name, "Booking Confirmation Receipt" title
//   - Booking ref + generated date/time
//   - Guest info (name, email, phone)
//   - Stay info (room, dates, nights, guests, rate/night)
//   - Pricing breakdown (subtotal, discounts, voucher, points, total)
//   - Special requests (if present)
//   - Payments collected (or Payment Method + Amount Due when no payments)
//   - Footer with brand contact + BIR-receipt disclaimer
//
// This test guards the builder + the drawer button.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("BookingsPage.tsx — Booking Receipt PDF (audit S7.1, decision #82)", () => {
  describe("printBookingReceiptPDF builder", () => {
    it("defines a printBookingReceiptPDF function next to printRegistrationPDF", () => {
      // The function must exist as a const in the component scope
      expect(bookingsPageSrc).toMatch(
        /const\s+printBookingReceiptPDF\s*=\s*(?:async\s*)?\(\)\s*=>/
      );
      // Defined after the registration builder (audit fix is additive only)
      const registrationIdx = bookingsPageSrc.indexOf("const printRegistrationPDF");
      const receiptIdx = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      expect(registrationIdx).toBeGreaterThan(-1);
      expect(receiptIdx).toBeGreaterThan(registrationIdx);
    });

    it("guards on selectedBooking presence", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcBody = bookingsPageSrc.slice(funcStart, funcStart + 400);
      expect(funcBody).toMatch(/if\s*\(\s*!selectedBooking\s*\)\s*return/);
    });

    it("uses jsPDF in a4 mm mode (matches registration PDF style)", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcBody = bookingsPageSrc.slice(funcStart, funcStart + 800);
      expect(funcBody).toMatch(/new\s+jsPDF\(\s*\{\s*unit:\s*["']mm["']\s*,\s*format:\s*["']a4["']/);
    });

    it("renders the brand name and document title", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/pdf\.text\(\s*config\.brandName/);
      expect(funcBody).toMatch(/Booking Confirmation Receipt/);
    });

    it("renders booking ref + generated timestamp", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Booking Reference:\s*\$\{b\.bookingRef\}/);
      expect(funcBody).toMatch(/Generated:/);
    });

    it("renders guest info: name, email, phone", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Name:\s*\$\{b\.guestName\}/);
      expect(funcBody).toMatch(/Email:\s*\$\{b\.guestEmail\}/);
      expect(funcBody).toMatch(/Phone:\s*\$\{b\.guestPhone\}/);
    });

    it("renders stay info: room, dates, nights, guests, rate", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Room:\s*\$\{b\.roomNumber\}\s*\(\$\{b\.roomType\}\)/);
      expect(funcBody).toMatch(/Check-in:\s*\$\{b\.checkIn\}/);
      expect(funcBody).toMatch(/Check-out:\s*\$\{b\.checkOut\}/);
      expect(funcBody).toMatch(/Nights:\s*\$\{b\.numNights\}/);
      expect(funcBody).toMatch(/Rate per night:/);
    });

    it("renders pricing breakdown: subtotal + discount + voucher + points + total", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Subtotal\s*\(/);
      expect(funcBody).toMatch(/Senior Citizen Discount|PWD Discount/);
      expect(funcBody).toMatch(/Voucher\s*\(\$\{b\.voucherCode\}\)/);
      expect(funcBody).toMatch(/\$\{b\.pointsRedeemed\}\s*pts redeemed/);
      expect(funcBody).toMatch(/pdf\.text\(\s*["']Total["']/);
    });

    it("renders payments-collected section when payments exist", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Payments Collected/);
      expect(funcBody).toMatch(/Total Collected/);
      expect(funcBody).toMatch(/Outstanding Balance/);
    });

    it("falls back to 'Payment Method + Amount Due' when no payments", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Payment Method:/);
      expect(funcBody).toMatch(/Amount Due/);
    });

    it("renders the BIR-receipt disclaimer footer", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(
        /official BIR receipt will be issued upon payment at the property/
      );
    });

    it("opens the PDF in a new tab (no server round-trip — client-side only)", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const getBookingPaymentsTotal", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/pdf\.output\(\s*["']blob["']\s*\)/);
      expect(funcBody).toMatch(/URL\.createObjectURL\(/);
      expect(funcBody).toMatch(/window\.open\(/);
    });
  });

  describe("Booking drawer — Print Booking Receipt button", () => {
    it("renders a Print Booking Receipt (PDF) button bound to printBookingReceiptPDF", () => {
      // The button must exist in the drawer, onClick bound to the builder
      expect(bookingsPageSrc).toMatch(
        /onClick=\{printBookingReceiptPDF\}/
      );
      expect(bookingsPageSrc).toMatch(
        /Print Booking Receipt \(PDF\)/
      );
    });
  });
});
