import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import { installPdfTextSanitizer, toPdfSafeText } from "../utils/pdfText";

// Correctness pass over the Booking Confirmation Receipt (2026-11-25).
// Five defects visible on a printed single-room reservation receipt:
//
//   1. The Stay card printed raw ISO dates ("2026-11-21 to 2026-11-22")
//      while the header and the payments table printed "Nov 21, 2026".
//   2. A one-room reservation said "1 room — itemized below" and
//      "Rate: See room allocations", so the room number and the nightly
//      rate appeared nowhere on the page.
//   3. The configured check-in / check-out times were never printed.
//   4. `formatPaymentMethod` title-cased the raw key, printing "Gcash".
//   5. Rate lines read "1 night x PHP 2,390" with a letter x, and the
//      per-room divergent-dates line used "→", which the standard PDF
//      font cannot encode at all.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const receiptBody = (() => {
  const start = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
  const end = bookingsPageSrc.indexOf("const selectedBookingCheckInReadiness", start);
  return bookingsPageSrc.slice(start, end);
})();

describe("receipt PDF — dates read the same everywhere", () => {
  it("formats stay dates in UTC so a date-only value cannot slip a day", () => {
    expect(receiptBody).toMatch(/timeZone: "UTC"/);
    expect(receiptBody).toMatch(/year: "numeric",\s*month: "short",\s*day: "numeric"/);
  });

  it("leaves no raw ISO date interpolation in the Stay card", () => {
    expect(receiptBody).not.toMatch(/`\$\{b\.checkIn\} to \$\{b\.checkOut\}`/);
  });

  it("routes the divergent per-room dates through the same formatter", () => {
    expect(receiptBody).toMatch(/formatReceiptDate\(receiptBooking\.checkIn\)/);
    expect(receiptBody).toMatch(/formatReceiptDate\(receiptBooking\.checkOut\)/);
  });
});

describe("receipt PDF — a one-room reservation names its room", () => {
  it("only calls a receipt multi-room when it really has more than one room", () => {
    expect(receiptBody).toMatch(
      /const isMultiRoomReceipt = isReservationReceipt && receiptBookings\.length > 1/
    );
  });

  it("uses the multi-room flag for the Room, Stay and Rate rows", () => {
    expect(receiptBody).toMatch(/label: isMultiRoomReceipt \? "Rooms" : "Room"/);
    expect(receiptBody).toMatch(/if \(isMultiRoomReceipt\) \{/);
    expect(receiptBody).toMatch(/isMultiRoomReceipt \? "See room allocations"/);
  });

  it("drops the singular/plural branch that could only ever print 'rooms'", () => {
    expect(receiptBody).toMatch(/\$\{receiptBookings\.length\} rooms — itemized below/);
  });
});

describe("receipt PDF — check-in / check-out times", () => {
  it("prints the live configured times, not the deploy-time constant alone", () => {
    expect(receiptBody).toMatch(/resolveHotelTimes\(hotelConfig, config, config\.locale\)/);
    expect(receiptBody).toMatch(/label: "Check-in \/ out"/);
    expect(receiptBody).toMatch(/receiptHotelTimes\.checkInTime/);
    expect(receiptBody).toMatch(/receiptHotelTimes\.checkOutTime/);
  });
});

describe("receipt PDF — payment method labels", () => {
  it("prefers the hotel's configured label over title-casing the key", () => {
    expect(receiptBody).toMatch(/onsitePaymentMethodLabels\[key\]/);
    expect(receiptBody).toMatch(
      /paymentMethods\.find\(\(entry\) => entry\.method\.trim\(\) === key\)\?\.label/
    );
    // Title case survives only as the last resort.
    expect(receiptBody).toMatch(/if \(configuredLabel\) return configuredLabel;/);
  });
});

describe("receipt PDF — typography that the standard font can actually draw", () => {
  it("uses × for rate lines and no longer uses a letter x", () => {
    expect(receiptBody).toMatch(/\$\{line\.nights\} × \$\{formatAmount\(line\.nightlyRate\)\}/);
    expect(receiptBody).toMatch(/night\$\{[^}]+\} × \$\{formatAmount\(b\.ratePerNight\)\}/);
    expect(receiptBody).not.toMatch(/\$\{line\.nights\} x \$\{formatAmount/);
    expect(receiptBody).not.toMatch(/\} x \$\{formatAmount\(b\.ratePerNight\)\}/);
  });

  it("no longer draws the un-encodable arrow", () => {
    // Only drawn text matters here — the comment explaining why the arrow
    // went away naturally still contains one.
    expect(receiptBody).not.toMatch(/\$\{[^}]*\} → /);
  });

  it("× and – survive the sanitizer, so they reach the page", () => {
    // Both are WinAnsi (0xD7 and 0x96). This is the guard that stops a
    // later 'tidy-up' from swapping them for characters that are not.
    expect(toPdfSafeText("1 night × PHP 2,390")).toBe("1 night × PHP 2,390");
    expect(toPdfSafeText("Nov 21, 2026 – Nov 22, 2026")).toBe("Nov 21, 2026 – Nov 22, 2026");

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setFont("helvetica", "normal");
    installPdfTextSanitizer(pdf);
    pdf.text("1 night × PHP 2,390 – paid", 10, 10);
    const stream = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
    const op = (stream.match(/\((?:\\.|[^()])*\) Tj/g) ?? [])[0] ?? "";
    expect(op).toContain("\xd7"); // ×
    expect(op).toContain("\x96"); // –
    expect(op).not.toContain("\u0000"); // no UTF-16 fallback
  });
});
