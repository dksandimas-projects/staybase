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
//   - Header: navbar logo, brand styling, "Booking Confirmation Receipt" title
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
      const funcBody = bookingsPageSrc.slice(funcStart, funcStart + 2200);
      expect(funcBody).toMatch(/new\s+jsPDF\(\s*\{\s*unit:\s*["']mm["']\s*,\s*format:\s*["']a4["']/);
    });

    it("renders the branded logo header and document title", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(bookingsPageSrc).toMatch(/getPdfBrandLogoDataUrl/);
      expect(bookingsPageSrc).toMatch(/config\.logos\.navbar/);
      expect(funcBody).toMatch(/drawPdfBrandHeader\(pdf/);
      expect(funcBody).toMatch(/Booking Confirmation Receipt/);
      expect(funcBody).toMatch(/printLight:\s*true/);
    });

    it("renders booking ref + generated timestamp", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/receiptReferenceLabel = isReservationReceipt \? "Reservation Reference" : "Booking Reference"/);
      expect(funcBody).toMatch(/subtitle: `\$\{receiptReferenceLabel\}: \$\{receiptReference\}`/);
      expect(funcBody).toMatch(/Generated:/);
    });

    it("renders guest info: name, email, phone", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/\{ label:\s*["']Name["'],\s*value:\s*b\.guestName \}/);
      expect(funcBody).toMatch(/\{ label:\s*["']Email["'],\s*value:\s*b\.guestEmail \}/);
      expect(funcBody).toMatch(/\{ label:\s*["']Phone["'],\s*value:\s*b\.guestPhone \}/);
    });

    it("renders stay info: room, dates, nights, guests, rate", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/label: isReservationReceipt \? "Rooms" : "Room"/);
      expect(funcBody).toMatch(/: `\$\{b\.roomNumber\} \(\$\{b\.roomType\}\)`/);
      expect(funcBody).toMatch(/\{ label:\s*["']Dates["'],\s*value:\s*`\$\{b\.checkIn\}\s*to\s*\$\{b\.checkOut\}` \}/);
      // Per EXB-08 (2026-08-01, per decision #156): the
      // Stay line now uses a multi-line IIFE that
      // surfaces the adult/child split + extra bed
      // count when those fields are present on the
      // booking. The label key is unchanged
      // (`"Stay"`); only the value expression grew
      // to handle the split.
      expect(funcBody).toMatch(/\{ label:\s*["']Stay["'],\s*value:\s*\(\(\) => \{/);
      expect(funcBody).toMatch(/numAdults/);
      expect(funcBody).toMatch(/numChildren/);
      expect(funcBody).toMatch(/extraBedCount/);
      expect(funcBody).toMatch(/isReservationReceipt \? "See room allocations" : `\$\{formatAmount\(b\.ratePerNight\)\} \/ night`/);
      expect(funcBody).toMatch(/drawInfoCard\("Guest"/);
      expect(funcBody).toMatch(/drawInfoCard\("Stay"/);
    });

    it("renders pricing breakdown: subtotal + discount + voucher + points + total", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Room subtotal:/);
      expect(funcBody).toMatch(/Senior Citizen Discount|PWD Discount/);
      expect(funcBody).toMatch(/Voucher\s*\(\$\{b\.voucherCode\}\)/);
      expect(funcBody).toMatch(/\$\{b\.pointsRedeemed\}\s*pts redeemed/);
      expect(funcBody).toMatch(/"Reservation Total" : "Booking Total"/);
      expect(funcBody).toMatch(/drawAmountRow/);
    });

    it("formats PDF currency with config.currencySymbol and config.locale", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/`\$\{config\.currencySymbol\}\$\{Math\.round\(value \|\| 0\)\.toLocaleString\(config\.locale\)\}`/);
      expect(funcBody).not.toMatch(/formatPrice\(value\)/);
    });

    it("keeps detail cards and amount rows compact and aligned", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/cardH\s*=\s*7\.5\s*\+\s*rows\.length\s*\*\s*4\.2/);
      expect(funcBody).toMatch(/amountX\s*=\s*marginR\s*-\s*5/);
      expect(funcBody).toMatch(/pdf\.text\(amount,\s*amountX,\s*y,\s*\{\s*align:\s*["']right["'],\s*charSpace:\s*0\s*\}\)/);
      expect(funcBody).toMatch(/pdf\.setFont\("helvetica",\s*["']bold["']\)/);
    });

    it("renders payments-collected section when payments exist", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Payments Collected/);
      expect(funcBody).toMatch(/Total collected/);
      expect(funcBody).toMatch(/Balance due/);
    });

    it("falls back to 'Payment Method + Amount Due' when no payments", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Expected payment method:/);
      expect(funcBody).toMatch(/Amount due at property/);
    });

    it("renders an easy-to-scan amount summary at the top", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/Amount to collect/);
      expect(funcBody).toMatch(/amountDueForSummary/);
      expect(funcBody).toMatch(/\$\{isReservationReceipt \? "Reservation" : "Booking"\} \$\{receiptReference\} • Generated/);
    });

    it("pulls the footer up beneath the receipt content instead of pinning it to the page bottom", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(bookingsPageSrc).toMatch(/footerY\s*=\s*278/);
      expect(funcBody).toMatch(/footerY\s*=\s*y\s*\+\s*8/);
      expect(funcBody).toMatch(/drawPdfFooter\([\s\S]*?brandRgb,\s*footerY\s*>\s*275/);
    });

    it("renders the BIR-receipt disclaimer footer", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(
        /official BIR receipt will be issued upon payment at the property/
      );
    });

    it("opens the PDF synchronously and falls back to download when needed", () => {
      const funcStart = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
      const funcEnd = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", funcStart);
      const funcBody = bookingsPageSrc.slice(funcStart, funcEnd);
      expect(funcBody).toMatch(/window\.open\("", "_blank"\)/);
      expect(funcBody).toMatch(/openPdfOrDownload\(pdf,/);
      expect(bookingsPageSrc).toMatch(/pdf\.output\(\s*["']blob["']\s*\)/);
      expect(bookingsPageSrc).toMatch(/URL\.createObjectURL\(/);
      expect(bookingsPageSrc).toMatch(/pdf\.save\(fileName\)/);
    });
  });

  describe("Booking drawer — Print receipt PDF button", () => {
    it("renders a Print receipt PDF button bound to printBookingReceiptPDF", () => {
      // The button must exist in the drawer, onClick bound to the builder
      expect(bookingsPageSrc).toMatch(
        /onClick=\{printBookingReceiptPDF\}/
      );
      expect(bookingsPageSrc).toMatch(
        /Print receipt PDF/
      );
    });
  });
});
