// RPT-07 (2026-08-19): the Reports page's `payments` join
// now consults a `reservationMetaById` map (built from
// AdminContext's `reservations` slice) as a fallback for
// reservation-level payment rows. The RPT-06 fix routed
// those rows through `data.bookingId || parentDocumentId`,
// but `data.bookingId` is `null` for reservation-level
// payments (per the MRB-04 Phase 2.x attribution contract
// at `bookings.ts:7638-7640` — *"per-room attribution —
// `null` for reservation-level payments"*). The
// per-room `bookingDisplayById.get(bookingId)` lookup
// misses (the `parentDocumentId` for a reservation-scope
// payment is the reservationId, not a booking doc id) and
// the RPT-06 fallback to `payment.bookingId` would still
// render the raw `reservationId` UUID in the Daily Close
// Transactions Ledger's "Booking" column. The reservation
// map provides the public `R-YYYYMMDD-NNNNN` ref + the
// lead guest name so the column renders a human-readable
// ref like `R-20260819-00001` + the lead guest's name in
// the `GUEST / ROOM` column.
//
// This test pins the fallback shape so a future refactor
// can't silently drop the reservation-level routing and
// re-break the display.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("RPT-07 — Reports payments join falls through to reservation metadata for reservation-level rows", () => {
  it("pulls `reservations` from the AdminContext (no new collectionGroup read)", () => {
    // The AdminContext's `subscribeToReservations`
    // listener (per MRB-12) already hydrates the
    // `reservations` slice with `id` + `reservationRef`
    // + `leadGuestName`. The Reports page just consumes
    // it via `useAdmin()` — no new Firestore read, no
    // duplicated subscription. Pin the destructure so
    // a future cleanup can't silently drop the data
    // source. (The literal `reservations,` token is
    // what we're guarding — comments between
    // destructure keys don't count.)
    expect(reports).toMatch(/\breservations\s*,/);
  });

  it("builds a `reservationMetaById` map from the reservations slice", () => {
    // The map shape mirrors the `bookingDisplayById`
    // map at `ReportsPage.tsx:440-448` — keyed by the
    // doc id, carrying the human-readable ref + the
    // lead guest name. The downstream join does a
    // single `.get(payment.bookingId)` against either
    // map; the bookingId for a reservation-level
    // payment is exactly the reservationId after the
    // RPT-06 routing, so the same key works for both.
    expect(reports).toMatch(/reservationMetaById\s*=\s*useMemo\(\(\)\s*=>\s*\{/);
    expect(reports).toMatch(/reservations\.forEach\(\(r\)\s*=>\s*map\.set\(r\.id,\s*\{/);
    expect(reports).toMatch(/reservationRef:\s*r\.reservationRef\s*\|\|/);
    expect(reports).toMatch(/leadGuestName:\s*r\.leadGuestName\s*\|\|/);
  });

  it("falls through to `reservationMeta.reservationRef` when the per-room `bookingDisplayById` lookup misses", () => {
    // The RPT-06 fix only handles per-room payment
    // rows. For reservation-level rows
    // (`data.bookingId: null`), the per-room
    // `bookingDisplayById.get(bookingId)` lookup
    // misses — the join must consult the reservation
    // map and render the public `R-` ref. Pin the
    // fallback chain so the `R-` ref shape can't
    // silently regress to a raw UUID.
    expect(reports).toMatch(
      /bookingRef:\s*display\?\.bookingRef\s*\|\|\s*reservationMeta\?\.reservationRef\s*\|\|\s*payment\.bookingId/
    );
  });

  it("falls through to `reservationMeta.leadGuestName` for the `guestName` column", () => {
    // The `GUEST / ROOM` column for a
    // reservation-level payment row should render
    // the lead guest's name (from the reservation
    // header, per the MRB-02 contract) instead of
    // falling through to an empty cell. Pin the
    // fallback so the column doesn't go blank.
    expect(reports).toMatch(
      /guestName:\s*display\?\.guestName\s*\|\|\s*reservationMeta\?\.leadGuestName\s*\|\|/
    );
  });

  it("only consults the reservation map when the per-room lookup missed", () => {
    // The `!display ? reservationMetaById.get(...) : null`
    // guard prevents a per-room bookingId that
    // happens to match a reservationId from being
    // shadowed by the reservation map. (In practice
    // the id shapes differ — bookings use Firestore
    // auto-id 20 chars, reservations use RFC4122
    // UUID 36 chars — so a collision is impossible,
    // but the explicit guard is the right shape
    // anyway.) Pin it so a future refactor that
    // drops the guard doesn't accidentally re-order
    // the precedence.
    expect(reports).toMatch(
      /const\s+reservationMeta\s*=\s*display\s*\?\s*null\s*:\s*reservationMetaById\.get\(/
    );
  });

  it("includes `reservationMetaById` in the `payments` useMemo deps", () => {
    // The join re-runs when the reservations slice
    // updates (e.g. a new reservation lands, a
    // header is edited). Pin the dep so a future
    // accidental drop of `reservationMetaById` from
    // the deps shows up as a test failure — same
    // shape as the RPT-04 dep pin (now relaxed to
    // `bookingDisplayById[^\]]*\]` to allow this
    // addition without a re-pin).
    expect(reports).toMatch(/\[rawPayments,\s*rawRefunds,\s*bookingDisplayById,\s*reservationMetaById\]/);
  });
});
