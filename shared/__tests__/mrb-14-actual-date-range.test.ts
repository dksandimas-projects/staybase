// Per MRB-14 (2026-08-03, per decision #180 — proposed):
// pure-helper tests for `computeReservationActualDateRange`.
// Behavioural coverage of the date-range math that
// `handleRescheduleBooking` + `handleAddRoomToReservation`
// (MRB-14-02) use to recompute the denormalized
// `Reservation.actualDateRange` after every child mutation.
//
// N=1 + legacy null-`reservationId` paths don't compute the
// field (their data is per-child only); the helper is
// invoked only when a `Reservation` doc exists with at
// least 1 child — the empty-children case returns `null`
// and the caller decides what to do.

import { describe, it, expect } from "vitest";
import { computeReservationActualDateRange } from "@spark-inn/shared";

describe("MRB-14 — computeReservationActualDateRange", () => {
  it("returns null for an empty children list (the caller is responsible for the invariant violation)", () => {
    const result = computeReservationActualDateRange(
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-05T00:00:00Z"),
      []
    );
    expect(result).toBeNull();
  });

  it("returns the header's range + `isDivergent: false` when every child matches the header", () => {
    // Per MRB-14-01 (create-time contract): at create
    // time every child shares the header's dates, so
    // `isDivergent` is `false` by construction. The
    // helper must report this without a false-positive
    // — a sub-second Date mismatch (e.g. a `Timestamp`
    // vs `Date` round-trip) would otherwise flip the
    // flag and the UI would render per-child dates for
    // every N=1 reservation.
    const headerIn = new Date("2024-01-01T00:00:00Z");
    const headerOut = new Date("2024-01-05T00:00:00Z");
    const result = computeReservationActualDateRange(headerIn, headerOut, [
      { checkIn: new Date("2024-01-01T00:00:00Z"), checkOut: new Date("2024-01-05T00:00:00Z") },
      { checkIn: new Date("2024-01-01T00:00:00Z"), checkOut: new Date("2024-01-05T00:00:00Z") },
      { checkIn: new Date("2024-01-01T00:00:00Z"), checkOut: new Date("2024-01-05T00:00:00Z") }
    ]);
    expect(result).not.toBeNull();
    expect(result?.earliestCheckIn.getTime()).toBe(headerIn.getTime());
    expect(result?.latestCheckOut.getTime()).toBe(headerOut.getTime());
    expect(result?.isDivergent).toBe(false);
  });

  it("returns `isDivergent: true` when a child's dates differ from the header's", () => {
    // The driving scenario: a reschedule extends
    // child[1] by 2 nights. The helper must report
    // the spread + the divergent flag so the UI +
    // email switch to per-child dates.
    const headerIn = new Date("2024-01-01T00:00:00Z");
    const headerOut = new Date("2024-01-05T00:00:00Z");
    const result = computeReservationActualDateRange(headerIn, headerOut, [
      { checkIn: new Date("2024-01-01T00:00:00Z"), checkOut: new Date("2024-01-05T00:00:00Z") },
      { checkIn: new Date("2024-01-01T00:00:00Z"), checkOut: new Date("2024-01-07T00:00:00Z") }
    ]);
    expect(result).not.toBeNull();
    expect(result?.earliestCheckIn.getTime()).toBe(headerIn.getTime());
    expect(result?.latestCheckOut.getTime()).toBe(new Date("2024-01-07T00:00:00Z").getTime());
    expect(result?.isDivergent).toBe(true);
  });

  it("returns the MIN(children.checkIn) and MAX(children.checkOut) regardless of child order", () => {
    // The order of children in the snapshot is not
    // guaranteed (Firestore returns by sort key, not
    // insertion order). The helper must compute
    // MIN/MAX regardless.
    const headerIn = new Date("2024-01-01T00:00:00Z");
    const headerOut = new Date("2024-01-05T00:00:00Z");
    const result = computeReservationActualDateRange(headerIn, headerOut, [
      { checkIn: new Date("2024-01-03T00:00:00Z"), checkOut: new Date("2024-01-08T00:00:00Z") },
      { checkIn: new Date("2023-12-30T00:00:00Z"), checkOut: new Date("2024-01-04T00:00:00Z") },
      { checkIn: new Date("2024-01-05T00:00:00Z"), checkOut: new Date("2024-01-10T00:00:00Z") }
    ]);
    expect(result).not.toBeNull();
    expect(result?.earliestCheckIn.getTime()).toBe(new Date("2023-12-30T00:00:00Z").getTime());
    expect(result?.latestCheckOut.getTime()).toBe(new Date("2024-01-10T00:00:00Z").getTime());
    expect(result?.isDivergent).toBe(true);
  });

  it("accepts ISO date strings as well as `Date` objects (the caller's choice)", () => {
    // The walkin / reschedule / add-room handlers
    // pass `Date` objects (already converted from
    // ISO); tests + edge tools may pass strings. The
    // helper must normalise both.
    const result = computeReservationActualDateRange(
      "2024-01-01T00:00:00Z",
      "2024-01-05T00:00:00Z",
      [
        { checkIn: "2024-01-01T00:00:00Z", checkOut: "2024-01-05T00:00:00Z" },
        { checkIn: "2024-01-01T00:00:00Z", checkOut: "2024-01-07T00:00:00Z" }
      ]
    );
    expect(result).not.toBeNull();
    expect(result?.isDivergent).toBe(true);
    expect(result?.latestCheckOut.getTime()).toBe(new Date("2024-01-07T00:00:00Z").getTime());
  });

  it("skips children with invalid dates without throwing (the rest still compute)", () => {
    // Defensive: a malformed child date (Firestore
    // migration glitch, a manual admin edit gone
    // wrong) must not crash the recompute. The helper
    // skips the bad child and reports the rest. The
    // skipped child contributes neither its dates
    // nor a divergence flag — a reservation with one
    // good child + one bad child reads as
    // "not divergent" (the good child matches the
    // header). A pre-MRB-14 admin edit that broke
    // one child is still visible in the children's
    // per-child `checkIn` / `checkOut` (the admin
    // surfaces read those directly for pre-MRB-14
    // rows + the per-child fallback in MRB-14-04).
    const result = computeReservationActualDateRange(
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-05T00:00:00Z"),
      [
        { checkIn: new Date("2024-01-01T00:00:00Z"), checkOut: new Date("2024-01-05T00:00:00Z") },
        { checkIn: "not-a-date", checkOut: new Date("2024-01-06T00:00:00Z") }
      ]
    );
    expect(result).not.toBeNull();
    // Child 2 is skipped, so the result is from child 1
    // alone (matches the header → not divergent).
    expect(result?.isDivergent).toBe(false);
    expect(result?.latestCheckOut.getTime()).toBe(new Date("2024-01-05T00:00:00Z").getTime());
  });
});
