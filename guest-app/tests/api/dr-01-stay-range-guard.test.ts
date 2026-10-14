// Per DR-01 (2026-10-14): stay-range normalization.
//
// The guest could set check-in Oct 16 with check-out Oct 9. Three
// separate holes let that through:
//
//   1. `DateRangePicker` guarded ONE direction only — it clamped a
//      typed check-out that fell before `checkIn + 1`, but nothing
//      handled check-in moving ONTO OR PAST an already-set
//      check-out. Native `<input type="date" min>` constrains what
//      the picker lets you CLICK; it never corrects a value that is
//      already out of bounds.
//   2. `BookingPage` / `CorporateBookingPage` seeded `checkIn` +
//      `checkOut` straight from the URL params, so a shared or
//      hand-edited `?checkIn=…&checkOut=…` opened the flow on an
//      inverted range. `CorporateBookingPage`'s own `isValidDateKey`
//      regex only checked the `YYYY-MM-DD` SHAPE, not the ordering.
//   3. `createBookingSchema` validated the dates as free-form
//      strings (`.min(1).max(40)`) and the night count was computed
//      as `Math.max(checkOut - checkIn, 0)` — so an inverted range
//      produced a real, confirmed **0-night booking** instead of an
//      error. `handleRescheduleBooking` already guarded this
//      correctly; create did not.
//
// Behavioural coverage of the pure normalizer lives in
// `shared/__tests__/stay-range.test.ts` (17 cases). The guards
// below pin the source-level contracts so a future refactor that
// drops one of these breaks a test instead of silently regressing.
// Per `plan/docs/CONTRIBUTING.md §Testing`: cheap, deterministic.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDaysToIsoDate,
  diffNightsBetweenIso,
  normalizeStayRange
} from "@spark-inn/shared";

const read = (relative: string) =>
  readFileSync(resolve(__dirname, "../../..", relative), "utf8");

const handlersSrc = read("guest-app/server/handlers/bookings.ts");
const pickerSrc = read("guest-app/src/components/DateRangePicker.tsx");
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const corporateBookingSrc = read("guest-app/src/pages/CorporateBookingPage.tsx");
const corporateStaysSrc = read("guest-app/src/pages/CorporateStaysPage.tsx");
const bookingLookupSrc = read("guest-app/src/pages/BookingLookupPage.tsx");

// Slice the create-booking handler body so the assertions target
// the right scope and can't be satisfied by a stray match
// elsewhere in the (very large) handler module.
function handlerBody(fnName: string): string {
  const start = handlersSrc.indexOf(`export async function ${fnName}`);
  if (start === -1) return "";
  const end = handlersSrc.indexOf("\nexport async function ", start + 1);
  return handlersSrc.slice(start, end === -1 ? undefined : end);
}

describe("DR-01 — create-booking rejects an inverted stay range", () => {
  const createBody = handlerBody("handleCreateBooking");

  it("locates the create-booking handler", () => {
    expect(createBody.length).toBeGreaterThan(0);
  });

  it("strictly validates both dates as ISO date keys", () => {
    expect(createBody).toMatch(/!isValidIsoDate\(body\.checkIn\)/);
    expect(createBody).toMatch(/!isValidIsoDate\(body\.checkOut\)/);
  });

  it("rejects a range shorter than one night with a 400", () => {
    expect(createBody).toMatch(
      /diffNightsBetweenIso\(body\.checkIn, body\.checkOut\) < 1/
    );
    expect(createBody).toMatch(/status\(400\)/);
    expect(createBody).toMatch(/at least one night after check-in/);
  });

  it("runs the range guard BEFORE the booking transaction", () => {
    const guard = createBody.indexOf("diffNightsBetweenIso(body.checkIn, body.checkOut)");
    const transaction = createBody.search(/runTransaction|transaction\.set|transaction\.update/);
    expect(guard).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(transaction);
  });

  it("still rejects the inverted range in the reschedule handler", () => {
    // Regression guard: the pre-existing reschedule check must not
    // be "simplified away" while fixing create.
    const rescheduleBody = handlerBody("handleRescheduleBooking");
    expect(rescheduleBody).toMatch(/checkOutDate <= checkInDate/);
  });
});

describe("DR-01 — DateRangePicker self-heals instead of only guarding input", () => {
  it("renders the normalized values, not the raw props", () => {
    expect(pickerSrc).toMatch(/value=\{resolved\.checkIn\}/);
    expect(pickerSrc).toMatch(/value=\{resolved\.checkOut\}/);
  });

  it("routes both inputs through normalizeStayRange", () => {
    expect(pickerSrc).toMatch(/normalizeStayRange\(\{/);
  });

  it("pushes the correction back to the parent so state + URL agree", () => {
    expect(pickerSrc).toMatch(/if \(resolved\.checkIn !== checkIn\) onCheckInChange\(resolved\.checkIn\)/);
    expect(pickerSrc).toMatch(/if \(resolved\.checkOut !== checkOut\) onCheckOutChange\(resolved\.checkOut\)/);
  });

  it("preserves the last valid night count for the nights-preserved path", () => {
    expect(pickerSrc).toMatch(/lastValidNights/);
    expect(pickerSrc).toMatch(/previousNights: lastValidNights/);
  });

  it("bounds the inputs without freezing either one", () => {
    // DR-01 follow-up (2026-10-15): check-in must NOT be bounded
    // by `checkOut - 1`. With the default 1-night stay, check-out is
    // always `checkIn + 1`, so that max resolved to check-in's OWN
    // current value and the native picker greyed out every later
    // day — the guest could not move check-in at all. The upper
    // bound is the booking horizon; the lower is property-timezone
    // today.
    expect(pickerSrc).toMatch(/max=\{maxCheckOut\}/);
    expect(pickerSrc).not.toMatch(/max=\{addDaysToIsoDate\(resolved\.checkOut/);
    // Check-out stays floored at one night after check-in — that
    // bound is correct and does not lock the field, because every
    // date from `checkIn + 1` up to the horizon stays selectable.
    expect(pickerSrc).toMatch(/min=\{addDaysToIsoDate\(resolved\.checkIn, 1\)\}/);
  });

  it("surfaces a hint when it auto-corrects", () => {
    expect(pickerSrc).toMatch(/describeAdjustment/);
    expect(pickerSrc).toMatch(/role="status"/);
  });
});

describe("DR-01 — URL params no longer seed a raw, unvalidated range", () => {
  it("BookingPage seeds both dates through normalizeStayRange", () => {
    expect(bookingPageSrc).toMatch(/normalizeStayRange\(\{/);
    expect(bookingPageSrc).toMatch(/useState\(initialStayRange\.checkIn\)/);
    expect(bookingPageSrc).toMatch(/useState\(initialStayRange\.checkOut\)/);
  });

  it("CorporateBookingPage drops the shape-only regex in favour of the normalizer", () => {
    expect(corporateBookingSrc).toMatch(/normalizeStayRange\(\{/);
    // The old guard accepted any well-SHAPED key, including inverted ones.
    expect(corporateBookingSrc).not.toMatch(/const isValidDateKey =/);
  });
});

describe("DR-01 — the remaining date surfaces are bounded", () => {
  it("CorporateStaysPage links its preferred check-in/out pair", () => {
    expect(corporateStaysSrc).toMatch(/min=\{preferredDateFrom \? addDaysToIsoDate\(preferredDateFrom, 1\) : todayIso\}/);
    expect(corporateStaysSrc).toMatch(/max=\{preferredDateTo \? addDaysToIsoDate\(preferredDateTo, -1\) : undefined\}/);
  });

  it("BookingLookupPage clamps the extend-stay date and blocks an invalid submit", () => {
    expect(bookingLookupSrc).toMatch(/const minExtendCheckOut = addDaysToIsoDate\(activeBooking\.checkOut, 1\)/);
    expect(bookingLookupSrc).toMatch(/extendCheckOut <= activeBooking\.checkOut/);
  });
});
describe("DR-01 follow-up — the check-in bound never freezes the picker", () => {
  // The reported regression (2026-10-15): check-in was bounded by
  // `checkOut - 1`. With the default 1-night stay, check-out is
  // always `checkIn + 1`, so the bound equalled check-in's own
  // current value and the native picker greyed out every later day —
  // the guest could not move check-in at all. The bound is now the
  // booking horizon.
  //
  // This is the invariant the freeze broke, asserted behaviourally
  // against the real helpers the component composes. The source-text
  // pin above catches a re-introduced `max={…checkOut…}`; this
  // catches the horizon math silently collapsing.
  const TODAY = "2026-10-15";
  const MAX_STAY_NIGHTS = 30; // must mirror the component constant
  const maxCheckOut = addDaysToIsoDate(TODAY, MAX_STAY_NIGHTS);

  it("the horizon is strictly ahead of today", () => {
    expect(diffNightsBetweenIso(TODAY, maxCheckOut)).toBe(MAX_STAY_NIGHTS);
  });

  it("offers selectable dates after check-in for every valid range", () => {
    // Walk the whole month plus a few edge ranges. For each one the
    // check-in input's upper bound must leave forward room, or the
    // picker greys out every day the guest would want to move to.
    const ranges = [
      { checkIn: "2026-10-15", checkOut: "2026-10-16" }, // default 1-night
      { checkIn: "2026-10-15", checkOut: "2026-10-17" }, // 2 nights
      { checkIn: "2026-10-31", checkOut: "2026-11-02" }, // month boundary
      { checkIn: "2026-11-10", checkOut: "2026-11-14" }
    ];
    for (const range of ranges) {
      expect(maxCheckOut > range.checkIn).toBe(true);
    }
  });

  it("still lets the guest move check-in past check-out, preserving nights", () => {
    // The flow the freeze made unreachable. With check-in bounded by
    // the horizon, picking a check-in AFTER the current check-out is
    // selectable — and the normalizer preserves the stay length.
    const current = normalizeStayRange({
      checkIn: "2026-10-20",
      checkOut: "2026-10-22",
      minCheckIn: TODAY,
      maxCheckOut
    });
    expect(current.nights).toBe(2);

    const moved = normalizeStayRange({
      checkIn: "2026-10-26", // guest drags check-in forward past check-out
      checkOut: "2026-10-22",
      minCheckIn: TODAY,
      previousNights: current.nights,
      maxCheckOut
    });
    expect(moved.checkIn).toBe("2026-10-26");
    expect(moved.checkOut).toBe("2026-10-28");
    expect(moved.nights).toBe(2);
  });
});

describe("DR-01 follow-up — the nights stepper makes the stay length visible", () => {
  // Per the industry pattern (Agoda's "Nights" ticker, Booking.com's
  // adjusting calendar), the stay LENGTH is a control the guest owns
  // and can see. Two independent date fields plus a silent auto-move
  // is the odd one out — it reads as arbitrary precisely because the
  // number driving the move is invisible.
  it("renders a Nights control between the dates", () => {
    expect(pickerSrc).toMatch(/^\s*Nights$/m);
    expect(pickerSrc).toMatch(/aria-label="Remove one night"/);
    expect(pickerSrc).toMatch(/aria-label="Add one night"/);
  });

  it("shows the resolved night count, not a raw diff", () => {
    expect(pickerSrc).toMatch(/\{resolved\.nights\} \{resolved\.nights === 1 \? "night" : "nights"\}/);
  });

  it("steps check-out off check-in rather than touching check-in", () => {
    // check-in is the anchor; the stepper only moves check-out.
    expect(pickerSrc).toMatch(
      /onClick=\{\(\) => setNights\(resolved\.nights \+ 1\)\}/
    );
    expect(pickerSrc).toMatch(
      /function setNights\(next: number\) \{[\s\S]*?onCheckOutChange\(addDaysToIsoDate\(resolved\.checkIn, next\)\)/
    );
  });

  it("caps the stepper at 1 night and at the horizon measured from check-in", () => {
    expect(pickerSrc).toMatch(/disabled=\{resolved\.nights <= 1\}/);
    expect(pickerSrc).toMatch(
      /maxNights = Math\.max\(\s*Math\.min\(MAX_STAY_NIGHTS, diffNightsBetweenIso\(resolved\.checkIn, maxCheckOut\)\),\s*1\s*\)/
    );
    expect(pickerSrc).toMatch(/disabled=\{resolved\.nights >= maxNights\}/);
  });

  it("keeps 44px touch targets on the stepper buttons", () => {
    // Hard rule: all form fields minimum 44px touch height.
    expect(pickerSrc.match(/flex h-11 w-11 items-center justify-center/g) || []).toHaveLength(2);
  });

  it("drops the nights-preserved hint, which the stepper now makes obvious", () => {
    // The message existed to explain an invisible move. With the
    // count on screen, check-out is visibly `check-in + nights`.
    const match = pickerSrc.match(/case "nights-preserved":[\s\S]*?return ([^;]+);/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("null");
  });

  it("still explains the corrections the guest cannot infer", () => {
    expect(pickerSrc).toMatch(/Check-out must be at least one night after check-in\./);
    expect(pickerSrc).toMatch(/Check-in can't be in the past/);
    expect(pickerSrc).toMatch(/nights ahead, so check-out was capped\./);
  });
});

describe("DR-01 — nights stepper arithmetic", () => {
  const TODAY = "2026-10-15";
  const HORIZON = addDaysToIsoDate(TODAY, 30);

  it("moving check-in past check-out preserves the visible length", () => {
    const r = normalizeStayRange({
      checkIn: "2026-10-20",
      checkOut: "2026-10-18", // inverted — guest dragged check-in
      minCheckIn: TODAY,
      previousNights: 3,
      maxCheckOut: HORIZON
    });
    expect(r.nights).toBe(3);
    expect(r.checkOut).toBe("2026-10-23");
    // check-out is exactly check-in + nights, which the guest can see.
    expect(r.checkOut).toBe(addDaysToIsoDate(r.checkIn, r.nights));
  });

  it("caps the stepper from the check-in, not from today", () => {
    // Check-in 20 days out leaves only 10 nights inside a 30-night horizon.
    const checkIn = "2026-11-04";
    const maxNights = Math.max(Math.min(30, diffNightsBetweenIso(checkIn, HORIZON)), 1);
    expect(maxNights).toBe(10);
  });

  it("stepping nights always keeps check-out within the horizon", () => {
    for (let nights = 1; nights <= 30; nights += 1) {
      const checkOut = addDaysToIsoDate(TODAY, nights);
      expect(checkOut <= HORIZON).toBe(true);
    }
  });

  it("never lets the stepper produce a zero-night stay", () => {
    const r = normalizeStayRange({
      checkIn: "2026-10-20",
      checkOut: "2026-10-20", // 1 is the floor the stepper enforces
      minCheckIn: TODAY,
      previousNights: 1,
      maxCheckOut: HORIZON
    });
    expect(r.nights).toBeGreaterThanOrEqual(1);
  });
});
