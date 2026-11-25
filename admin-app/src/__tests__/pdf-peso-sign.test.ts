import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import { installPdfTextSanitizer, toPdfSafeText } from "../utils/pdfText";

// Regression: the booking receipt PDF printed "± 2 , 3 9 0" instead of
// "₱2,390", and every line carrying an amount came out letter-spaced.
//
// Cause: the receipt is drawn with jsPDF's built-in Helvetica, a standard
// WinAnsi-encoded font. U+20B1 (₱) is not in WinAnsi, so jsPDF fell back to
// emitting the whole string as UTF-16 — 20 B1 00 32 00 2C … — which the font
// cannot map. The leading 20 B1 drew as "±" and the interleaved 00 bytes
// drew as the gaps between every remaining character.
//
// The receipt keeps its standard font (AA-30 forbids embedding a TTF), so
// the peso sign is written as the "PHP" currency code instead — matching
// `pdfSafe` in `guest-app/server/handlers/email.ts`, so the printed receipt
// and the emailed one read the same.

const textOps = (pdf: jsPDF) =>
  Buffer.from(pdf.output("arraybuffer"))
    .toString("latin1")
    .match(/\((?:\\.|[^()])*\) Tj/g) ?? [];

describe("toPdfSafeText", () => {
  it("writes the peso sign as the PHP currency code", () => {
    expect(toPdfSafeText("₱2,390")).toBe("PHP 2,390");
    expect(toPdfSafeText("Breakfast — ₱350 / guest / night")).toBe(
      "Breakfast — PHP 350 / guest / night"
    );
  });

  it("keeps the characters WinAnsi does carry", () => {
    // Em dash, en dash, bullet, ellipsis, curly quotes and é all have
    // WinAnsi code points — stripping them would be a regression of its own.
    expect(toPdfSafeText("Room 1 of 1 — deluxe")).toBe("Room 1 of 1 — deluxe");
    expect(toPdfSafeText("a – b • c … “d” ’e café ñ")).toBe("a – b • c … “d” ’e café ñ");
  });

  it("decomposes anything else to Latin-1 rather than corrupting the line", () => {
    expect(toPdfSafeText("ｆｕｌｌwidth")).toBe("fullwidth");
    expect(toPdfSafeText("note 😀 here")).toBe("note  here");
  });

  it("tolerates null and undefined", () => {
    expect(toPdfSafeText(null)).toBe("");
    expect(toPdfSafeText(undefined)).toBe("");
  });
});

describe("installPdfTextSanitizer", () => {
  it("draws an amount as single-byte text instead of the UTF-16 fallback", () => {
    const broken = new jsPDF({ unit: "mm", format: "a4" });
    broken.setFont("helvetica", "normal");
    broken.text("₱2,390", 10, 10);
    // Proves the bug is real and not a viewer artefact: the raw stream
    // carries the ± byte and the interleaved NULs.
    expect(textOps(broken)[0]).toContain("±");
    expect(textOps(broken)[0]).toContain("\u0000");

    const fixed = new jsPDF({ unit: "mm", format: "a4" });
    fixed.setFont("helvetica", "normal");
    installPdfTextSanitizer(fixed);
    fixed.text("₱2,390", 10, 10);
    expect(textOps(fixed)).toEqual(["(PHP 2,390) Tj"]);
  });

  it("sanitizes arrays of lines too", () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setFont("helvetica", "normal");
    installPdfTextSanitizer(pdf);
    pdf.text(["Total ₱1,000", "Paid ₱400"], 10, 10);
    expect(textOps(pdf).join(" ")).toContain("PHP 1,000");
    expect(textOps(pdf).join(" ")).toContain("PHP 400");
    expect(textOps(pdf).join(" ")).not.toContain("\u0000");
  });

  it("measures what it draws, so right-aligned amounts stay aligned", () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setFont("helvetica", "normal");
    installPdfTextSanitizer(pdf);
    // "PHP 2,390" is wider than "₱2,390" — measuring the raw string would
    // push every right-aligned amount off its column.
    expect(pdf.getTextWidth("₱2,390")).toBeCloseTo(pdf.getTextWidth("PHP 2,390"), 5);
  });

  it("is idempotent — a second install does not double-wrap", () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    installPdfTextSanitizer(pdf);
    const once = pdf.text;
    installPdfTextSanitizer(pdf);
    expect(pdf.text).toBe(once);
  });
});

describe("BookingsPage.tsx wiring", () => {
  const bookingsPageSrc = readFileSync(
    resolve(__dirname, "../pages/BookingsPage.tsx"),
    "utf8"
  );

  it("installs the sanitizer in registerBrandPdfFonts, before any text is drawn", () => {
    expect(bookingsPageSrc).toMatch(/import \{ installPdfTextSanitizer \} from "\.\.\/utils\/pdfText"/);
    const start = bookingsPageSrc.indexOf("async function registerBrandPdfFonts");
    const body = bookingsPageSrc.slice(start, bookingsPageSrc.indexOf("function setPdfFont", start));
    expect(body).toMatch(/installPdfTextSanitizer\(pdf\)/);
  });

  it("keeps both PDF builders on the shared font/sanitizer entry point", () => {
    const registrationIdx = bookingsPageSrc.indexOf("const printRegistrationPDF");
    const receiptIdx = bookingsPageSrc.indexOf("const printBookingReceiptPDF");
    for (const start of [registrationIdx, receiptIdx]) {
      const body = bookingsPageSrc.slice(start, start + 3000);
      expect(body).toMatch(/new jsPDF\(\{ unit: "mm", format: "a4" \}\);\s*\n\s*await registerBrandPdfFonts\(pdf\)/);
    }
  });
});
