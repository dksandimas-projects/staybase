import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Hierarchy + density pass over the Booking Confirmation Receipt
// (2026-11-25), following the correctness pass in
// `receipt-pdf-correctness.test.ts`.
//
// Hierarchy: on a settled booking the largest, boldest, brand-coloured
// thing on the page was "PHP 0" — the eye landed on a zero. A one-room
// reservation printed the same total three times (room subtotal, "Room
// 1 of 1 — deluxe total", Reservation Total) and the reference four
// times (header, banner sub-line, footer note, footer ref).
//
// Density: roughly ten centimetres of the page were blank. The space now
// carries a /my-booking QR. (A cancellation-policy block shipped with
// this pass and was removed the same day — the receipt is a payment
// record, and the policy lives on the booking confirmation email and
// the site.)

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const receiptBody = (() => {
  const start = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
  const end = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", start);
  return bookingsPageSrc.slice(start, end);
})();

describe("receipt PDF — a settled receipt does not shout a zero", () => {
  it("switches the banner to a paid state instead of a 12.5pt PHP 0", () => {
    expect(receiptBody).toMatch(/const isSettledReceipt = amountDueForSummary <= 0/);
    expect(receiptBody).toMatch(/isSettledReceipt \? "Fully paid" : "Amount to collect"/);
    expect(receiptBody).toMatch(/isSettledReceipt \? "No balance due" : formatAmount\(amountDueForSummary\)/);
  });

  it("tints the banner to match the state rather than always using brand orange", () => {
    expect(receiptBody).toMatch(/const bannerRgb = isSettledReceipt \? settledRgb : brandRgb/);
  });

  it("replaces the duplicated reference sub-line with what the number means", () => {
    expect(receiptBody).not.toMatch(/\$\{receiptReference\} • Generated \$\{generatedAt\}/);
    expect(receiptBody).toMatch(/Settled in full on/);
    expect(receiptBody).toMatch(/Payable at check-in/);
  });

  it("dates the settlement from a real timestamp, in the hotel timezone", () => {
    // `formatReceiptDate` is UTC (correct for date-only stay dates); a
    // payment's `recordedAt` is a moment, and 7am in Manila is the
    // previous day in UTC.
    expect(receiptBody).toMatch(/const formatReceiptMoment = \(value: unknown\)/);
    expect(receiptBody).toMatch(/timeZone: config\.timezone \|\| "Asia\/Manila"/);
    expect(receiptBody).toMatch(/formatReceiptMoment\(new Date\(lastPaymentAt\)\)/);
    // The payments table shares it rather than re-deriving the format.
    expect(receiptBody).toMatch(/const recordedDate = formatReceiptMoment\(pay\.recordedAt\)/);
  });
});

describe("receipt PDF — one room, one total", () => {
  it("prints no per-room heading or per-room total for a single room", () => {
    expect(receiptBody).toMatch(/if \(isMultiRoomReceipt\) \{\s*\n\s*pdf\.setFontSize\(9\.2\)/);
    expect(receiptBody).toMatch(/if \(isMultiRoomReceipt\) \{\s*\n\s*drawAmountRow\(\s*\n\s*`  \$\{roomLabel\} total`/);
  });

  it("drops the indent that only existed to sit under a heading", () => {
    expect(receiptBody).toMatch(/const rowIndent = isMultiRoomReceipt \? "  " : ""/);
    expect(receiptBody).toMatch(/`\$\{rowIndent\}\$\{line\.label\}/);
  });

  it("keeps the room's own reference, in the Stay card", () => {
    expect(receiptBody).toMatch(/label: "Room ref", value: b\.bookingRef/);
    // Only when it would otherwise be lost: a one-room reservation whose
    // room ref differs from the reservation ref in the header.
    expect(receiptBody).toMatch(
      /isReservationReceipt && !isMultiRoomReceipt && b\.bookingRef && b\.bookingRef !== receiptReference/
    );
  });
});

describe("receipt PDF — the dead half-page earns its keep", () => {
  it("embeds a /my-booking QR built from the shared renderer", () => {
    expect(bookingsPageSrc).toMatch(/import \{ renderQrPngDataUrl \} from "\.\.\/utils\/renderQrPngDataUrl"/);
    expect(receiptBody).toMatch(/renderQrPngDataUrl\(lookupUrl, 384\)/);
    expect(receiptBody).toMatch(/pdf\.addImage\(lookupQrDataUrl, "PNG"/);
  });

  it("does not put the guest's email in the printed QR", () => {
    // A receipt is a physical object anyone who picks it up can scan.
    // The email templates may deep-link with `&email=`; this must not —
    // /my-booking asks for the email, which is the access check.
    expect(receiptBody).toMatch(/const lookupPath = `\/my-booking\?\$\{isReservationReceipt \? "reservationRef" : "ref"\}=\$\{encodeURIComponent\(receiptReference\)\}`/);
    expect(receiptBody).not.toMatch(/email=\$\{encodeURIComponent/);
  });

  it("never loses the receipt to a QR that failed to rasterise", () => {
    expect(receiptBody).toMatch(/let lookupQrDataUrl = "";\s*\n\s*try \{/);
    expect(receiptBody).toMatch(/\} catch \{\s*\n\s*lookupQrDataUrl = "";/);
  });

  it("ends the block below whichever column runs longer", () => {
    expect(receiptBody).toMatch(/Math\.max\(manageBlockTop \+ 13, manageBlockTop \+ qrSizeMm\)/);
  });
});

describe("receipt PDF — the BIR disclaimer is readable", () => {
  it("emphasises the footer note on the receipt only", () => {
    expect(bookingsPageSrc).toMatch(/emphasizeNote = false/);
    expect(bookingsPageSrc).toMatch(/pdf\.setFontSize\(emphasizeNote \? 8\.2 : 7\.5\)/);
    // The registration PDF's note is a provenance stamp and keeps the
    // quiet default — it passes no flag.
    const registrationFooter = bookingsPageSrc.slice(
      bookingsPageSrc.indexOf("const printRegistrationPDF"),
      bookingsPageSrc.indexOf("const printBookingReceiptPDF")
    );
    expect(registrationFooter).toMatch(/Generated by \$\{config\.brandName\} guest registration system/);
    expect(registrationFooter).not.toMatch(/hotelContact,\s*\n\s*true\s*\n\s*\)/);
  });
});
