import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const reports = readFileSync(resolve(root, "admin-app/src/pages/ReportsPage.tsx"), "utf8");
const context = readFileSync(resolve(root, "admin-app/src/context/AdminContext.tsx"), "utf8");
const bookings = readFileSync(resolve(root, "admin-app/src/pages/BookingsPage.tsx"), "utf8");
const router = readFileSync(resolve(root, "guest-app/server/apiRouter.ts"), "utf8");

describe("FL-05 direct-paid store reconciliation", () => {
  it("routes delivery through a staff-authenticated server mutation", () => {
    expect(context).toMatch(/status === "delivered"[\s\S]*?\/api\/store\/deliver-order/);
    expect(router).toMatch(/action === "deliver-order"[\s\S]*?authenticateStaff\(req\)[\s\S]*?handleDeliverStoreOrder/);
    expect(bookings).toMatch(/await updateStoreOrderStatus\(selectedOrder\.id, "delivered"\)/);
    expect(bookings).toMatch(/toast\.error\("Could not complete delivery"/);
  });

  it("includes store tenders in the shared collection-group ledger", () => {
    expect(reports).toMatch(/data\.source === "store-order"/);
    expect(reports).toMatch(/bookingId: isStoreTender \? `store:\$\{sourceId\}` : parentDocumentId/);
    expect(reports).toMatch(/rangePayments\.reduce\(\(sum, payment\) => sum \+ payment\.amount, 0\)/);
  });

  it("keeps direct store tenders outside booking folio payment sums", () => {
    expect(reports).toMatch(/if \(payment\.source === "store-order"\)/);
    expect(reports).toMatch(/payments\.filter\(\(payment\) => payment\.bookingId === booking\.id\)/);
  });

  it("recognizes store revenue on the delivery timestamp", () => {
    expect(context).toMatch(/deliveredAt: data\.deliveredAt \? formatStoreDate\(data\.deliveredAt\) : null/);
    expect(reports).toMatch(/o\.status === "delivered" \? \(o\.deliveredAt \|\| o\.createdAt\) : o\.createdAt/);
    expect(reports).toMatch(/toDate\(o\.deliveredAt \|\| o\.createdAt\)/);
  });
});
