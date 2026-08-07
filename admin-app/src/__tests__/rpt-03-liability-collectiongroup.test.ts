// RPT-03 (2026-08-07): three display + permissions fixes the
// admin "Reports" tab needed.
//
//   1. The Liability tab opened with
//      `collectionGroup(db, "refunds")` to project each
//      liability's live `processedAmount` — but the rules
//      file only had a nested per-doc rule for
//      `reservations/{id}/refunds/{id}`. Firestore needs
//      an explicit collectionGroup rule for cross-doc
//      queries, so staff got "Missing or insufficient
//      permissions" the moment the tab mounted. This test
//      pins the collectionGroup rule so a future cleanup
//      can't silently drop it again.
//
//   2. The Daily Close transactions ledger collapsed the
//      booking ref + the GCash / bank transaction ref into
//      a single "Ref" column and showed the booking ref.
//      For an audit log, the desk expects the *transaction*
//      ref (the GCash number, the bank slip number, etc.)
//      — same shape as the Sales/Reports tab's
//      separate `BOOKING` / `TRANSACTION REF` columns.
//      This test pins the two-column split so a future
//      refactor doesn't quietly re-collapse them.
//
//   3. The Sales/Reports bookings table rendered the
//      `recordedBy` field raw, so staff surfaced as their
//      Firebase Auth UID. The Daily Close ledger already
//      ran `recordedBy` through `staffNameMap` — the Sales
//      table just needed the same treatment. The test
//      pins the Sales table now also reads the map (and
//      that the map is plumbed into SalesTab as a prop).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("RPT-03 liability collectionGroup + report display fixes", () => {
  it("defines a staff-readable refunds collectionGroup rule", () => {
    // The collectionGroup rule MUST be present — direct-path
    // rules on `reservations/{id}/refunds/{id}` alone do
    // NOT cover `collectionGroup(db, "refunds")` queries.
    expect(rules).toMatch(/match \/\{path=\*\*\}\/refunds\/\{refundId\}/);
    expect(rules).toMatch(/match \/\{path=\*\*\}\/refunds\/\{refundId\}[\s\S]{0,200}allow read: if isStaff\(\);/);
  });

  it("keeps refunds write-protected at the client (server-authoritative only)", () => {
    // The collectionGroup rule MUST NOT widen write access.
    // Refunds are written exclusively by Admin SDK via
    // `/api/bookings/refund` (CRL-01 idempotency path).
    const cgBlock = rules.match(/match \/\{path=\*\*\}\/refunds\/\{refundId\}[\s\S]*?\n\s*\}\n/);
    expect(cgBlock, "expected a refunds collectionGroup block").toBeTruthy();
    expect(cgBlock?.[0]).toMatch(/allow update, delete: if false;/);
    expect(cgBlock?.[0]).not.toMatch(/allow create/);
  });

  it("Daily Close ledger exposes both Booking and Transaction Ref columns", () => {
    // Per RPT-03: the header now carries a Transaction
    // Ref column so the desk can match the audit row to
    // the GCash / bank slip. The legacy single "Ref"
    // column (which used to render the booking ref) is
    // gone.
    expect(reports).not.toMatch(
      /\["Ref", "Guest \/ Room", "Type", "Method", "Staff", "Amount"\]/
    );
    expect(reports).toMatch(
      /\["Booking", "Guest \/ Room", "Type", "Method", "Transaction Ref", "Staff", "Amount"\]/
    );
  });

  it("Daily Close ledger renders the actual transactionReference, not the booking ref", () => {
    // The Transaction Ref cell pulls from the joined
    // `payment.transactionReference` (or a graceful "—"
    // fallback). It must NOT be the same as the booking
    // ref cell.
    expect(reports).toMatch(/p\.transactionReference \|\| "—"/);
    // And the booking ref cell stays `p.bookingRef` (so
    // guest-facing booking refs are still one click away).
    expect(reports).toMatch(/\{p\.bookingRef\}/);
  });

  it("Daily Close ledger's empty-state row spans the new 7-column grid", () => {
    // Adding a Transaction Ref column widens the table
    // from 6 to 7 columns. The "no transactions" row
    // must update its colSpan to match, otherwise the
    // empty cell collapses to half-width.
    const dailyCloseColSpan = reports.match(/colSpan=\{7\} className="p-6 text-center text-gray-400"\>\s*No transactions recorded/);
    expect(
      dailyCloseColSpan,
      "Daily Close empty-state row should colSpan=7 to cover Booking · Guest/Room · Type · Method · Transaction Ref · Staff · Amount"
    ).toBeTruthy();
  });

  it("Sales/Reports table resolves staff names via staffNameMap (not raw UIDs)", () => {
    // The SalesTab bookings table must NOT render
    // `payment.recordedBy` raw — it needs to go through
    // the same `staffNameMap` the Daily Close ledger uses.
    expect(reports).toMatch(/staffNameMap\.get\(payment\.recordedBy\)/);
  });

  it("ReportsPage passes staffNameMap into the SalesTab component", () => {
    // The SalesTab was previously rendered without
    // `staffNameMap`, so the lookup above would have
    // thrown at render time. Pin the prop wiring.
    const salesMount = reports.match(/<SalesTab\s[\s\S]*?\/>/);
    expect(salesMount, "expected <SalesTab ... /> mount").toBeTruthy();
    expect(salesMount?.[0]).toMatch(/staffNameMap=\{staffNameMap\}/);
  });
});
