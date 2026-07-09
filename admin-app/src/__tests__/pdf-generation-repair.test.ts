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

  it("detects uploaded ID image format before embedding in registration PDFs", () => {
    expect(bookingsPage).toMatch(/function getJsPdfImageFormat/);
    expect(bookingsPage).toMatch(/blob\.type/);
    expect(bookingsPage).toMatch(/pdf\.addImage\(base64, getJsPdfImageFormat\(base64, blob\.type\)/);
    expect(bookingsPage).not.toMatch(/pdf\.addImage\(base64, "JPEG"/);
  });

  it("wraps PDF builders in visible success and error toasts", () => {
    expect(bookingsPage).toMatch(/Registration PDF ready/);
    expect(bookingsPage).toMatch(/Registration PDF failed/);
    expect(bookingsPage).toMatch(/Receipt PDF ready/);
    expect(bookingsPage).toMatch(/Receipt PDF failed/);
  });

  it("labels reports as browser print and explains Save as PDF through the print dialog", () => {
    expect(reportsPage).toMatch(/Print Report/);
    expect(reportsPage).toMatch(/Choose Save as PDF in your browser print settings/);
    expect(reportsPage).not.toMatch(/Print \/ Save PDF/);
  });
});
