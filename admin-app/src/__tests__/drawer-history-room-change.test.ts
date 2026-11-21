// Per ATR-10 (2026-11-21, `plan/features/AUDIT-TRAIL.md`):
// a room change MUST show up in the booking drawer's history.
//
// THE REPORTED BUG
// ----------------
// "I did a room change for the booking, it was not tracked in the
// history in the booking drawer."
//
// The WRITE was always correct: the server appends the change to
// `booking.rescheduleHistory[]` inside the same transaction that
// re-assigns the room (`handleAssignBookingRoom`) or re-dates the
// stay (`handleRescheduleBooking`). The desk's room change WAS
// recorded.
//
// The READ was lossy, in TWO places:
//
//   1. The admin app's bookings mapper (`AdminContext.tsx`) never
//      read `data.rescheduleHistory` — the same bug class as FOL-01
//      / FOL-02: the `Booking` type declares the field, the mapper
//      forgets to read it from the snapshot. `selectedBooking
//      .rescheduleHistory` was therefore ALWAYS `undefined`.
//   2. The drawer's History tab merged FOUR sources (the breakfast
//      trail, the other-add-on trail, the charge ledger and the
//      booking's own milestone stamps) and never read the fifth —
//      the room-change trail.
//
// The consequence cascaded: the drawer's Stay History panel is
// rendered only when `(selectedBooking.rescheduleHistory?.length ??
// 0) > 0`, so with the field never hydrated the panel NEVER
// RENDERED AT ALL, and the room change was invisible in the drawer.
//
// WHY THIS FILE IS A SOURCE-TEXT GUARD
// ------------------------------------
// The admin app has no component-test harness, so this file pins
// the wiring at the source level. The BEHAVIOURAL rules (which
// sentence a room change renders, what the actor resolves to) are
// unit-tested for real in `shared/__tests__/booking-history.test.ts`
// and rendered for real in `booking-history-render.test.tsx`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), "utf8");

const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const historySrc = read("admin-app/src/components/BookingHistoryTab.tsx");
const workspaceSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const sharedSrc = read("shared/utils/bookingHistory.ts");

// The `useEffect` that hydrates `bookings` from the collection
// snapshot — the same slice the FOL-02 guard uses.
const hydrationEffectStart = adminContextSrc.indexOf(
  "  useEffect(() => {\n    if (!currentUser) {\n      setBookings([]);"
);
const hydrationEffectEnd = adminContextSrc.indexOf(
  "    return () => {\n      active = false;\n      unsubscribe();\n    };\n  }, [currentUser]);"
);
const hydrationEffect =
  hydrationEffectStart >= 0 && hydrationEffectEnd > hydrationEffectStart
    ? adminContextSrc.slice(hydrationEffectStart, hydrationEffectEnd)
    : "";

describe("ATR-10 — the admin mapper hydrates the room-change trail", () => {
  it("the bookings hydration effect is present and locatable", () => {
    expect(hydrationEffect.length).toBeGreaterThan(0);
    expect(hydrationEffect).toMatch(/bookingsData\.push\(\{/);
  });

  it("reads `rescheduleHistory` off the snapshot (the FOL-02 bug class)", () => {
    // THE DEFECT: the `Booking` type declared `rescheduleHistory`,
    // the mapper never read it, so the drawer saw `undefined` and the
    // room change could not be rendered — no matter what the tab did.
    expect(hydrationEffect).toMatch(
      /rescheduleHistory:\s*Array\.isArray\(data\.rescheduleHistory\)\s*\?\s*data\.rescheduleHistory\s*:\s*\[\]/
    );
  });

  it("floors at `[]` so a booking without a room change reads as 'no change'", () => {
    // Never `undefined`: the drawer guards on
    // `(selectedBooking.rescheduleHistory?.length ?? 0) > 0`, and a
    // `[]` is the honest answer for a booking that never moved.
    expect(hydrationEffect).toMatch(/rescheduleHistory:[\s\S]{0,120}:\s*\[\]/);
  });
});

describe("ATR-10 — the shared module maps the room-change trail", () => {
  it("exports the single-entry mapper and the booking-level builder", () => {
    expect(sharedSrc).toMatch(/export function rescheduleHistoryEvent\(/);
    expect(sharedSrc).toMatch(/export function rescheduleHistoryEvents\(/);
  });

  it("has a dedicated event kind for a room change", () => {
    expect(sharedSrc).toMatch(/\|\s*"room-change"/);
  });

  it("never turns an email actor into a uid (an address is PII)", () => {
    // The server writes `req.staff?.uid || req.staff?.email`. The
    // email branch must not become an identity on a staff surface.
    expect(sharedSrc).toMatch(/if \(text\.includes\("@"\)\) return null;/);
  });

  it("keeps the behavioural rules unit-tested in the shared package", () => {
    const sharedTest = read("shared/__tests__/booking-history.test.ts");
    expect(sharedTest).toMatch(/rescheduleHistoryEvents/);
    expect(sharedTest).toMatch(/rescheduleHistoryEvent/);
  });
});

describe("ATR-10 — the drawer's History tab merges the room-change trail", () => {
  it("reads the trail off the booking document", () => {
    expect(historySrc).toMatch(/rescheduleHistoryEvents\(booking\)/);
  });

  it("merges it into the timeline with the other four sources", () => {
    expect(historySrc).toMatch(
      /mergeBookingHistoryEvents\(\s*trailEvents,\s*chargeEvents,\s*milestoneEvents,\s*rescheduleEvents\s*\)/
    );
  });

  it("shows the price delta a move produced", () => {
    // A room OVERRIDE has a delta of 0 and shows no badge (the shared
    // mapper floors it at `null`); a MOVE shows what it cost.
    expect(historySrc).toMatch(/event\.kind === "room-change"/);
  });

  it("gives a room change its own icon", () => {
    expect(historySrc).toMatch(/case "room-change":/);
  });

  it("mentions room changes in the empty state", () => {
    expect(historySrc).toMatch(/room changes and check-ins/);
  });
});

describe("ATR-10 — the Stay History panel resolves its actor", () => {
  it("resolves the staff uid through the ONE shared resolver", () => {
    // The panel used to print `entry.by` verbatim — a raw 28-character
    // uid (GOTCHAS §Security & PII). The leak stayed hidden because
    // the mapper never hydrated the field, so the panel never
    // rendered; now that it does, the leak would ship.
    expect(workspaceSrc).toMatch(/staffNameFor\(staffNameMap, entry\.by, "Staff"\)/);
  });

  it("no longer prints the raw uid (or an email's local part)", () => {
    expect(workspaceSrc).not.toMatch(/entry\.by\?\.includes\("@"\)/);
  });

  it("labels a room override for what it is (not 'Moved / upgraded room')", () => {
    expect(workspaceSrc).toMatch(/isRoomOverride/);
    expect(workspaceSrc).toMatch(/"Room changed"/);
  });

  it("the drawer still renders the panel from the hydrated field", () => {
    expect(pageSrc).toMatch(
      /<StayHistory entries=\{selectedBooking\.rescheduleHistory \?\? \[\]\} \/>/
    );
  });
});

describe("ATR-10 — the render test proves the reported bug is gone", () => {
  it("keeps a render test that shows a room change on the screen", () => {
    const renderTest = read("admin-app/src/__tests__/booking-history-render.test.tsx");
    expect(renderTest).toMatch(/renderToStaticMarkup/);
    expect(renderTest).toMatch(/rescheduleHistory/);
    expect(renderTest).toMatch(/Changed room/);
    // The raw uid must never reach the screen.
    expect(renderTest).toMatch(/not\.toContain\("uid-juan"\)/);
  });
});
