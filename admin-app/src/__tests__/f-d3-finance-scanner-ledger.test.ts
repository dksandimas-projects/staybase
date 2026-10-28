// F-D3 (handoff-2026-10-23 §6, Wave 3): the finance integrity scanner
// covered the pricing invariants and NONE of the ledger ones — it never
// read the `payments` / `refunds` / `charges` collections.
//
// WHY IT MATTERED
// ---------------
//   Running the scanner produced a clean-looking report and no money
//   finding. A reader took that as "the money is sound" — but the
//   script had never looked at the ledger at all.
//
// WHAT THIS TEST DOES
// -------------------
// It imports the scanner's REAL ledger functions and runs them against
// the production-shaped fixtures. It also pins that the scan loop
// actually READS the three collections — a function that exists but is
// never called would pass a unit test and change nothing.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Per F-D3 (2026-10-27): the test imports the PURE half of the
// scanner (`scripts/finance-scan-core.ts`), NOT the script itself.
//
// WHY: the script imports `firebase-admin` and `dotenv`, and the
// admin app declares NEITHER. The admin Vercel project installs only
// the `admin-app` workspace (rootDirectory=admin-app), so those two
// packages are absent there — and a static import of the script put
// it into the admin app's TypeScript program, which made EVERY admin
// deployment fail with:
//
//     error TS2307: Cannot find module 'firebase-admin/app'
//     error TS2307: Cannot find module 'firebase-admin/firestore'
//     error TS2307: Cannot find module 'dotenv'
//
// The production admin app therefore stayed on v2.21.9 while the
// guest app moved to v2.21.16. The pure core has NO imports, so it
// can never drag an undeclared package into an app build again.
//
// The source-text assertions below still read the SCRIPT, because the
// ledger SCAN LOOP lives there (the pure half is the rules; the
// script is the loop that reads Firestore).
import {
  scanLedgerRecord,
  scanRefundCoverage
} from "../../../scripts/finance-scan-core";

const scannerSrc = readFileSync(
  resolve(__dirname, "../../../scripts/finance-integrity-scan.ts"),
  "utf8"
);

describe("F-D3 — the finance integrity scanner must scan the LEDGER", () => {
  const known = new Set(["booking-1", "booking-2"]);

  // ── L1 / L2: an orphan entry ──────────────────────────────────
  it("flags a payment whose booking does not exist", () => {
    const findings = scanLedgerRecord(
      "payments",
      "bookings/ghost/payments/p1",
      { bookingId: "ghost", amount: 500 },
      known
    );
    expect(findings.length).toBe(1);
    expect(findings[0].cohort).toBe("ledger");
    expect(findings[0].findingId).toContain("orphan-booking-reference");
    expect(findings[0].proposedAction).toBe("manual-review");
    // Report-only: the scanner must never auto-repair the ledger.
    expect(findings[0].approved).toBe("NO");
  });

  it("flags a charge whose booking does not exist", () => {
    const findings = scanLedgerRecord(
      "charges",
      "charges/c1",
      { bookingId: "ghost", amount: 100 },
      known
    );
    expect(findings.some((f) => f.findingId.includes("orphan"))).toBe(true);
  });

  it("does NOT flag an entry that names a real booking", () => {
    const findings = scanLedgerRecord(
      "payments",
      "bookings/booking-1/payments/p1",
      { bookingId: "booking-1", amount: 500 },
      known
    );
    expect(findings).toEqual([]);
  });

  it("does NOT flag an entry with no bookingId at all (a store tender)", () => {
    const findings = scanLedgerRecord(
      "payments",
      "storeOrders/so1/payments/delivery-tender",
      { amount: 100, source: "store-order" },
      known
    );
    expect(findings).toEqual([]);
  });

  // ── L3: a corrupt amount ──────────────────────────────────────
  it("flags a non-finite amount", () => {
    const findings = scanLedgerRecord(
      "payments",
      "bookings/booking-1/payments/p2",
      { bookingId: "booking-1", amount: "not-a-number" },
      known
    );
    expect(findings.some((f) => f.findingId.includes("non-finite-amount"))).toBe(true);
  });

  it("flags a negative amount on a payment", () => {
    const findings = scanLedgerRecord(
      "payments",
      "bookings/booking-1/payments/p3",
      { bookingId: "booking-1", amount: -50 },
      known
    );
    expect(findings.some((f) => f.findingId.includes("negative-amount"))).toBe(true);
  });

  it("allows a negative amount on a REFUND (a refund is stored negative)", () => {
    const findings = scanLedgerRecord(
      "refunds",
      "bookings/booking-1/refunds/r1",
      { bookingId: "booking-1", amount: -100 },
      known
    );
    expect(findings.some((f) => f.findingId.includes("negative-amount"))).toBe(false);
  });

  // ── L4: a refund larger than the collection ────────────────────
  it("flags a refund larger than the money collected", () => {
    const findings = scanRefundCoverage("bookings/booking-1", 1000, 1500);
    expect(findings.length).toBe(1);
    expect(findings[0].findingId).toContain("refund-exceeds-collected");
    expect(findings[0].proposedAction).toBe("manual-review");
  });

  it("does NOT flag refunds that exactly match the collection", () => {
    expect(scanRefundCoverage("bookings/booking-1", 1000, 1000)).toEqual([]);
    expect(scanRefundCoverage("bookings/booking-1", 1000, 400)).toEqual([]);
  });

  // ── The scan loop ACTUALLY reads the ledger ───────────────────
  it("the scan loop reads the payments, refunds and charges collections", () => {
    expect(scannerSrc).toMatch(/collectionGroup\("payments"\)/);
    expect(scannerSrc).toMatch(/collectionGroup\("refunds"\)/);
    expect(scannerSrc).toMatch(/collection\("charges"\)/);
  });

  it("the ledger findings are wired into the reported findings", () => {
    // Each of the three ledger passes must push into `findings`.
    const ledgerPushes = scannerSrc.match(/findings\.push\(\s*\.\.\.scanLedgerRecord/g) || [];
    expect(ledgerPushes.length).toBeGreaterThanOrEqual(3);
    expect(scannerSrc).toMatch(/findings\.push\(\s*\.\.\.scanRefundCoverage/);
  });

  it("the scope is stated in the header, so the script cannot mislead a reader", () => {
    expect(scannerSrc).toMatch(/SCOPE \(per F-D3/);
    // ...and it points at the CONTINUOUS check that covers the ledger
    // every night.
    expect(scannerSrc).toMatch(/reconcile-production\.ts/);
  });
});
