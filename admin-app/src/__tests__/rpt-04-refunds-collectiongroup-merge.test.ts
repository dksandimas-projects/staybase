// RPT-04 (2026-08-11): Reports page was only subscribing to
// `collectionGroup(db, "payments")` — which catches legacy
// refunds (negative-amount entries on `bookings/{id}/payments/`)
// but MISSES every new-reservation refund (which lives at
// `reservations/{id}/refunds/{refundId}` per MRB-04 Phase 2.x /
// decision #159, the "both, as separate paths" design). The
// result: the "Refunds" KPI card, the per-method breakdown
// (cash / gcash / bank / card / paypal / other), the Daily Close
// transactions ledger, the per-booking receivables, and the
// full backup export all undercounted refunds for every
// post-MRB-01 reservation. `LiabilityTab` already used
// `collectionGroup(db, "refunds")` correctly (RPT-03 added the
// collectionGroup rule at `firestore.rules:475`); the main
// Reports page just didn't query it.
//
// This test pins the dual-collectionGroup subscription + the
// merge into the same `payments` array so a future cleanup
// can't silently drop the new-reservation refunds again.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("RPT-04 — Reports page reads refunds collectionGroup + merges with payments", () => {
  it("subscribes to BOTH `payments` and `refunds` collectionGroups", () => {
    // The `payments` subscription (legacy refunds + all
    // payments) stays. The new `refunds` subscription
    // catches `reservations/{id}/refunds/{refundId}`.
    expect(reports).toMatch(/onSnapshot\(collectionGroup\(db, "payments"\)/);
    expect(reports).toMatch(/onSnapshot\(collectionGroup\(db, "refunds"\)/);
  });

  it("keeps the existing `payments` collectionGroup rule for backwards compat (legacy refunds on `bookings/{id}/payments/`)", () => {
    // The legacy negative-amount refund entries on
    // `bookings/{id}/payments/{refundId}` are still
    // caught by the `payments` collectionGroup rule.
    // The new reservation refunds subcollection is
    // caught by the `refunds` collectionGroup rule
    // (RPT-03).
    expect(rules).toMatch(/match \/\{path=\*\*\}\/payments\/\{paymentId\}[\s\S]{0,200}allow read: if isStaff\(\);/);
    expect(rules).toMatch(/match \/\{path=\*\*\}\/refunds\/\{refundId\}[\s\S]{0,200}allow read: if isStaff\(\);/);
  });

  it("merges `rawRefunds` into the same `payments` array the consumer reads", () => {
    // The `payments` useMemo (consumed by `refundsTotal`,
    // the per-method breakdown, the Daily Close ledger,
    // the per-booking receivables) MUST include the
    // refunds collectionGroup rows. The merge is the
    // `[...rawPayments, ...rawRefunds].map(...)` shape
    // — pin the spread + the type guard so a future
    // refactor doesn't filter the refunds out.
    expect(reports).toMatch(/\[\.\.\.rawPayments, \.\.\.rawRefunds\]\.map\(/);
    // The merge must run BEFORE the bookingDisplayById
    // resolution — both arrays carry the same
    // `ReportPayment` shape so the resolution is
    // uniform. Pin the deps array so a future
    // accidental drop of `rawRefunds` from the deps
    // shows up as a test failure. Per RPT-07
    // (2026-08-19), the deps array now also carries
    // `reservationMetaById` for the reservation-level
    // payment fallback — the regex allows the deps
    // to grow while still pinning the required keys.
    expect(reports).toMatch(/\[rawPayments, rawRefunds, bookingDisplayById[^\]]*\]/);
  });

  it("resolves new-reservation refunds to the per-room child `bookingId` for display", () => {
    // Per MRB-04 Phase 2.x: the record carries
    // `data.bookingId` (stamped at write time per
    // `bookings.ts:7617`). The mapper uses
    // `data.bookingId` for the `reservations/...`
    // path and falls back to the path's parent
    // (the reservationId) only if a future write
    // path drops the stamp. The fallback handles
    // both shapes — pin the conditional so a future
    // refactor doesn't lose the bookingRef display.
    expect(reports).toMatch(
      /isReservationRefund\s*\?\s*\n?\s*String\(data\.bookingId \|\| parentDocumentId\)\s*\n?\s*:\s*\n?\s*parentDocumentId/
    );
  });

  it("full backup export also reads the refunds collectionGroup", () => {
    // The export's per-booking `bookings/{id}/payments/`
    // loop (line ~1411) only catches legacy refunds.
    // The export now ALSO does a
    // `getDocs(collectionGroup(db, "refunds"))` so
    // the spreadsheet has every refund row, not
    // just the legacy ones. Pin the read + the
    // `paymentRows.push({...})` so a future refactor
    // doesn't drop it.
    const exportBlock = reports.match(
      /runFullBackupExport = async \(\) => \{[\s\S]*?const wb = XLSX\.utils\.book_new\(\);/
    );
    expect(exportBlock, "expected the full backup export block").toBeTruthy();
    expect(exportBlock![0]).toMatch(/getDocs\(collectionGroup\(db, "refunds"\)\)/);
    // The new-reservation refunds must be pushed to
    // `paymentRows` (not a separate array) so the
    // existing "Payments" sheet in the workbook
    // shows every refund — no separate "Refunds"
    // sheet. Pin the push + the `Type: "refund"`
    // cell value + the `data.bookingId` lookup.
    expect(exportBlock![0]).toMatch(/paymentRows\.push\(\{[\s\S]*?Type: "refund"/);
    expect(exportBlock![0]).toMatch(/bookings\.find\(\(item\) => item\.id === bookingId\)/);
  });
});
