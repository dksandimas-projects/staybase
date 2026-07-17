import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("FIN-04 receivables", () => {
  it("computes each unpaid balance from the complete folio", () => {
    expect(reports).toMatch(/Number\(booking\.totalPrice \|\| 0\) \+ bookingCharges \+ addToBillTotal/);
    expect(reports).toMatch(/Math\.max\(billed - collected, 0\)/);
    expect(reports).toMatch(/\.filter\(\(row\) => row\.outstanding > 0\)/);
  });

  it("ages checked-out balances into standard buckets", () => {
    expect(reports).toMatch(/"Current" \| "1–30 days" \| "31–60 days" \| "60\+ days"/);
    expect(reports).toMatch(/booking\.status === "checked-out"/);
    expect(reports).toMatch(/ageDays <= 30/);
    expect(reports).toMatch(/ageDays <= 60/);
  });

  it("tracks Add-to-Bill and corporate receivables separately", () => {
    expect(reports).toMatch(/uncollectedAddToBill: Math\.min\(addToBillTotal, outstanding\)/);
    expect(reports).toMatch(/corporateReceivablesTotal/);
    expect(reports).toMatch(/Unassigned corporate account/);
  });

  it("provides searchable CSV and XLSX exports", () => {
    expect(reports).toMatch(/config\.hotelId\}_receivables_/);
    expect(reports).toMatch(/"Receivables"\)/);
    expect(reports).toMatch(/Receivables & Aging/);
  });

  it("persists a non-deletable corporate invoice register", () => {
    expect(reports).toMatch(/collection\(db, "corporateInvoices"\)/);
    expect(reports).toMatch(/bookingRefs: rows\.map/);
    expect(reports).toMatch(/status: "issued"/);
    expect(reports).toMatch(/paidAt: serverTimestamp\(\)/);
    expect(rules).toMatch(/match \/corporateInvoices\/\{invoiceId\}[\s\S]+?allow delete: if false/);
  });
});
