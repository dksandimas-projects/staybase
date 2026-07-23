import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("PDF generation repair", () => {
  const bookingsPage = read("admin-app/src/pages/BookingsPage.tsx");
  const reportsPage = read("admin-app/src/pages/ReportsPage.tsx");

  it("uses built-in jsPDF fonts instead of missing or unsafe embedded font files", () => {
    expect(bookingsPage).toMatch(/pdf\.setFont\("helvetica", "normal"\)/);
    expect(bookingsPage).not.toMatch(/Inter-Regular\.ttf/);
    expect(bookingsPage).not.toMatch(/addFileToVFS\("APOLLO\.otf"/);
  });

  it("opens booking PDFs synchronously and falls back to download when popups are blocked", () => {
    expect(bookingsPage).toMatch(/const pdfWindow = window\.open\("", "_blank"\)/);
    expect(bookingsPage).toMatch(/openPdfOrDownload/);
    expect(bookingsPage).toMatch(/pdf\.save\(fileName\)/);
    expect(bookingsPage).toMatch(/Popup blocked, so the PDF was downloaded instead/);
  });

  it("downloads uploaded guest IDs with staff authentication and normalizes them for jsPDF", () => {
    expect(bookingsPage).toMatch(/import \{[^}]*getBlob[^}]*\} from "firebase\/storage"/);
    expect(bookingsPage).toMatch(/const guestIdRef = storageRef\(storage, b\.guestIdPhotoUrl\)/);
    expect(bookingsPage).toMatch(/const blob = await getBlob\(guestIdRef\)/);
    expect(bookingsPage).toMatch(/normalizePdfImageToJpeg\(blob\)/);
    expect(bookingsPage).toMatch(/canvas\.toDataURL\("image\/jpeg", 0\.9\)/);
    expect(bookingsPage).toMatch(/pdf\.addImage\(pdfImage\.dataUrl, "JPEG"/);
  });

  it("requires an uploaded guest ID to be embedded before the registration PDF succeeds", () => {
    const registrationStart = bookingsPage.indexOf("const printRegistrationPDF");
    const registrationEnd = bookingsPage.indexOf("const printBookingReceiptPDF", registrationStart);
    const registrationBody = bookingsPage.slice(registrationStart, registrationEnd);

    expect(registrationBody).toMatch(/await getBlob\(guestIdRef\)/);
    expect(registrationBody).toContain("The uploaded guest ID could not be added to the registration PDF");
    expect(registrationBody).toMatch(/const drawX = idX \+ \(idBoxW - drawW\) \/ 2/);
    expect(registrationBody).toMatch(/const drawY = idBoxY \+ \(idBoxH - drawH\) \/ 2/);
  });

  it("uses an ink-friendly light header for registration PDFs", () => {
    expect(bookingsPage).toMatch(/printLight\?:\s*boolean/);
    expect(bookingsPage).toMatch(/options\.printLight\s*\?\s*\[255,\s*255,\s*255\]/);
    const registrationStart = bookingsPage.indexOf("const printRegistrationPDF");
    const registrationEnd = bookingsPage.indexOf("const printBookingReceiptPDF", registrationStart);
    const registrationBody = bookingsPage.slice(registrationStart, registrationEnd);
    expect(registrationBody).toMatch(/printLight:\s*true/);
  });

  it("lays out the registration PDF as a compact one-page form", () => {
    const registrationStart = bookingsPage.indexOf("const printRegistrationPDF");
    const registrationEnd = bookingsPage.indexOf("const printBookingReceiptPDF", registrationStart);
    const registrationBody = bookingsPage.slice(registrationStart, registrationEnd);
    expect(registrationBody).toMatch(/compact:\s*true/);
    expect(registrationBody).toMatch(/leftW\s*=\s*68/);
    expect(registrationBody).toMatch(/rightW\s*=\s*marginR\s*-\s*rightX/);
    expect(registrationBody).toMatch(/drawCompactSectionTitle\("Guest Information"/);
    expect(registrationBody).toMatch(/drawCompactSectionTitle\("Registration Details"/);
    expect(registrationBody).toMatch(/drawCompactSectionTitle\("Government-Issued ID"/);
    expect(registrationBody).toMatch(/drawCompactSectionTitle\("Guest Acknowledgment"/);
  });

  it("renders breakfast silog selections as compact inline guest rows", () => {
    const registrationStart = bookingsPage.indexOf("const printRegistrationPDF");
    const registrationEnd = bookingsPage.indexOf("const printBookingReceiptPDF", registrationStart);
    const registrationBody = bookingsPage.slice(registrationStart, registrationEnd);
    expect(registrationBody).toMatch(/breakfastTop\s*=\s*Math\.min\(Math\.max\(y\s*\+\s*3,\s*232\),\s*276\s*-\s*breakfastH\)/);
    expect(registrationBody).toMatch(/Guest \$\{g \+ 1\}:/);
    expect(registrationBody).toMatch(/pdf\.rect\(optionX,\s*y\s*-\s*2\.8,\s*2\.7,\s*2\.7\)/);
    expect(registrationBody).not.toMatch(/Available Items:/);
    expect(registrationBody).not.toMatch(/drawBreakfastHeader/);
  });

  it("wraps PDF builders in visible success and error toasts", () => {
    expect(bookingsPage).toMatch(/Registration PDF ready/);
    expect(bookingsPage).toMatch(/Registration PDF failed/);
    expect(bookingsPage).toMatch(/Receipt PDF ready/);
    expect(bookingsPage).toMatch(/Receipt PDF failed/);
  });

  it("labels reports as browser print and explains Save as PDF through the print dialog", () => {
    expect(reportsPage).toMatch(/Print/);
    expect(reportsPage).toMatch(/Choose Save as PDF in your browser print settings/);
    expect(reportsPage).not.toMatch(/Print \/ Save PDF/);
  });
});
