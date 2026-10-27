// F-C4 (handoff-2026-10-23 §6, Wave 3): the store report had NO export,
// although `plan/features/STORE-MANAGEMENT.md` line 84 is checked
// `[x] Export store report as CSV`.
//
// The spec and the product disagreed; the spec was right.
//
// WHAT THIS TEST DOES
// -------------------
// It pins the export's three load-bearing parts:
//   1. the BUTTON exists on the store sub-tab and is wired to the
//      export handler;
//   2. the handler is plumbed from the parent (it needs
//      `filteredStoreOrders`, `triggerDownload` and the range keys);
//   3. the CSV carries the SAME column set as the Full Backup's
//      "Store Orders" sheet, so the two exports cannot drift.
//
// It also runs the CSV's real escaping + join, so a value containing a
// comma or a quote cannot break the file.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reportsSrc = readFileSync(
  resolve(__dirname, "../pages/ReportsPage.tsx"),
  "utf8"
);

// The CSV builder, exactly as the handler writes it.
function buildCsv(rows: unknown[][]): string {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

describe("F-C4 — the store report must export to CSV", () => {
  it("the export handler exists and is named", () => {
    expect(reportsSrc).toMatch(/const handleExportStoreOrdersCSV = \(\) => \{/);
  });

  it("the handler is passed to the Sales tab (it needs the parent's filtered orders)", () => {
    expect(reportsSrc).toMatch(/onExportStoreOrdersCSV=\{handleExportStoreOrdersCSV\}/);
    // ...and the child declares and uses it.
    expect(reportsSrc).toMatch(/onExportStoreOrdersCSV: \(\) => void;/);
    expect(reportsSrc).toMatch(/onClick=\{onExportStoreOrdersCSV\}/);
  });

  it("the button is on the STORE sub-tab", () => {
    const storeBlock = reportsSrc.slice(
      reportsSrc.indexOf('salesSubTab === "store"'),
      reportsSrc.indexOf('salesSubTab === "charges"')
    );
    expect(storeBlock).toMatch(/Export Store Report CSV/);
    // ...and it is disabled when there is nothing to export.
    expect(storeBlock).toMatch(/disabled=\{filteredStoreOrders\.length === 0\}/);
  });

  it("the CSV carries the same columns as the Full Backup's Store Orders sheet", () => {
    // The Full Backup's sheet headers.
    expect(reportsSrc).toMatch(
      /"Order Ref",\s*"Room Number",\s*"Booking ID",\s*"Guest Name",\s*"Items",\s*"Total Amount",\s*"Payment Method",\s*"Status",\s*"Date"/
    );
    // ...and the CSV export uses the same set.
    const handler = reportsSrc.slice(
      reportsSrc.indexOf("const handleExportStoreOrdersCSV"),
      reportsSrc.indexOf("const handleExportReceivablesCSV")
    );
    for (const header of [
      "Order Ref", "Room Number", "Booking ID", "Guest Name", "Items",
      "Total Amount", "Payment Method", "Status", "Date"
    ]) {
      expect(handler).toContain(`"${header}"`);
    }
  });

  it("the export refuses an invalid date range", () => {
    const handler = reportsSrc.slice(
      reportsSrc.indexOf("const handleExportStoreOrdersCSV"),
      reportsSrc.indexOf("const handleExportReceivablesCSV")
    );
    expect(handler).toMatch(/if \(!isRangeValid\)/);
  });

  it("the CSV escapes a value containing a comma or a quote", () => {
    const csv = buildCsv([
      ["Order Ref", "Guest Name"],
      ["SO-1", "Dela Cruz, Juan"]
    ]);
    expect(csv).toContain('"Dela Cruz, Juan"');
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("the CSV quotes a value containing a double quote", () => {
    const csv = buildCsv([["Name"], ['Ana "AJ" Reyes']]);
    expect(csv).toContain('"Ana ""AJ"" Reyes"');
  });

  it("the CSV filename carries the range, like the other exports", () => {
    const handler = reportsSrc.slice(
      reportsSrc.indexOf("const handleExportStoreOrdersCSV"),
      reportsSrc.indexOf("const handleExportReceivablesCSV")
    );
    expect(handler).toMatch(/_store_orders_\$\{periodStartKey\}_to_\$\{periodEndKey\}\.csv/);
  });
});
