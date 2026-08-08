// Per MRB-05 (2026-08-02, per decision #159): the
// reservation header's `paymentStatus` is the
// aggregate of the child booking statuses (the N>1
// "wire" label). The pre-BAR-02 contract was that
// every handler that mutated a child booking's
// status also wrote the aggregate to the header in
// the same `runTransaction` (the FOL-05 sibling-flip
// pass + the FOL-03 / CRL-13 mirror writes).
//
// Per BAR-02 (2026-08-08, per decision #203): the
// mirror is no longer written. The aggregate helper
// is unchanged — `computeReservationAggregatePaymentStatus`
// at `shared/utils/bookingFolio.ts` is still the
// canonical read path. The pre-BAR-02 test surface
// (24 source-text guards across 6 handlers) is
// replaced by a slim BAR-02 guard: the mirror is
// GONE from every handler. The corresponding
// read-time derivation tests are in
// `bar-02-derive-counters.test.ts` and
// `shared/__tests__/booking-folio.test.ts`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const HANDLERS_PATH = join(REPO_ROOT, "guest-app", "server", "handlers", "bookings.ts");
const handlers = readFileSync(HANDLERS_PATH, "utf-8");

// Per MRB-05 + per BAR-02: the pre-MRB-05 single
// status mapper is still used (e.g. for the email
// view's per-child mapping), but the
// reservation-scope mirror write is gone. The
// aggregate helper is still the canonical
// derivation source.
describe("MRB-05 — the aggregate helper is the canonical read path; the mirror write is gone (per BAR-02 / #203)", () => {
  it("the aggregate helper exists and is exported from `shared/utils/bookingFolio.ts`", () => {
    // Sanity check: the helper itself is
    // unchanged. The contract is owned by the
    // characterization tests in
    // `shared/__tests__/booking-folio.test.ts`.
    const sharedFolio = readFileSync(
      join(REPO_ROOT, "shared", "utils", "bookingFolio.ts"),
      "utf-8"
    );
    expect(sharedFolio).toMatch(
      /export function computeReservationAggregatePaymentStatus\(/
    );
  });

  it("the FOL-05 sibling-flip pass (verify / add / reject) does NOT write `paymentStatus` to the reservation header", () => {
    // The FOL-05 sibling-flip pass is unchanged
    // (per BAR-02 spec — the per-child status
    // transition is the real state mutation, the
    // mirror is what goes away).
    expect(handlers).not.toMatch(
      /if \(bookingReservationId\.length > 0 && siblingChildBookings\.length > 0\) \{[\s\S]{0,200}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
    );
  });

  it("the FOL-03 check-in / check-out mirror writes are gone (per BAR-02 / #203)", () => {
    // The check-in + check-out paths no longer
    // write the `checkedInRoomCount` /
    // `checkedOutRoomCount` counters OR the
    // `paymentStatus` mirror. Consumers derive
    // them at read time.
    expect(handlers).not.toMatch(
      /checkedInRoomCount: newCheckedInCount,?\s*\n\s*paymentStatus: computeReservationAggregatePaymentStatus/
    );
    expect(handlers).not.toMatch(
      /checkedInRoomCount: newCheckedInCount,?\s*\n\s*checkedOutRoomCount: newCheckedOutCount/
    );
  });

  it("the reservation-scope cancel does NOT write the 5 counter fields or the `paymentStatus` mirror", () => {
    // The cancel handler no longer writes
    // `cancelledRoomCount` / `activeRoomCount`
    // (per BAR-02 — the 5 counter fields are
    // gone). Consumers derive them at read time.
    expect(handlers).not.toMatch(
      /cancelledRoomCount: newCancelledRoomCount/
    );
    expect(handlers).not.toMatch(
      /newActiveRoomCount = Math\.max\(\s*\(Number\(reservationData\.activeRoomCount\) \|\| 0\) - cancelledCount/
    );
  });

  it("the add-room endpoint does NOT write the counter fields (per BAR-02 / #203)", () => {
    // The MRB-14 add-room endpoint no longer
    // writes `roomCount` / `activeRoomCount` to
    // the header. Consumers derive them at read
    // time.
    expect(handlers).not.toMatch(
      /roomCount: existingChildren\.length \+ 1,/
    );
    expect(handlers).not.toMatch(
      /activeRoomCount: existingChildren\.length \+ 1,/
    );
  });

  it("the create + walkin paths do NOT stamp the 5 counter fields (per BAR-02 / #203)", () => {
    // The create-time init is gone. Consumers
    // derive the counters at read time.
    expect(handlers).not.toMatch(/roomCount:\s*assignedRooms\.length,/);
    expect(handlers).not.toMatch(/activeRoomCount:\s*assignedRooms\.length,/);
    expect(handlers).not.toMatch(/roomCount:\s*walkinRoomCount,/);
    expect(handlers).not.toMatch(/activeRoomCount:\s*walkinRoomCount,/);
    expect(handlers).not.toMatch(/cancelledRoomCount:\s*0/);
    expect(handlers).not.toMatch(/checkedInRoomCount:\s*0/);
    expect(handlers).not.toMatch(/checkedOutRoomCount:\s*0/);
  });
});
