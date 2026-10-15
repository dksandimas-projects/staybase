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
  normalizeStayRange,
  resolveRangeSelection
} from "@spark-inn/shared";

const read = (relative: string) =>
  readFileSync(resolve(__dirname, "../../..", relative), "utf8");

const handlersSrc = read("guest-app/server/handlers/bookings.ts");
const pickerSrc = read("guest-app/src/components/DateRangePicker.tsx");
const stylesSrc = read("guest-app/src/styles.css");
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

describe("DR-02 — DateRangePicker is a range calendar, not two date inputs", () => {
  it("renders react-day-picker in range mode", () => {
    // The whole point of DR-02: one calendar, one range being drawn.
    // An inverted range is not representable, so the clamp/correct
    // machinery around two independent fields is no longer the
    // primary defence against it.
    expect(pickerSrc).toMatch(/<DayPicker/);
    expect(pickerSrc).toMatch(/mode="range"/);
  });

  it("commits through the pure resolver, not ad-hoc inline logic", () => {
    expect(pickerSrc).toMatch(/resolveRangeSelection\(\{/);
    expect(pickerSrc).toMatch(/selection\.status === "complete"/);
    expect(pickerSrc).toMatch(/selection\.status === "cleared"/);
  });

  it("holds the first click as pending instead of committing it", () => {
    // Committing after click #1 fires an availability refetch, and
    // BookingPage replaces itself with a full-page loader that
    // unmounts this picker — the click would silently vanish.
    expect(pickerSrc).toMatch(/setDraft\(\{ from: isoToTzDate\(selection\.checkIn\), to: undefined \}\)/);
  });

  it("keeps a draft range separate from the committed pair", () => {
    expect(pickerSrc).toMatch(/const \[draft, setDraft\] = useState<DateRange \| undefined>/);
    expect(pickerSrc).toMatch(/\}, \[resolved\.checkIn, resolved\.checkOut\]\)/);
  });

  it("still self-heals a bad pair arriving from outside the calendar", () => {
    expect(pickerSrc).toMatch(/if \(resolved\.checkIn !== checkIn\) onCheckInChange\(resolved\.checkIn\)/);
    expect(pickerSrc).toMatch(/if \(resolved\.checkOut !== checkOut\) onCheckOutChange\(resolved\.checkOut\)/);
    expect(pickerSrc).toMatch(/normalizeStayRange\(\{/);
  });

  it("bounds the calendar to today .. the booking horizon", () => {
    expect(pickerSrc).toMatch(/startMonth=\{startMonth\}/);
    expect(pickerSrc).toMatch(/endMonth=\{endMonth\}/);
    expect(pickerSrc).toMatch(/disabled=\{\{ before: startMonth, after: endMonth \}\}/);
  });

  it("themes the selected range with the brand primary colour", () => {
    // Hard rule: primary CTAs use config.colors.primary.
    // react-day-picker ships a blue default, which would put an
    // off-brand colour on the most prominent element in the flow.
    //
    // The brand token is set on the wrapper as `--spark-primary`; the
    // `--rdp-*` mapping MUST live in the stylesheet. Setting
    // `--rdp-accent-color` on the wrapper does not work, because
    // react-day-picker declares its variables on `.rdp-root`, which is
    // INSIDE the wrapper and therefore wins. The derived range vars also
    // resolve `var(--rdp-accent-color)` at their point of DECLARATION
    // (on `.rdp-root`), so an ancestor override cannot reach them at
    // all. Hence `.spark-range-root` + a descendant rule.
    expect(pickerSrc).toMatch(/"--spark-primary": config\.colors\.primary/);
    // `rdp-root` MUST be kept: `classNames` shallow-merges over the
    // defaults, so dropping it un-defines every `--rdp-*` variable and
    // collapses the day cells from 42px to their text width.
    expect(pickerSrc).toMatch(/classNames=\{\{ root: "rdp-root spark-range-root" \}\}/);
    expect(pickerSrc).not.toMatch(/"--rdp-accent-color": config\.colors\.primary/);
    expect(stylesSrc).toMatch(/\.spark-date-range \.spark-range-root/);
    expect(stylesSrc).toMatch(/--rdp-range_start-date-background-color: var\(--spark-primary\)/);
    expect(stylesSrc).toMatch(/--rdp-range_middle-background-color: var\(--spark-primary\)/);
    expect(stylesSrc).toMatch(/--rdp-range_end-date-background-color: var\(--spark-primary\)/);
  });

  it("THE DECEMBER REGRESSION: a click starts a new stay, never extends the old one", () => {
    // react-day-picker's `addToRange` tests `isAfter(date, from)` BEFORE
    // `isAfter(date, to)`, so with a complete range on screen every click
    // after the check-in is absorbed as "move the check-out here" and the
    // old `from` is kept. A guest picking a December stay instead stretched
    // their current one, which read as "December is unreachable". We drive
    // the range from `onDayClick` so only a PENDING check-in can be
    // completed by the next click.
    expect(pickerSrc).toMatch(/onDayClick=\{handleDayClick\}/);
    expect(pickerSrc).not.toMatch(/onSelect=\{/);
    // (wrapped by prettier, so match the predicate without the line break)
    expect(pickerSrc.replace(/\s+/g, " ")).toMatch(
      /const completesPending = fromIso !== null && toIso === null && clicked > fromIso/
    );
    expect(pickerSrc).toMatch(/const nextFrom = completesPending \? draft!\.from! : day/);
    expect(pickerSrc).toMatch(/const nextTo = completesPending \? day : undefined/);
  });

  it("commits the pair atomically so URL params cannot half-apply (DR-03)", () => {
    // The picker fires onCheckInChange then onCheckOutChange. Both
    // handlers close over the same render's `checkIn`, so the second one
    // rewrote the URL from a STALE value and clobbered the check-in the
    // first had written (`?checkIn=2026-10-15&checkOut=2026-12-24` on a
    // December booking). `onRangeChange` hands over both dates at once.
    expect(pickerSrc).toMatch(
      /onRangeChange\?: \(checkIn: string, checkOut: string\) => void/
    );
    expect(pickerSrc.replace(/\s+/g, " ")).toMatch(
      /if \(onRangeChange\) \{ onRangeChange\(selection\.checkIn, selection\.checkOut\);/
    );
    expect(bookingPageSrc).toMatch(
      /onRangeChange=\{\(nextCheckIn, nextCheckOut\) => \{/
    );
    expect(bookingPageSrc).toMatch(
      /updateDateParams\(nextCheckIn, nextCheckOut, adults\)/
    );
    expect(corporateBookingSrc).toMatch(
      /updateDateParams\(nextCheckIn, nextCheckOut, guests\)/
    );
  });

  it("pins the calendar to the hotel timezone (DR-03)", () => {
    // Every date handed to `DayPicker` is a `TZDate` built for
    // `config.timezone`. Without `timeZone`, the picker's internal DateLib
    // runs in the BROWSER's timezone, so its day cells and our `selected`
    // values disagree: a deep-linked December stay rendered with nothing
    // selected, and a picked one painted `range_middle` across every day
    // from the start of the grid. Passing the zone makes both sides agree.
    expect(pickerSrc).toMatch(/timeZone=\{config\.timezone\}/);
  });

  it("shows the resolved range and night count as text", () => {
    expect(pickerSrc).toMatch(/\{nights\} \{nights === 1 \? "night" : "nights"\}/);
  });

  it("no longer ships the nights stepper", () => {
    // Replaced by the range band: the length is already legible, and
    // a second control to change it competes with clicking the band.
    expect(pickerSrc).not.toMatch(/aria-label="Add one night"/);
    expect(pickerSrc).not.toMatch(/aria-label="Remove one night"/);
  });

  it("shows two months only where there is room", () => {
    expect(pickerSrc).toMatch(/matchMedia\("\(min-width: 768px\)"\)/);
    expect(pickerSrc).toMatch(/numberOfMonths=\{twoMonths \? 2 : 1\}/);
  });

  it("only explains corrections the guest cannot infer", () => {
    expect(pickerSrc).toMatch(/Check-in can't be in the past/);
  });

  it("separates the booking horizon from the stay-length cap (DR-03)", () => {
    // THE DECEMBER REGRESSION. `MAX_STAY_NIGHTS` doubled as the booking
    // horizon, so `maxCheckOut = today + 30` capped the calendar at
    // Nov 14 and December could not be reached at all.
    expect(pickerSrc).toMatch(/const MAX_STAY_NIGHTS = 30/);
    expect(pickerSrc).toMatch(/const BOOKING_HORIZON_DAYS = DEFAULT_BOOKING_HORIZON_DAYS/);
    expect(pickerSrc).toMatch(/addDaysToIsoDate\(todayIso, BOOKING_HORIZON_DAYS\)/);
    // The night cap must still reach the resolver, or widening the
    // horizon to a year would silently allow a 200-night booking.
    expect(pickerSrc).toMatch(/maxNights: MAX_STAY_NIGHTS/);
    // Neither message may quote the other's number.
    expect(pickerSrc).toMatch(/Bookings open \$\{BOOKING_HORIZON_DAYS\} days ahead/);
    expect(pickerSrc).toMatch(/at most \$\{MAX_STAY_NIGHTS\} nights/);
  });

  it("layers the calendar over the page on phones only (DR-03)", () => {
    // Inline on mobile the grid fell below the fold and was clipped by
    // the sticky cart bar, so a guest could not see most of it.
    expect(pickerSrc).toMatch(/fixed inset-x-0 bottom-0 top-16 overflow-y-auto/);
    expect(pickerSrc).toMatch(/md:static/);
    // The backdrop is phone-only — dimming the page behind an inline
    // desktop card would be wrong.
    expect(pickerSrc).toMatch(/fixed inset-0 z-40 bg-gray-950\/40 md:hidden/);
    // Touch targets: the sheet's only exits are the header X and Done.
    expect(pickerSrc).toMatch(/aria-label="Close calendar"/);
    expect(pickerSrc).toMatch(/className="flex h-11 w-11 items-center justify-center/);
    expect(pickerSrc).toMatch(/style=\{\{ backgroundColor: config\.colors\.primary \}\}/);
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
describe("DR-02 — the horizon always leaves selectable days ahead", () => {
  // The reported regression (2026-10-15) was a frozen picker: check-in
  // was bounded by `checkOut - 1`, which with the default 1-night stay
  // equalled check-in's own value, so every later day greyed out. The
  // calendar no longer has per-input bounds — it disables by horizon
  // — so the invariant to protect is that the horizon always sits
  // strictly ahead of today, leaving real room to move.
  const TODAY = "2026-10-15";
  const MAX_STAY_NIGHTS = 30; // must mirror the component constant
  const maxCheckOut = addDaysToIsoDate(TODAY, MAX_STAY_NIGHTS);

  it("the horizon is strictly ahead of today", () => {
    expect(diffNightsBetweenIso(TODAY, maxCheckOut)).toBe(MAX_STAY_NIGHTS);
  });

  it("never bounds a selection by the other endpoint", () => {
    // The precise anti-pattern. `max={…checkOut - 1}` on a check-in
    // input, or any equivalent coupling, reintroduces the freeze.
    expect(pickerSrc).not.toMatch(/max=\{[^}]*checkOut/);
    expect(pickerSrc).not.toMatch(/min=\{[^}]*checkIn/);
  });

  it("lets a guest move check-in past check-out by restarting the range", () => {
    const moved = resolveRangeSelection({
      from: "2026-10-20",
      to: "2026-10-22",
      minCheckIn: TODAY,
      maxCheckOut
    });
    expect(moved.status).toBe("complete");
    // Clicking again before the pending check-in restarts rather than
    // inverting — the calendar has no "invalid" state to repair.
    const restarted = resolveRangeSelection({
      from: "2026-10-20",
      to: "2026-10-18",
      minCheckIn: TODAY,
      maxCheckOut
    });
    expect(restarted).toEqual({ status: "pending", checkIn: "2026-10-20" });
  });
});
