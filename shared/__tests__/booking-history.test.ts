// Per CRL-08 (2026-08-11, per decision #213):
// behavioural tests for the `getBookedOnDate` +
// `getOriginallyForCheckIn` helpers. The source-
// text tests in
// `guest-app/tests/api/crl-08-reschedule-snapshot-refresh.test.ts`
// pin the wiring (the imports, the surface sites,
// the API response shape); this file pins the
// math (the helper behaviour under each shape of
// booking — modern post-MRB-01, legacy
// pre-MRB-01, rescheduled, never-rescheduled, and
// the malformed-input fall-throughs).

import { describe, expect, it } from "vitest";
import { getBookedOnDate, getOriginallyForCheckIn } from "../utils/bookingHistory";

describe("getBookedOnDate", () => {
  it("returns the reservation's createdAt when both inputs are present (post-MRB-01)", () => {
    const reservationCreatedAt = new Date("2026-08-07T10:00:00Z");
    const bookingCreatedAt = new Date("2026-08-07T10:00:01Z");
    const result = getBookedOnDate({
      booking: { createdAt: bookingCreatedAt },
      reservation: { createdAt: reservationCreatedAt }
    });
    expect(result?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  });

  it("falls back to the booking's createdAt when the reservation has none (legacy / N=1 + no header)", () => {
    const bookingCreatedAt = new Date("2026-08-07T10:00:00Z");
    const result = getBookedOnDate({
      booking: { createdAt: bookingCreatedAt },
      reservation: null
    });
    expect(result?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  });

  it("returns null when both inputs are missing", () => {
    expect(getBookedOnDate({ booking: null, reservation: null })).toBeNull();
  });

  it("returns null when the booking's createdAt is null/undefined", () => {
    expect(getBookedOnDate({
      booking: { createdAt: null },
      reservation: { createdAt: new Date("2026-08-07T10:00:00Z") }
    })).not.toBeNull();
    // Reservation wins when the booking's is null.
    expect(getBookedOnDate({
      booking: { createdAt: undefined },
      reservation: null
    })).toBeNull();
  });

  it("accepts Firestore Timestamp shape (object with toDate())", () => {
    const firestoreTimestamp = {
      toDate: () => new Date("2026-08-07T10:00:00Z")
    };
    const result = getBookedOnDate({ booking: { createdAt: firestoreTimestamp as any } });
    expect(result?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  });

  it("accepts ISO string shape", () => {
    const result = getBookedOnDate({ booking: { createdAt: "2026-08-07T10:00:00Z" } });
    expect(result?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  });
});

describe("getOriginallyForCheckIn", () => {
  it("returns the reservation's checkIn for post-MRB-01 bookings (the MRB-14-immutable original)", () => {
    const result = getOriginallyForCheckIn({
      booking: { checkIn: new Date("2026-08-21T00:00:00Z") },
      reservation: { checkIn: new Date("2026-08-12T00:00:00Z") }
    });
    // The reservation header's checkIn is the
    // create-time original; the booking's own
    // checkIn is the rescheduled (current) date.
    // The helper returns the ORIGINAL regardless
    // of how they compare.
    expect(result?.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("falls back to rescheduleHistory[0].fromCheckIn for legacy pre-MRB-01 bookings that have been rescheduled", () => {
    const result = getOriginallyForCheckIn({
      booking: {
        checkIn: new Date("2026-08-21T00:00:00Z"),
        rescheduleHistory: [
          { fromCheckIn: new Date("2026-08-12T00:00:00Z") }
        ]
      },
      reservation: null
    });
    expect(result?.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("falls back to the booking's own checkIn for legacy bookings that have never been rescheduled", () => {
    // Legacy null-`reservationId` + never-rescheduled
    // = the booking's checkIn IS the original.
    const result = getOriginallyForCheckIn({
      booking: { checkIn: new Date("2026-08-21T00:00:00Z") },
      reservation: null
    });
    expect(result?.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("returns null when the booking has no checkIn and no history and no reservation", () => {
    expect(getOriginallyForCheckIn({
      booking: { checkIn: null, rescheduleHistory: [] },
      reservation: null
    })).toBeNull();
  });

  it("ignores the booking's checkIn when the reservation header is present (MRB-14 wins)", () => {
    // The post-MRB-01 path always wins; the
    // booking's own checkIn is the rescheduled
    // current date and is NOT consulted when the
    // header has a value.
    const result = getOriginallyForCheckIn({
      booking: { checkIn: new Date("2026-08-21T00:00:00Z") },
      reservation: { checkIn: new Date("2026-08-12T00:00:00Z") }
    });
    expect(result?.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("accepts the legacy history[0].fromCheckIn as a string (the reschedule writer stores it as ISO)", () => {
    const result = getOriginallyForCheckIn({
      booking: {
        checkIn: new Date("2026-08-21T00:00:00Z"),
        rescheduleHistory: [
          { fromCheckIn: "2026-08-12T00:00:00.000Z" }
        ]
      },
      reservation: null
    });
    expect(result?.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });
});
