import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookings = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("FIN-14 incidental charge ledger", () => {
  it("keeps charges append-only and voids with reversal entries", () => {
    expect(rules).toMatch(/match \/charges\/\{chargeId\}[\s\S]+?allow read: if isStaff\(\);[\s\S]+?allow create: if isStaff\(\)[\s\S]+?allow update, delete: if false;/);
    expect(rules).toMatch(/request\.resource\.data\.addedAt == request\.time/);
    expect(rules).toMatch(/\.data\.amount == -request\.resource\.data\.amount/);
    expect(rules).toMatch(/chargeId == "void-" \+ request\.resource\.data\.voidOf/);
    expect(rules).toMatch(/request\.resource\.data\.amount <= 1000000/);
    expect(rules).toMatch(/request\.resource\.data\.amount >= -1000000/);
    expect(bookings).toMatch(/amount: -Math\.abs\(chargeToVoid\.amount\)/);
    expect(bookings).toMatch(/voidOf: chargeToVoid\.id/);
    expect(bookings).toMatch(/`void-\$\{chargeToVoid\.id\}`/);
    expect(bookings).not.toMatch(/deleteDoc\([\s\S]*charges/);
    expect(bookings).toMatch(/amount > 1_000_000/);
    expect(bookings).toMatch(/max="1000000"/);
  });

  it("includes net charges in folio, checkout, and receipt math", () => {
    expect(bookings).toMatch(/chargesTotal = charges\.reduce\(\(sum, charge\) => sum \+ charge\.amount, 0\)/);
    expect(bookings).toMatch(/grandTotal = booking\.totalPrice \+ storeTotal \+ chargesTotal/);
    expect(bookings).toMatch(/receiptFolio\.grandTotal - paymentsTotal/);
    expect(bookings).toMatch(/Print receipt PDF/);
  });

  it("adds incidentals to sales reporting and both XLSX exports", () => {
    expect(reports).toMatch(/collectionGroup\(db, "charges"\)/);
    expect(reports).toMatch(/totalRevenue = roomRevenue \+ breakfastRevenue \+ storeRevenue \+ incidentalRevenue/);
    expect(reports).toMatch(/dataKey="incidentals"/);
    expect(reports).toMatch(/"Incidental Revenue", incidentalRevenue/);
    expect((reports.match(/"Charges"\)/g) || [])).toHaveLength(2);
  });
});
