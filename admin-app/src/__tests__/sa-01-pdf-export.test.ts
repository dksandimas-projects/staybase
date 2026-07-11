import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("SA-01 performance report PDF export must use jsPDF", () => {
  it("imports jsPDF and html2canvas in ReportsPage", () => {
    expect(reports).toMatch(/import \{ jsPDF \} from "jspdf";/);
    expect(reports).toMatch(/import html2canvas from "html2canvas";/);
  });

  it("defines isExportingPDF state and handleExportPDF function", () => {
    expect(reports).toMatch(/const \[isExportingPDF, setIsExportingPDF\] = useState\(false\);/);
    expect(reports).toMatch(/const handleExportPDF = async \(\) =>/);
  });

  it("captures tab content element via html2canvas and initializes jsPDF", () => {
    expect(reports).toMatch(/const element = document\.getElementById\(elementId\);/);
    expect(reports).toMatch(/html2canvas\(element, \{/);
    expect(reports).toMatch(/new jsPDF\(\{ unit: "mm", format: "a4"/);
  });

  it("draws captured image and saves PDF with dynamic file naming", () => {
    expect(reports).toMatch(/pdf\.addImage\(imgData, "PNG",/);
    expect(reports).toMatch(/pdf\.save\(`sparkinn_\$\{activeTab\}_report_/);
  });

  it("renders Export PDF button for performance and sales reports in header", () => {
    expect(reports).toMatch(/activeTab !== "daily-close"/);
    expect(reports).toMatch(/onClick=\{handleExportPDF\}/);
    expect(reports).toMatch(/isExportingPDF \? "Exporting\.\.\." : "PDF"/);
  });

  it("defines performance-tab-content and sales-tab-content containers", () => {
    expect(reports).toMatch(/id="performance-tab-content"/);
    expect(reports).toMatch(/id="sales-tab-content"/);
  });
});
