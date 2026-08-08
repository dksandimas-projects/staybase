// Per MRB-14 (2026-08-03, per decision #180 — proposed):
// source-text + structural guards for the
// `handleAddRoomToReservation` handler + the
// `POST /api/bookings/add-room` route registration.
// Behavioural coverage (the actual transaction
// write + read round-trip) ships in the Java-gated
// emulator test that follows the CRL-09 / MRB-11
// precedent — `firebase/tests/mrb-14-add-room.emulator.test.ts`.
// Source-text pins the contract here so a future
// refactor cannot revert to a different shape
// without breaking the test.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/apiRouter.ts"),
  "utf8"
);

describe("MRB-14-02 — handleAddRoomToReservation surface", () => {
  it("validates the request body via `AddRoomBookingSchema` (the schema in `shared/schemas/booking.ts`)", () => {
    // The handler MUST use the strict Zod schema
    // (same posture as create + walkin + reschedule).
    // A 400 with a generic error message fires on
    // schema failure.
    expect(bookingsSrc).toMatch(
      /const parsedAddRoom = AddRoomBookingSchema\.safeParse\(req\.body \|\| \{\}\)/
    );
    expect(bookingsSrc).toMatch(/Please check the add-room details/);
  });

  it("validates the reservation exists + is pre-arrival (no `checked-in` or `cancelled` children anywhere)", () => {
    // The handler MUST read the reservation header
    // first; missing reservation is a 404. The
    // pre-arrival guard inspects every child's
    // status — a single `checked-in` or
    // `cancelled` child aborts the add-room
    // request (the in-stay path is the reschedule
    // handler).
    expect(bookingsSrc).toMatch(
      /const reservationSnap = await transaction\.get\(reservationRef\)/
    );
    expect(bookingsSrc).toMatch(
      /throw new Error\("RESERVATION_NOT_FOUND"\)/
    );
    expect(bookingsSrc).toMatch(
      /cancelledCount = existingChildren\.filter\(\s*\n\s*\(child\) => String\(child\.data\.status \|\| ""\) === "cancelled"\s*\)/
    );
    expect(bookingsSrc).toMatch(
      /checkedInCount = existingChildren\.filter\(\s*\n\s*\(child\) => String\(child\.data\.status \|\| ""\) === "checked-in"\s*\)/
    );
    expect(bookingsSrc).toMatch(
      /throw new Error\("Reservation has cancelled rooms — staff must clear those before adding a new room\."\)/
    );
    expect(bookingsSrc).toMatch(
      /throw new Error\("Reservation has a checked-in room — the in-stay reschedule path applies to date changes for an existing room\."\)/
    );
  });

  it("validates the target room is available, not blocked, not claimed by a sibling, and fits the bed inventory", () => {
    // The handler MUST check: `isActive`,
    // `status === "blocked"` (with date-overlap
    // window), sibling-claim (the new roomId is
    // not already in another child of the same
    // reservation), and bed-inventory via
    // `requiredExtraBedsFor`.
    expect(bookingsSrc).toMatch(/if \(targetRoom\.isActive === false\)/);
    expect(bookingsSrc).toMatch(/if \(targetRoom\.status === "blocked"\)/);
    expect(bookingsSrc).toMatch(
      /siblingClaimedRoom = existingChildren\.find\(\s*\n\s*\(child\) => String\(child\.data\.roomId \|\| ""\) === String\(roomId\)/
    );
    expect(bookingsSrc).toMatch(
      /throw new Error\("Target room is already claimed by another stay in this reservation\."\)/
    );
    expect(bookingsSrc).toMatch(
      /const requiredExtraBeds = requiredExtraBedsFor\(/
    );
  });

  it("inherits the header's dates (the new child shares the header's `checkIn` / `checkOut` / `numNights`)", () => {
    // The dates are NEVER in the request body. The
    // handler reads them from the header's
    // `checkIn` / `checkOut` / `numNights` and
    // stamps the new child with those exact
    // values. The header's dates are the
    // immutable shared-dates snapshot from
    // MRB-14-01 — the new child does NOT re-anchor
    // the header's range.
    expect(bookingsSrc).toMatch(
      /const headerCheckIn = toDateOrNull\(reservation\.checkIn\)/
    );
    expect(bookingsSrc).toMatch(
      /checkIn: Timestamp\.fromDate\(headerCheckIn\),/
    );
    expect(bookingsSrc).toMatch(
      /checkOut: Timestamp\.fromDate\(headerCheckOut\),/
    );
    expect(bookingsSrc).toMatch(/numNights: headerNumNights,/);
  });

  it("computes the per-stream `revenueAllocation` snapshot via `assertBookingRevenueAllocationInvariant`", () => {
    // Per MRB-11: every create path writes a
    // stored `revenueAllocation` field. The
    // add-room handler MUST call the invariant
    // assert before the write so a miscalculation
    // throws at the boundary, not at the export.
    expect(bookingsSrc).toMatch(
      /const newChildRevenueAllocation = assertBookingRevenueAllocationInvariant\(/
    );
    expect(bookingsSrc).toMatch(/revenueAllocation: newChildRevenueAllocation/);
  });

  it("updates the reservation header in the SAME transaction: counters + totals + aggregate allocation + `actualDateRange`", () => {
    // The header MUST be updated atomically with
    // the new child write — `roomCount += 1`,
    // `activeRoomCount += 1`, `subtotal +=
    // childSubtotal`, `totalPrice +=
    // childTotalPrice`, the new
    // `aggregateRevenueAllocation` (sum of
    // children), the recomputed `actualDateRange`.
    // The recompute stays `isDivergent: false`
    // Per BAR-02 (2026-08-08, per decision #203):
    // `roomCount` and `activeRoomCount` are no
    // longer written to the reservation header on
    // add-room. Consumers derive them at read time.
    // The real denormalized header values (`subtotal`
    // / `totalPrice` / `aggregateRevenueAllocation` /
    // `actualDateRange`) stay — those are not pure
    // projections.
    expect(bookingsSrc).not.toMatch(
      /roomCount: existingChildren\.length \+ 1,/
    );
    expect(bookingsSrc).not.toMatch(
      /activeRoomCount: existingChildren\.length \+ 1,/
    );
    expect(bookingsSrc).toMatch(/subtotal: newSubtotal,/);
    expect(bookingsSrc).toMatch(/totalPrice: newTotalPrice,/);
    expect(bookingsSrc).toMatch(
      /aggregateRevenueAllocation: newAggregateRevenueAllocation,/
    );
    expect(bookingsSrc).toMatch(/actualDateRange: newActualDateRange,/);
  });

  it("increments `corporateCodes.usageCount` by 1 for a corporate reservation (per MRB-08's N-rooms = N-uses rule)", () => {
    // The handler MUST write a `usageCount += 1`
    // to the corporate code's doc in the SAME
    // transaction (a refusal to write would
    // silently lose the corporate-cap accounting).
    expect(bookingsSrc).toMatch(
      /corporateUsageUpdate: \{ ref: any; data: any \} \| null = \(\(\) =>/
    );
    expect(bookingsSrc).toMatch(
      /usageCount: Number\(\(reservation as any\)\.corporateUsageCount \|\| 0\) \+ 1/
    );
  });

  it("increments `vouchers.usageCount` by 1 when a voucher is applied to the new child", () => {
    // The handler MUST write `usageCount += 1`
    // to the voucher's doc in the SAME transaction
    // after a successful voucher validation. A
    // refusal to write would silently lose the
    // voucher-cap accounting.
    expect(bookingsSrc).toMatch(
      /voucherUsageUpdate = \{[\s\S]*?usageCount: Number\(vData\.usageCount \|\| 0\) \+ 1/
    );
  });

  it("mints a fresh `bookingRef` via `generateBookingRef(\"SI\", headerCheckIn, sequence)` and increments the per-day counter", () => {
    // The counter is per-day (the
    // `bookings-${todayStr}` doc) and the ref is
    // `SI-YYYYMMDD-NNN` per H3's 5-digit
    // sequence width.
    expect(bookingsSrc).toMatch(
      /const counterRef = adminDb\.collection\("counters"\)\.doc\(`bookings-\${counterDay}`\)/
    );
    expect(bookingsSrc).toMatch(
      /const newBookingRefValue = generateBookingRef\("SI", headerCheckIn, nextSequence\)/
    );
  });

  it("fires the `booking-rescheduled` email after the commit (the reservation-scope view carries the new room)", () => {
    // The email is best-effort, outside the
    // transaction. The existing template's
    // subject reads "Reservation updated: R-…
    // (N rooms)" — the N is the new room count.
    expect(bookingsSrc).toMatch(
      /await sendBookingTrigger\("booking-rescheduled", fullBookingForEmail\);/
    );
  });
});

describe("MRB-14-02 — POST /api/bookings/add-room route", () => {
  it("the apiRouter registers the route with staff auth + the same rate-limit bucket as the reschedule surface", () => {
    // The route shares the `bookings-reschedule`
    // rate-limit bucket (both are staff-driven,
    // deliberate mutations). A separate bucket
    // would just starve one path at the expense
    // of the other.
    expect(apiRouterSrc).toMatch(
      /domain === "bookings" && action === "add-room" && req\.method === "POST"/
    );
    expect(apiRouterSrc).toMatch(
      /isRateLimited\(`bookings-reschedule:\$\{ip\}`, 30, 60000\)/
    );
    expect(apiRouterSrc).toMatch(
      /return await handleAddRoomToReservation\(req, res\);/
    );
  });
});
