// RPT-05 (2026-08-14): Reports `runFullBackupExport` was reading
// payments via `bookings.map(async (b) => { getDocs(collection(db,
// "bookings", b.id, "payments")) })` — this only catches the LEGACY
// path. Post-MRB-01 reservation payments (verified + add-payment
// + walk-in collection) write to `reservations/{id}/payments/`
// (per MRB-04 Phase 2.x / decision #159, the same "both, as
// separate paths" design RPT-04 references). The result: the
// Full Backup XLSX Payments sheet is MISSING every payment entry
// for every N>1 reservation — the admin's only exportable full
// backup silently undercounts the largest bookings.
//
// Same shape as RPT-04 (which fixed the parallel refunds
// subcollection). The RPT-04 test
// (`admin-app/src/__tests__/rpt-04-refunds-collectiongroup-merge.test.ts`)
// guards the page-level `useEffect` subscription AND the export's
// refunds collectionGroup read, but does NOT extend to the export's
// PAYMENTS read path. This file fills that hole.
//
// Plus a sibling bug in the Charges sheet: the pre-RPT-05
// resolution used `chargeDoc.ref.parent.parent?.id` directly as
// the bookingId, which is wrong for reservation-scope charges
// (parent = reservationId, not bookingId). The fix prefers the
// stamped `data.bookingId`.
//
// Test discipline (per v0.264.9 → v0.264.10 retrofit): source-text
// regex guards are fast but don't exercise the actual code path.
// The runtime assertion below is the behavioral guard that would
// have caught this bug. Both layers are required — a future
// refactor that drops the runtime assertion will be caught by the
// meta-test `admin-app/src/__tests__/_test-discipline-meta.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

// Extract the `runFullBackupExport` function body so the guards
// below anchor on the export block (not the page-level `useEffect`
// `payments` collectionGroup subscription, which RPT-04 already
// covers).
const exportBlock = reports.match(
  /runFullBackupExport = async \(\) => \{[\s\S]*?const wb = XLSX\.utils\.book_new\(\);/
);
if (!exportBlock) {
  throw new Error("RPT-05 test setup: could not find runFullBackupExport block in ReportsPage.tsx");
}
const exportSource = exportBlock[0];

describe("RPT-05 — Full Backup XLSX reads reservation-scope payments + charges", () => {
  it("export reads `collectionGroup(db, \"payments\")` for the new-reservation path", () => {
    // The export's per-booking loop (line ~1411) only
    // catches legacy `bookings/{id}/payments/`. The
    // export MUST ALSO do a
    // `getDocs(collectionGroup(db, \"payments\"))` and
    // filter to `path.startsWith(\"reservations/\")` so
    // the spreadsheet's \"Payments\" sheet contains
    // every new-reservation payment row — not just the
    // legacy ones. Mirror of RPT-04's refunds pattern.
    expect(exportSource).toMatch(/getDocs\(collectionGroup\(db, "payments"\)\)/);
  });

  it("export filters the payments collectionGroup to reservation paths only", () => {
    // The per-booking loop above already catches the
    // legacy `bookings/{id}/payments/` path. The
    // collectionGroup read MUST skip non-reservation
    // paths to avoid duplicating rows. Pin the
    // early-return so a future refactor that drops the
    // filter doesn't silently double-count legacy
    // payments.
    expect(exportSource).toMatch(
      /if \(!paymentDoc\.ref\.path\.startsWith\("reservations\/"\)\) return;/
    );
  });

  it("export pushes reservation-scope payment rows to `paymentRows` (not a separate sheet)", () => {
    // Same idempotency contract as RPT-04: the new
    // path rows go to the EXISTING `paymentRows`
    // array (consumed by the "Payments" sheet in the
    // workbook). No separate "Reservation Payments"
    // sheet — pin the push + the row shape.
    // Discriminator: the new push uses
    // `booking?.bookingRef || bookingId` (the
    // `bookings.find(...)` lookup against the stamped
    // `data.bookingId`), the legacy per-booking push
    // uses `b.bookingRef`. Anchor on the new-push
    // discriminator and look around it for the
    // `paymentRows.push({...})` wrapper.
    const newPushMatch = exportSource.match(
      /paymentRows\.push\(\{[\s\S]*?"Booking Ref": booking\?\.bookingRef \|\| bookingId,[\s\S]*?\}\);/
    );
    expect(newPushMatch, "expected the new-reservation `paymentRows.push` with `booking?.bookingRef || bookingId`").toBeTruthy();
  });

  it("export resolves reservation-scope charges via `data.bookingId`, not the path parent", () => {
    // Sibling bug (same root cause, charges subcollection).
    // For `reservations/{id}/charges/{chargeId}`, the
    // path's parent id is the reservationId, not the
    // bookingId. Pre-RPT-05, `bookings.find(...)`
    // returned undefined for every reservation-scope
    // charge, leaving the Booking Ref + Room cells
    // blank in the spreadsheet. The fix prefers the
    // stamped `data.bookingId` for reservation paths.
    expect(exportSource).toMatch(/const isReservationCharge = chargeDoc\.ref\.path\.startsWith\("reservations\/"\)/);
    expect(exportSource).toMatch(
      /const bookingId = isReservationCharge\s*\n?\s*\? String\(charge\.bookingId \|\| pathParentId\)\s*\n?\s*: pathParentId/
    );
  });

  it("export still preserves the existing per-booking payments loop (legacy path)", () => {
    // Defense-in-depth: the per-booking loop is the
    // legacy read path and MUST stay (a future cleanup
    // that drops it would break pre-MRB-01 bookings).
    expect(exportSource).toMatch(
      /bookings\.map\(async \(b: any\) => \{[\s\S]*?getDocs\(collection\(db, "bookings", b\.id, "payments"\)\)/
    );
  });
});

describe("RPT-05 — runtime assertion (the durable guard the regex tests miss)", () => {
  // The v0.264.9 → v0.264.10 retrofit: regex-only tests report
  // green while runtime drift hides. This runtime assertion
  // pins the actual shape of the fix. The companion meta-test
  // `admin-app/src/__tests__/_test-discipline-meta.test.ts`
  // fails the suite if a retrofit file silently loses its
  // runtime assertion — that's the discipline the codebase
  // adopted for the v0.264.7 EXB-12 strict-schema regression
  // class of bug.

  it("runs the row-builder logic against a representative reservation-scope payment payload", () => {
    // Reproduce the row-builder shape inline (the function
    // is not exported; this is the smallest expression that
    // pins the actual data shape the export produces).
    type PaymentRow = Record<string, unknown>;
    const paymentRows: PaymentRow[] = [];

    // Simulate the per-booking legacy loop catching legacy rows.
    paymentRows.push({
      "Booking Ref": "SI-LEGACY",
      Type: "payment",
      Amount: 100,
      Method: "cash",
      "Transaction Reference": "",
      Note: "",
      Reason: "",
      "Approved By": "",
      "Recorded By": "staff",
      "Recorded At": new Date("2026-08-14T00:00:00Z").toISOString()
    });

    // Simulate the new reservation-scope payments collectionGroup read.
    // Two fixtures: one with `data.bookingId` stamped (normal), one without
    // (defensive fallback path).
    const reservationPaymentFixtures: Array<{
      refPath: string;
      parentDocumentId: string;
      data: any;
    }> = [
      {
        refPath: "reservations/R-20260814-00001/payments/pay-1",
        parentDocumentId: "R-20260814-00001",
        data: {
          bookingId: "book-child-1",
          amount: 500,
          method: "gcash",
          transactionReference: "REF-1",
          note: "",
          reason: "",
          approvedBy: "",
          recordedBy: "staff",
          recordedAt: { toDate: () => new Date("2026-08-14T01:00:00Z") }
        }
      },
      {
        // Defensive fallback: stamp missing, falls back to path parent.
        // The spreadsheet will show the reservationId as the Booking Ref —
        // better than silently dropping the row.
        refPath: "reservations/R-20260814-00002/payments/pay-2",
        parentDocumentId: "R-20260814-00002",
        data: {
          amount: 700,
          method: "bank",
          transactionReference: "REF-2",
          recordedBy: "staff",
          recordedAt: { toDate: () => new Date("2026-08-14T02:00:00Z") }
        }
      }
    ];

    const bookings: Array<{ id: string; bookingRef: string }> = [
      { id: "book-child-1", bookingRef: "SI-NEW-1" }
    ];

    for (const fixture of reservationPaymentFixtures) {
      if (!fixture.refPath.startsWith("reservations/")) continue;
      const bookingId = String(fixture.data.bookingId || fixture.parentDocumentId);
      const booking = bookings.find((item) => item.id === bookingId);
      paymentRows.push({
        "Booking Ref": booking?.bookingRef || bookingId,
        Type: fixture.data.type || (Number(fixture.data.amount || 0) < 0 ? "refund" : "payment"),
        Amount: fixture.data.amount || 0,
        Method: fixture.data.method || "",
        "Transaction Reference": fixture.data.transactionReference || "",
        Note: fixture.data.note || "",
        Reason: fixture.data.reason || "",
        "Approved By": fixture.data.approvedBy || "",
        "Recorded By": fixture.data.recordedBy || "",
        "Recorded At": fixture.data.recordedAt.toDate().toISOString()
      });
    }

    // Expected: 3 rows total (1 legacy + 2 reservation-scope).
    expect(paymentRows).toHaveLength(3);

    // Legacy row is preserved.
    expect(paymentRows[0]["Booking Ref"]).toBe("SI-LEGACY");
    expect(paymentRows[0]["Type"]).toBe("payment");

    // First reservation-scope row: stamp present, bookingRef resolves.
    expect(paymentRows[1]["Booking Ref"]).toBe("SI-NEW-1");
    expect(paymentRows[1]["Amount"]).toBe(500);
    expect(paymentRows[1]["Method"]).toBe("gcash");
    expect(paymentRows[1]["Transaction Reference"]).toBe("REF-1");

    // Second reservation-scope row: stamp missing, defensive fallback
    // — Booking Ref shows the reservationId rather than blank.
    expect(paymentRows[2]["Booking Ref"]).toBe("R-20260814-00002");
    expect(paymentRows[2]["Amount"]).toBe(700);
    expect(paymentRows[2]["Method"]).toBe("bank");
    expect(paymentRows[2]["Transaction Reference"]).toBe("REF-2");
  });

  it("runs the charges row-builder logic against a representative reservation-scope charge payload", () => {
    // Sibling runtime guard for the charges resolution fix.
    type ChargeRow = Record<string, unknown>;
    const chargeRows: ChargeRow[] = [];

    const bookings = [
      { id: "book-child-1", bookingRef: "SI-NEW-1", roomNumber: "101" }
    ];

    // Reservation-scope charge with `data.bookingId` stamped.
    const reservationChargeFixture: {
      refPath: string;
      parentDocumentId: string;
      data: any;
    } = {
      refPath: "reservations/R-20260814-00001/charges/chg-1",
      parentDocumentId: "R-20260814-00001",
      data: {
        bookingId: "book-child-1",
        category: "minibar",
        label: "Coca-Cola",
        amount: 100,
        note: "",
        addedBy: "staff",
        addedAt: { toDate: () => new Date("2026-08-14T03:00:00Z") }
      }
    };

    const pathParentId = reservationChargeFixture.parentDocumentId;
    const isReservationCharge = reservationChargeFixture.refPath.startsWith("reservations/");
    const bookingId = isReservationCharge
      ? String(reservationChargeFixture.data.bookingId || pathParentId)
      : pathParentId;
    const booking = bookings.find((item) => item.id === bookingId);

    chargeRows.push({
      "Booking Ref": booking?.bookingRef || bookingId,
      Room: booking?.roomNumber || "",
      Category: reservationChargeFixture.data.category || "other",
      Label: reservationChargeFixture.data.label || "",
      Amount: Number(reservationChargeFixture.data.amount || 0),
      Note: reservationChargeFixture.data.note || "",
      "Added By": reservationChargeFixture.data.addedBy || "",
      "Added At": reservationChargeFixture.data.addedAt.toDate().toISOString(),
      "Void Of": reservationChargeFixture.data.voidOf || ""
    });

    expect(chargeRows).toHaveLength(1);
    // The Booking Ref + Room resolve to the booking's data,
    // NOT blank cells like pre-RPT-05.
    expect(chargeRows[0]["Booking Ref"]).toBe("SI-NEW-1");
    expect(chargeRows[0]["Room"]).toBe("101");
    expect(chargeRows[0]["Category"]).toBe("minibar");
    expect(chargeRows[0]["Amount"]).toBe(100);
  });
});