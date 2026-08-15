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
    // Per BAR-02 (2026-08-08, per decision #203): the
    // `paymentStatus` aggregate is no longer read from
    // the reservation header. The pill is fed by
    // `computeReservationAggregatePaymentStatus(row.listChildBookings.map(c => c.status))`
    // (the derivation over the children that are
    // already in memory at row-build time). The
    // pre-BAR-02 shape was
    // `renderReservationPaymentStatusPill(row.listReservationHeader.paymentStatus, ...)`;
    // the post-BAR-02 shape is the same call but with
    // a derived value.
    expect(bookingsPageSrc).toMatch(/renderReservationPaymentStatusPill\(\s*computeReservationAggregatePaymentStatus\(/);
  });

  it("MRB-12-02: the reservation row renders a `X cancelled` chip when the derived cancellation count is > 0", () => {
    // Per BAR-02 (2026-08-08, per decision #203): the
    // chip's count is derived from the children at
    // read time, not read from the reservation
    // header's `cancelledRoomCount` field. The
    // `row.listChildBookings` array is already in
    // memory at row-build time; the chip filters it
    // for `status === "cancelled"`. The pre-BAR-02
    // shape was `row.listReservationHeader.cancelledRoomCount > 0`;
    // the post-BAR-02 shape is the inline IIFE over
    // `listChildBookings`.
    expect(bookingsPageSrc).toMatch(/Cancelled rooms in this reservation/);
    expect(bookingsPageSrc).toMatch(/Room \$\{child\.roomNumber\}/);
    expect(bookingsPageSrc).toMatch(/cancelledChildren/);
    expect(bookingsPageSrc).toMatch(/child\.status === "cancelled"/);
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
    // The submit handler picks the atomic endpoint when the
    // scope is "reservation" and a reservation context exists;
    // falls back to the per-booking endpoint for single-room.
    // Per DSC-04 (2026-08-15): this replaces the per-targetId
    // loop with a single atomic fetch.
    expect(bookingsPageSrc).toMatch(
      /isReservationScope = scope === "reservation" && !!selectedReservationContext/
    );
    expect(bookingsPageSrc).toMatch(
      /endpointPath = isReservationScope\s*\?\s*"\/api\/bookings\/apply-reservation-discount"\s*:\s*"\/api\/bookings\/apply-discount"/
    );
    // The "all rooms" submit button label + toast surface the
    // reservation scope so the desk sees what was applied.
    expect(bookingsPageSrc).toMatch(/Apply to all \$\{selectedReservationContext\.roomCount\} rooms/);
    expect(bookingsPageSrc).toMatch(/Reservation repriced \(\$\{selectedReservationContext\.roomCount\} rooms\)/);
  });

  // Per MRB-12-05 (2026-08-14, found during the audit pass
  // that followed RPT-05 + EXB-12.1 + VOU-01): the admin
  // client loop was the only thing that achieved per-child
  // usageCount semantics for the reservation-scope apply-
  // discount flow (the handler did +1 per call; the client
  // called it N times for N rooms). The original regex pin
  // covered the `targetIds = ...rooms.map(...)` + the
  // `for (const targetId of targetIds)` loop body — a future
  // refactor that broke the loop would silently miscount
  // `vouchers.usageCount`.
  //
  // Per DSC-04 (2026-08-15, owner decision option a): the
  // loop is REPLACED by a single fetch to the atomic
  // `apply-reservation-discount` endpoint — one server-side
  // transaction that either applies the discount to every
  // eligible child or none. The single-room path (scope ===
  // "room") still uses the per-booking `apply-discount`
  // endpoint (byte-equivalent to a 1-child reservation).
  //
  // This test pins the new atomic-shape at the source level
  // (replaces the old loop pin). Without this pin, a future
  // refactor could revert to the per-child loop and silently
  // re-introduce the partial-failure UX (room N failing
  // after rooms 1..N-1 succeeded leaves the reservation
  // half-discounted).
  it("MRB-12-05: the discount submit handler routes reservation-scope applies to the atomic endpoint (DSC-04)", () => {
    // Pin the conditional endpoint + reservationId payload
    // shape — the same URL substring that lives in the router
    // test (DSC-04 guard).
    expect(bookingsPageSrc).toMatch(
      /apply-reservation-discount[\s\S]{0,2000}?reservationId:[\s\S]{0,200}?selectedReservationContext/
    );
    // Pin the single-room fallback to the per-booking endpoint.
    expect(bookingsPageSrc).toMatch(
      /bookingId:[\s\S]{0,100}?selectedBooking\.id/
    );
    // Anti-regression: the per-targetId loop is GONE.
    expect(bookingsPageSrc).not.toMatch(
      /for\s*\(\s*const\s+targetId\s+of\s+targetIds\s*\)\s*\{[\s\S]{0,3000}?await\s+fetch\([\s\S]{0,500}?\/api\/bookings\/apply-discount[\s\S]{0,1000}?bookingId:\s*targetId/
    );
  });

  it("MRB-12-05: the per-individual discount guard disables the `All N rooms` scope (PWD / senior)", () => {
    // Per the per-individual discount guard: PWD and
    // senior are per-individual legal entitlements
    // (RA 7277 / RA 9442) — they must be applied to
    // the specific guest's booking, not the whole
    // reservation. The `All N rooms` button is
    // disabled when `staffDiscountType` is
    // `"senior"` or `"pwd"`, with a clear visual
    // + a tooltip + a one-line hint. The submit
    // handler also has a defense-in-depth guard
    // that falls back to single-room if the scope
    // is somehow set when the type is per-individual.
    //
    // The `isPerIndividualDiscount` derivation is the
    // single source of truth — the segmented-control
    // disable + the useEffect auto-revert + the
    // submit-time guard all read from it.
    expect(bookingsPageSrc).toMatch(
      /const isPerIndividualDiscount = staffDiscountType === "senior" \|\| staffDiscountType === "pwd";/
    );
    // The button is `disabled` when per-individual is
    // selected.
    expect(bookingsPageSrc).toMatch(
      /disabled=\{perIndividual\}[\s\S]{0,500}?aria-disabled=\{perIndividual\}/
    );
    // The title / hint text is "Senior / PWD only — pick
    // one room" (so the staff knows why the button is
    // disabled).
    expect(bookingsPageSrc).toMatch(/Senior \/ PWD only — pick one room/);
    // The title (the tooltip) is the per-individual
    // explanation.
    expect(bookingsPageSrc).toMatch(
      /Not available for senior \/ PWD discounts — these are per-individual entitlements\. Apply to one room at a time\./
    );
  });

  it("MRB-12-05: the per-individual guard auto-reverts the scope to `null` via useEffect", () => {
    // Defense in depth: if the staff already picked
    // "All N rooms" and then switches the type to
    // senior / PWD, the scope auto-clears so the
    // submit handler applies to the lead only. The
    // segmented-control button is also disabled
    // (per the test above), but the useEffect
    // catches the case where the staff has the
    // modal open and toggles the type without
    // re-clicking the segmented control.
    expect(bookingsPageSrc).toMatch(
      /if \(isPerIndividualDiscount && staffDiscountScope === "reservation"\) \{[\s\S]{0,200}?setStaffDiscountScope\(null\);/
    );
    expect(bookingsPageSrc).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,800}?if \(isPerIndividualDiscount && staffDiscountScope === "reservation"\)/
    );
  });

  it("MRB-12-05: the submit handler falls back to `room` scope when the type is per-individual (defense in depth)", () => {
    // Belt-and-braces: even if the UI + the
    // useEffect fail to clear the scope, the submit
    // handler computes an `effectiveScope` that
    // forces `room` when the type is per-individual.
    // The reservation-scope loop is never reached
    // for a per-individual discount.
    expect(bookingsPageSrc).toMatch(
      /const effectiveScope =\s*isPerIndividualDiscount \? "room" : \(staffDiscountScope \?\? "room"\);/
    );
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

describe("MRB-14-02 — Add-room admin modal in BookingsPage", () => {
  it("the add-room button in the drawer's More actions section gates on `selectedBooking.reservationId` + `RESCHEDULABLE_STATUSES`", () => {
    // Hidden for legacy null-`reservationId`
    // bookings (the add-room flow is a multi-room
    // concept — the desk can't add a room to a
    // single-booking row). Hidden for in-stay
    // bookings (the in-stay path is the reschedule
    // handler). The button carries the
    // `renderActionScope("reservation")` chip so the
    // desk knows the new room is part of the
    // reservation.
    expect(bookingsPageSrc).toMatch(
      /selectedBooking\.reservationId && RESCHEDULABLE_STATUSES\.includes\(selectedBooking\.status\) && !showAddRoomForm &&/
    );
    expect(bookingsPageSrc).toMatch(/Add room to this reservation/);
  });

  it("the add-room modal posts to `POST /api/bookings/add-room` with `{ reservationId, roomId, numAdults, numChildren, extraBedCount }`", () => {
    // The dates are NEVER in the body — the server
    // reads them from the header. The submit
    // handler awaits `auth.currentUser?.getIdToken`
    // for the Bearer auth, surfaces a 400 on
    // failure, and shows a success toast with the
    // new `bookingRef` on success.
    expect(bookingsPageSrc).toMatch(/\/api\/bookings\/add-room/);
    expect(bookingsPageSrc).toMatch(
      /body: JSON\.stringify\(\{[\s\S]*?reservationId: selectedBooking\.reservationId,[\s\S]*?roomId: addRoomRoomId,[\s\S]*?numAdults: addRoomNumAdults,[\s\S]*?numChildren: addRoomNumChildren,[\s\S]*?extraBedCount: addRoomExtraBedCount\s*\}\)/s
    );
  });
});
