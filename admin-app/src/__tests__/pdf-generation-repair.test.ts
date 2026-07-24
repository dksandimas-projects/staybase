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

  it("bounds the registration PDF generator with an outer timeout so a hung await closes the placeholder tab", () => {
    // The HEIC/format fix bounds the IMAGE-decode step (5s), but the
    // PDF generator has other awaits (brand-logo fetch, Firebase
    // Storage `getBlob`, FileReader, `canvas.toDataURL`, ...) that
    // are NOT individually bounded. A single hung await anywhere in
    // the chain leaves the "Preparing registration PDF..." placeholder
    // tab open forever because the outer try/catch only fires on
    // rejection. The 2026-07-24 follow-up races the whole body
    // against a 20s timeout so the tab is always closed and a clear
    // error toast is shown no matter where the hang is.
    const registrationStart = bookingsPage.indexOf("const printRegistrationPDF");
    const registrationEnd = bookingsPage.indexOf("const printBookingReceiptPDF", registrationStart);
    const registrationBody = bookingsPage.slice(registrationStart, registrationEnd);

    // The body must be wrapped in an IIFE raced against a timeout
    expect(registrationBody).toMatch(/const buildAndOpen = async \(\) =>/);
    expect(registrationBody).toMatch(/Promise\.race\(\[buildAndOpen\(\), timeoutPromise\]\)/);
    // The timeout promise must reject with a clear, actionable message
    expect(registrationBody).toMatch(/Registration PDF generation took too long/);
    // The timer must be cleared in a finally so a fast successful run
    // doesn't leave a dangling setTimeout
    expect(registrationBody).toMatch(/window\.clearTimeout\(timeoutHandle\)/);
    // The catch must still close the placeholder tab
    expect(registrationBody).toMatch(/pdfWindow\?\.close\(\)/);
    expect(registrationBody).toMatch(/Registration PDF failed/);
  });

  it("labels reports as browser print and explains Save as PDF through the print dialog", () => {
    expect(reportsPage).toMatch(/Print/);
    expect(reportsPage).toMatch(/Choose Save as PDF in your browser print settings/);
    expect(reportsPage).not.toMatch(/Print \/ Save PDF/);
  });

  // Regression: a HEIC (or other browser-undecodable) ID photo used to
  // either slip past `compressImageFile`'s fallback and end up in
  // Storage, or hang `normalizePdfImageToJpeg` indefinitely because
  // `<img>.onerror` never fires for unknown formats. The combination
  // left the "Preparing registration PDF..." placeholder tab open
  // forever. Two guards now enforce correctness.
  it("rejects unsupported image MIME types at the guest ID upload step before reaching Storage", () => {
    const allowed = bookingsPage.match(
      /ALLOWED_GUEST_ID_MIME_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/
    );
    expect(allowed, "expected ALLOWED_GUEST_ID_MIME_TYPES guard").not.toBeNull();
    expect(allowed?.[1]).toMatch(/image\/jpeg/);
    expect(allowed?.[1]).toMatch(/image\/png/);
    expect(allowed?.[1]).toMatch(/image\/webp/);
    expect(allowed?.[1]).not.toMatch(/image\/heic/);
    expect(allowed?.[1]).not.toMatch(/image\/heif/);

    // Guard fires before compressImageFile so HEIC never reaches Storage.
    const guardIndex = bookingsPage.indexOf("ALLOWED_GUEST_ID_MIME_TYPES.has(file.type)");
    const compressionIndex = bookingsPage.indexOf("compressImageFile(file,");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(compressionIndex).toBeGreaterThan(guardIndex);

    // Tightened file input to filter the OS picker too.
    const guestIdInput = bookingsPage.match(
      /<input[\s\S]*?type="file"[\s\S]*?accept="[^"]*"[\s\S]*?onChange=\{\(event\) =>\s*\{[\s\S]*?handleGuestIdUpload/
    );
    expect(guestIdInput?.[0]).toMatch(/accept="image\/jpeg,image\/png,image\/webp"/);
  });

  it("bounds the image decode so an undecodable ID cannot hang the registration PDF generator", () => {
    // The decode Promise must include a timeout-based reject path so
    // that even if the browser fires neither onload nor onerror, the
    // outer PDF try/catch can still run and close the placeholder tab.
    const decodeBlock = bookingsPage.match(
      /await new Promise<void>\(\(resolve, reject\) =>\s*\{[\s\S]*?image\.src = sourceDataUrl;\s*\}\);/
    );
    expect(decodeBlock, "expected to find the image-decode Promise in normalizePdfImageToJpeg").not.toBeNull();
    expect(decodeBlock?.[0]).toMatch(/setTimeout\(/);
    expect(decodeBlock?.[0]).toMatch(/clearTimeout\(timer\)/);
    expect(decodeBlock?.[0]).toMatch(/Image decode timed out/);
  });
});
