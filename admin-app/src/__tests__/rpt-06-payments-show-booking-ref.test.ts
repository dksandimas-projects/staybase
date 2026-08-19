// RPT-06 (2026-08-19): The Reports page's `payments`
// collectionGroup listener at `ReportsPage.tsx:306-356` was
// only falling back to the path's parent (`parentDocumentId`)
// for the `bookingId` it uses in the display lookup. Post-MRB-01
// payments live at `reservations/{id}/payments/{id}` (per
// MRB-04 Phase 2, decision #159), so the parent of the payment
// doc is the reservationId (a UUID) — not the per-room
// `bookingId` that the `bookingDisplayById` map keys on. The
// `display?.bookingRef || payment.bookingId` resolution then
// fell through to the reservationId UUID, which the user saw as
// a raw GUID in the Daily Close Transactions Ledger's "Booking"
// column. The `GUEST / ROOM` column was empty for the same
// reason (the display map lookup missed, the roomNumber /
// guestName fallbacks fired). The refunds listener (added in
// RPT-04) already had the correct `isReservationRefund` +
// `data.bookingId` pattern; this fix mirrors it for the
// payments listener.
//
// This test pins the conditional so a future refactor can't
// silently drop the `data.bookingId` fallback and re-break the
// display.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("RPT-06 — Reports payments handler resolves reservations/... to per-room bookingId", () => {
  it("detects reservation-scope payments via the `reservations/...` path prefix", () => {
    // The mapper must check the payment doc's path
    // (not just `data.source` or any field) so the
    // reservation-scope payments at
    // `reservations/{id}/payments/{id}` are routed
    // through the `data.bookingId` fallback. Pin the
    // exact `startsWith("reservations/")` check so a
    // future cleanup can't silently drop it.
    expect(reports).toMatch(/paymentDoc\.ref\.path\.startsWith\(\s*["']reservations\/["']\s*\)/);
  });

  it("uses `data.bookingId` for the display `bookingId` when the payment is reservation-scope", () => {
    // The conditional mirrors the refunds handler's
    // pattern (RPT-04 / `rpt-04-refunds-collectiongroup-
    // merge.test.ts:65-78`). For a reservation-scope
    // payment, `data.bookingId` is the per-room
    // attribution (stamped at write time per
    // `bookings.ts:7647`) — the display lookup keys on
    // it. The fallback to the path's parent fires only
    // if a future write path drops the stamp (current
    // production data has it on every new-reservation
    // payment, per RPT-04's identical test for refunds).
    expect(reports).toMatch(
      /isReservationPayment\s*\?\s*\n?\s*String\(data\.bookingId \|\| parentDocumentId\)\s*\n?\s*:\s*\n?\s*parentDocumentId/
    );
  });

  it("keeps the legacy `bookings/{id}/payments/{id}` path on `parentDocumentId`", () => {
    // Pre-MRB-01 bookings (and any booking that lives
    // directly under `bookings/...` with no
    // reservation header) still resolve the `bookingId`
    // from the path's parent — `data.bookingId` is not
    // stamped on those, and the legacy path is the only
    // signal the display has. Pin the ternary so the
    // `else` arm survives any future refactor.
    expect(reports).toMatch(
      /isReservationPayment\s*\?\s*String\(data\.bookingId \|\| parentDocumentId\)\s*:\s*parentDocumentId/
    );
  });

  it("keeps store-tender payments outside the booking-folio sum (no regression)", () => {
    // Store tenders are reconciled as direct-paid
    // store charges and must not settle the guest's
    // room bill. They use the `store:{sourceId}`
    // synthetic id so they're excluded from
    // `bookingDisplayById` lookups. Pin the existing
    // `isStoreTender ? \`store:${sourceId}\` : ...`
    // branch so the RPT-06 fix doesn't accidentally
    // route store tenders through the reservation
    // check.
    expect(reports).toMatch(/isStoreTender\s*\?\s*`store:\$\{sourceId\}`/);
  });
});
