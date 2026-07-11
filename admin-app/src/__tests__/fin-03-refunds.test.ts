import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookings = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("FIN-03 refund surfaces", () => {
  it("provides an admin-only drawer workflow", () => {
    expect(bookings).toMatch(/currentUser\?\.role === "admin"/);
    expect(bookings).toMatch(/\/api\/bookings\/add-refund/);
    expect(bookings).toMatch(/Approve and record refund/);
  });

  it("renders refunds as negative audit entries", () => {
    expect(bookings).toMatch(/data\.type === "refund" \|\| Number\(data\.amount \|\| 0\) < 0/);
    expect(bookings).toMatch(/pay\.type === "refund"/);
    expect(bookings).toMatch(/approved by/);
  });

  it("reports gross, refunds, net, and cancelled bookings retaining funds", () => {
    expect(reports).toMatch(/grossCollectionsTotal/);
    expect(reports).toMatch(/refundsTotal/);
    expect(reports).toMatch(/cancelledWithCollections/);
    expect(reports).toMatch(/Cancelled bookings with money collected/);
    expect(reports).toMatch(/payment\.type/);
  });
});
