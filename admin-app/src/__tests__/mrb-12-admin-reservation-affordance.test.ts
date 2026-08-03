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

describe("MRB-12-02..05 — row + drawer affordances + discount scope", () => {
  it("`BookingListRow` carries `listReservationHeader` + `listReservationPaidAmount` so the Status column can read the aggregate without a second lookup", () => {
    // The row builder attaches the header so MRB-12-02's
    // `renderReservationPaymentStatusPill` reads from the row,
    // not a separate `useMemo` keyed on the row's id.
    expect(bookingsPageSrc).toMatch(/listReservationHeader\?: Reservation;/);
    expect(bookingsPageSrc).toMatch(/listReservationPaidAmount\?: number;/);
    // The row builder populates both fields. Slice the
    // reservation-row push block and assert both keys land
    // there.
    const rowBuilder = bookingsPageSrc.match(
      /rows\.push\(\{[\s\S]*?id: `reservation_\$\{reservationId\}`[\s\S]*?\}\);/
    );
    expect(rowBuilder, "expected the reservation row's `rows.push` block").toBeTruthy();
    if (!rowBuilder) return;
    expect(rowBuilder[0]).toMatch(/listReservationHeader: reservationHeader/);
    expect(rowBuilder[0]).toMatch(/listReservationPaidAmount: paidAmount/);
  });

  it("MRB-12-02: the reservation row's Status column renders the aggregate `paymentStatus` pill (not the legacy `Mixed` chip)", () => {
    // The new pill helper maps each `ReservationPaymentStatus`
    // value to a tone + label and surfaces the outstanding
    // amount when the group is not settled.
    expect(bookingsPageSrc).toMatch(/renderReservationPaymentStatusPill/);
    expect(bookingsPageSrc).toMatch(/"Awaiting"/);
    expect(bookingsPageSrc).toMatch(/"Verified"/);
    expect(bookingsPageSrc).toMatch(/"Confirmed"/);
    expect(bookingsPageSrc).toMatch(/"Cancelled"/);
    // The pill is rendered when the header is present; the
    // legacy "Mixed" chip is the cold-start fallback only.
    expect(bookingsPageSrc).toMatch(/renderReservationPaymentStatusPill\(\s*row\.listReservationHeader\.paymentStatus/);
  });

  it("MRB-12-02: the reservation row renders a `X cancelled` chip when `cancelledRoomCount > 0`", () => {
    expect(bookingsPageSrc).toMatch(/row\.listReservationHeader\.cancelledRoomCount > 0/);
    expect(bookingsPageSrc).toMatch(/cancelledRoomCount\} cancelled/);
    // The chip's tooltip lists the cancelled room numbers.
    expect(bookingsPageSrc).toMatch(/Cancelled rooms in this reservation/);
    expect(bookingsPageSrc).toMatch(/Room \$\{child\.roomNumber\}/);
  });

  it("MRB-12-03: the drawer reservation strip shows the reservation-scope Total / Paid / Balance pills", () => {
    // The pills are inside `selectedReservationContext` and
    // read from the `Reservation` header + the
    // reservation-scope paid-amount aggregate.
    expect(bookingsPageSrc).toMatch(/data-testid="reservation-strip-money"/);
    expect(bookingsPageSrc).toMatch(/aria-label="Reservation money"/);
    // The Total pill reads `reservationHeader.totalPrice`; the
    // Paid pill reads the `reservationPaidAmount` aggregate; the
    // Balance pill is `Math.max(0, total - paid)`.
    expect(bookingsPageSrc).toMatch(/reservationHeader\s*\?\s*reservationHeader\.totalPrice/);
    expect(bookingsPageSrc).toMatch(/reservationBalance = Math\.max\(0, reservationTotal - reservationPaid\)/);
  });

  it("MRB-12-04: the `Apply discount` action carries the `renderActionScope(\"room\")` chip", () => {
    // The discount action is per-room by default; the chip is
    // informational so the desk sees the scope before opening
    // the modal. Slice the button block so a comment between
    // the label and the chip expression does not break the
    // assertion.
    const applyDiscountButton = bookingsPageSrc.match(
      /setShowDiscountForm\(true\); \}\}[\s\S]*?Apply discount[\s\S]*?\{renderActionScope\("room"\)\}/
    );
    expect(applyDiscountButton, "Apply discount must carry the scope chip").toBeTruthy();
  });

  it("MRB-12-05: the discount form has a `This room` / `All N rooms` segmented control mirroring the MRB-13 cancel-modal", () => {
    // The state + the selector markup.
    expect(bookingsPageSrc).toMatch(
      /const \[staffDiscountScope, setStaffDiscountScope\] = useState<"room" \| "reservation" \| null>\(null\)/
    );
    expect(bookingsPageSrc).toMatch(/data-testid="staff-discount-scope-selector"/);
    expect(bookingsPageSrc).toMatch(/data-testid="staff-discount-scope-room"/);
    expect(bookingsPageSrc).toMatch(/data-testid="staff-discount-scope-reservation"/);
    // The submit loop calls `apply-discount` for every room
    // when the scope is "reservation".
    expect(bookingsPageSrc).toMatch(
      /scope === "reservation" && selectedReservationContext\s*\?\s*selectedReservationContext\.rooms\.map\(\(room\) => room\.id\)\s*:\s*\[selectedBooking\.id\]/
    );
    // The "all rooms" submit button label + toast surface the
    // reservation scope so the desk sees what was applied.
    expect(bookingsPageSrc).toMatch(/Apply to all \$\{selectedReservationContext\.roomCount\} rooms/);
    expect(bookingsPageSrc).toMatch(/Reservation repriced \(\$\{targetIds\.length\} rooms\)/);
  });

  it("MRB-12-05: the discount form's scope state resets to `null` on close (mirroring the MRB-13 cancel-modal reset)", () => {
    // The `onClose` handler resets the scope so a previous
    // session's choice never bleeds into a new one.
    expect(bookingsPageSrc).toMatch(
      /setShowDiscountForm\(false\);\s*\/\/ Per MRB-12[\s\S]*?setStaffDiscountScope\(null\);/
    );
  });
});

describe("MRB-14 — AdminContext hydrates `actualDateRange` from the `reservations` listener", () => {
  it("the reservations listener maps the `actualDateRange` field onto the `Reservation` shape", () => {
    // The hydration must defensively coerce the
    // `earliestCheckIn` / `latestCheckOut` fields
    // (Firestore `Timestamp` or ISO `string`) and
    // return `null` for missing + invalid values.
    // Pre-MRB-14 reservations (no field) fall through
    // to the `null` branch and the admin surfaces
    // read the children's per-child dates directly.
    expect(adminContextSrc).toMatch(/actualDateRange: \(\(\) => \{/);
    expect(adminContextSrc).toMatch(
      /const earliestCheckIn = parseDateOrNull\(raw\.earliestCheckIn\)/
    );
    expect(adminContextSrc).toMatch(
      /const latestCheckOut = parseDateOrNull\(raw\.latestCheckOut\)/
    );
    expect(adminContextSrc).toMatch(/isDivergent: Boolean\(raw\.isDivergent\)/);
  });
});
