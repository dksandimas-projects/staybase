// Per MRB-12 (2026-08-03, per decision #179 — proposed):
// the Bookings table reservation row reads the `Reservation`
// header + the reservation-scope `paidAmount` aggregate
// instead of summing the filtered in-memory children. The
// previous behaviour silently dropped any child hidden by
// an active filter (e.g. `brt=` for a different room type
// inside an N>1 reservation). This file pins the new read
// path at the source level — the next reader cannot revert
// to child-sum without breaking the contract.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural test for the
// filter-hides-room bug ships with MRB-15 (the report-
// reconstruction property tests follow-up).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingsPage.tsx"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../src/context/AdminContext.tsx"),
  "utf8"
);

// Slice the row-builder out of the page source. The
// `groupedRows` useMemo is the only place the reservation
// row's `totalPrice` + `listReservationBalance` are
// computed; the slice keeps the test resilient to any other
// rewrite of the file.
const rowBuilderStart = bookingsPageSrc.indexOf("const sorted = [...group].sort(");
const rowBuilderEnd = bookingsPageSrc.indexOf("emitted.add(booking.id);\n\n      if (expandedReservationIds.has(reservationId))");
const rowBuilder =
  rowBuilderStart >= 0 && rowBuilderEnd > rowBuilderStart
    ? bookingsPageSrc.slice(rowBuilderStart, rowBuilderEnd)
    : "";

describe("MRB-12-01 — Bookings table reservation row reads the header, not the child sum", () => {
  it("AdminContext hydrates `reservations` from a `reservations` collection listener", () => {
    // The new state slot + listener pair.
    expect(adminContextSrc).toMatch(/const \[reservations, setReservations\] = useState<Reservation\[\]>\(\[\]\)/);
    expect(adminContextSrc).toMatch(/collection\(db, "reservations"\)/);
  });

  it("AdminContext exposes `reservations` + `reservationPaidAmount` in the context value", () => {
    // The interface declares them; the Provider passes them through.
    expect(adminContextSrc).toMatch(/reservations: Reservation\[\];/);
    expect(adminContextSrc).toMatch(/reservationPaidAmount: Record<string, number>;/);
    expect(adminContextSrc).toMatch(/\n        reservations,\n        reservationPaidAmount,/);
  });

  it("AdminContext aggregates the reservation-scope `paidAmount` from a `collectionGroup(\"payments\")` listener", () => {
    // The `reservations/{id}/payments/{paymentId}` path is matched
    // in JS; `bookings/{id}/payments/{paymentId}` (the legacy path)
    // is excluded by the regex anchor.
    expect(adminContextSrc).toMatch(/collectionGroup\(db, "payments"\)/);
    // The path regex literal (anchored on `reservations/.../payments/`).
    expect(adminContextSrc).toContain('match(/^reservations\\/([^/]+)\\/payments\\//)');
    // The sign-aware sum: positive amounts add, negative (refunds) subtract.
    expect(adminContextSrc).toMatch(/paidByReservation\[reservationId\] = \(paidByReservation\[reservationId\] \|\| 0\) \+ amount/);
  });

  it("BookingsPage builds a `reservationsMap` lookup for the row builder", () => {
    expect(bookingsPageSrc).toMatch(
      /const reservationsMap = useMemo\(\s*\(\) => new Map\(reservations\.map\(\(reservation\) => \[reservation\.id, reservation\]\)\),\s*\[reservations\]\s*\)/
    );
  });

  it("BookingsPage reservation row's `totalPrice` is read from the `Reservation` header, not the child sum", () => {
    expect(rowBuilder).toBeTruthy();
    if (!rowBuilder) return;
    // The new pattern: the reservation row reads `reservationHeader.totalPrice`
    // when the header is in memory. The previous bug summed filtered children.
    expect(rowBuilder).toMatch(/reservationHeader\s*\?\s*reservationHeader\.totalPrice/);
    // The header-sourced path is the primary; the child-sum stays only as
    // the cold-start race fallback when the listener hasn't fired yet.
    expect(rowBuilder).toMatch(
      /const reservationTotal = reservationHeader\s*\?\s*reservationHeader\.totalPrice\s*:\s*sorted\.reduce\(\(sum, child\) => sum \+ \(child\.totalPrice \|\| 0\), 0\)/
    );
  });

  it("BookingsPage reservation row's `listReservationBalance` is `header.totalPrice − paidAmount`, not the child sum", () => {
    expect(rowBuilder).toBeTruthy();
    if (!rowBuilder) return;
    // The new pattern: the reservation row reads
    // `Math.max(0, reservationHeader.totalPrice - paidAmount)` when the
    // header is in memory. The previous bug summed filtered children's
    // `getBookingFolio(child).balance` and silently dropped hidden children.
    expect(rowBuilder).toMatch(
      /const reservationBalance = reservationHeader\s*\?\s*Math\.max\(0, reservationHeader\.totalPrice - paidAmount\)/
    );
  });

  it("BookingsPage reservation row builder depends on `reservationsMap` and `reservationPaidAmount`", () => {
    // The dependency array must include the new state so the rows
    // re-render when the listener hydrates.
    const useMemoDeps = bookingsPageSrc.match(
      /}, \[filteredRows, bookingListIsGrouped, expandedReservationIds[^\]]*\]/
    );
    expect(useMemoDeps).toBeTruthy();
    if (!useMemoDeps) return;
    expect(useMemoDeps[0]).toMatch(/reservationsMap/);
    expect(useMemoDeps[0]).toMatch(/reservationPaidAmount/);
  });
});
