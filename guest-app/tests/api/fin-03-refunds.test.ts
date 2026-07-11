import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handler = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const router = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("FIN-03 refund API", () => {
  it("requires an admin approval and a reason", () => {
    expect(handler).toMatch(/handleAddRefund[\s\S]+?req\.staff\?\.role !== "admin"/);
    expect(handler).toMatch(/Refund method and reason are required/);
    expect(handler).toMatch(/approvedBy/);
  });

  it("uses a transaction and rejects refunds above net collections", () => {
    expect(handler).toMatch(/handleAddRefund[\s\S]+?runTransaction/);
    expect(handler).toMatch(/numericAmount > netCollected/);
    expect(handler).toMatch(/amount: -numericAmount/);
  });

  it("keeps all payment-ledger writes server-authoritative and immutable", () => {
    expect(router).toMatch(/action === "add-refund"[\s\S]+?authenticateStaff/);
    expect(rules).toMatch(/match \/payments\/\{paymentId\}[\s\S]+?allow create: if false/);
    expect(rules).toMatch(/allow update, delete: if false/);
  });
});
