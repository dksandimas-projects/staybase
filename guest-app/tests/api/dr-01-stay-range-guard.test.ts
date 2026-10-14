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

  it("mutually bounds the two inputs so neither can invert the pair", () => {
    expect(pickerSrc).toMatch(/max=\{addDaysToIsoDate\(resolved\.checkOut, -1\)\}/);
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