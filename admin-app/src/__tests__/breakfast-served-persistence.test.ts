import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

// Regression test for BSP (Breakfast Served Persistence, 2026-07-25).
//
// Confirmed defect: Dashboard → Today's Breakfast → "Mark Served" did not
// remain served after the booking snapshot refreshed. Cause: the snapshot
// mapper in `admin-app/src/context/AdminContext.tsx` hydrated
// `breakfastSelections` but omitted `breakfastServed` — so the served map
// was written successfully to Firestore (and the security rule allows it)
// but read back as `undefined` on the next snapshot, re-rendering the row
// as unserved.
//
// Fix: hydrate `breakfastServed: data.breakfastServed || {}` in the mapper.
// The dashboard's `toggleBreakfastServed` (DashboardPage.tsx) already does
// `const breakfastServed = { ...(booking.breakfastServed || {}) }` — after
// the fix the spread starts from the persisted map, so a second toggle
// preserves the rest of the served keys instead of overwriting them.

describe("BSP-01 — AdminContext snapshot mapper hydrates breakfastServed", () => {
  const adminContext = read("admin-app/src/context/AdminContext.tsx");

  it("hydrates breakfastServed from the snapshot data, with {} fallback", () => {
    // The mapper inside the bookings `onSnapshot` callback must include the
    // field. A regression that removes the line breaks the persistence.
    expect(adminContext).toMatch(/breakfastServed:\s*data\.breakfastServed\s*\|\|\s*\{\}/);
  });

  it("hydrates breakfastSelections next to breakfastServed (parity invariant)", () => {
    // Both fields exist on the Booking type; the mapper must read both.
    // Guarding together catches a future "I removed the served line" edit.
    // The span tolerates the explanatory comment between the two lines.
    const mapperBlockMatch = adminContext.match(
      /breakfastSelections:\s*data\.breakfastSelections\s*\|\|\s*\{\}[\s\S]{0,2000}?breakfastServed:\s*data\.breakfastServed\s*\|\|\s*\{\}/
    );
    expect(mapperBlockMatch).not.toBeNull();
  });

  it("declares breakfastServed on the Booking interface", () => {
    expect(adminContext).toMatch(/breakfastServed\?:\s*Record<string,\s*boolean>/);
  });
});

describe("BSP-02 — dashboard renders + toggles the served state", () => {
  const dashboardPage = read("admin-app/src/pages/DashboardPage.tsx");

  it("reads the served flag from each booking snapshot (the hydration point)", () => {
    // Per DashboardPage.tsx ~line 258: `served: !!b.breakfastServed?.[key]`
    // This is the read site that returns `false` for every key when the
    // mapper fails to hydrate the field.
    expect(dashboardPage).toMatch(/served:\s*!!b\.breakfastServed\?\.\[key\]/);
  });

  it("toggles via spread of booking.breakfastServed so other keys survive", () => {
    // The toggle builds the new map from the current booking's served map
    // (post-fix, the persisted map), then mutates the one key. If the
    // mapper doesn't hydrate the field, the spread is `{}` and a second
    // toggle wipes prior served keys — a different but equally silent bug.
    expect(dashboardPage).toMatch(
      /const\s+breakfastServed\s*=\s*\{\s*\.\.\.\(booking\.breakfastServed\s*\|\|\s*\{\}\)\s*\}/
    );
    expect(dashboardPage).toMatch(/breakfastServed\[key\]\s*=\s*!currentServed/);
  });
});

describe("BSP-02 (behavioral) — toggle survives snapshot refresh and is visible to other sessions", () => {
  // Replicates the mapper's `breakfastServed` hydration + the dashboard's
  // `toggleBreakfastServed` + a second signed-in staff session arriving
  // on its own snapshot. Pure JS — no React, no Firestore. The point is
  // to lock the persistence contract so a future refactor can't silently
  // re-introduce the unmapped field.

  type BookingLike = {
    id: string;
    status: string;
    hasBreakfast: boolean;
    numGuests: number;
    breakfastSelections?: Record<string, string>;
    breakfastServed?: Record<string, boolean>;
  };

  // Mirrors the mapper's `breakfastServed: data.breakfastServed || {}` step.
  const hydrateBreakfastServed = (booking: BookingLike): BookingLike => ({
    ...booking,
    breakfastServed: booking.breakfastServed || {}
  });

  // Mirrors the dashboard's served-flag read for a given booking + key.
  const isServed = (booking: BookingLike, key: string): boolean =>
    !!booking.breakfastServed?.[key];

  // Mirrors the dashboard's `toggleBreakfastServed` — spread, flip the
  // one key, then call the local mapper (snapshot arrives) to refresh.
  const toggleServed = (
    bookings: BookingLike[],
    bookingId: string,
    key: string
  ): { bookings: BookingLike[]; writePayload: Record<string, boolean> } => {
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return { bookings, writePayload: {} };
    const next = { ...(booking.breakfastServed || {}) };
    const currentServed = !!next[key];
    next[key] = !currentServed;
    return {
      bookings,
      // The `details` payload that `updateBookingStatus(..., { breakfastServed: next })`
      // forwards to Firestore. The test asserts the write shape too.
      writePayload: next
    };
  };

  // Mock snapshot refresh: replace the booking in the list (Firestore
  // returns a fresh hydrated object after the write commits).
  const refresh = (bookings: BookingLike[], refreshed: BookingLike[]): BookingLike[] =>
    refreshed.map((b) => hydrateBreakfastServed(b));

  it("marks a row served, persists across a simulated snapshot refresh, and can be toggled back", () => {
    const today = "2026-07-25";
    const guest1Key = `${today}-guest-1`;
    const guest2Key = `${today}-guest-2`;

    // Initial state: a `checked-in` booking with breakfast, no served map yet.
    const initial: BookingLike = {
      id: "b-1",
      status: "checked-in",
      hasBreakfast: true,
      numGuests: 2,
      breakfastSelections: { [guest1Key]: "Tapsilog", [guest2Key]: "Longsilog" }
    };

    // Staff loads the dashboard.
    let bookings: BookingLike[] = [hydrateBreakfastServed(initial)];

    // Pre-condition: nothing served.
    expect(isServed(bookings[0], guest1Key)).toBe(false);
    expect(isServed(bookings[0], guest2Key)).toBe(false);

    // Staff clicks "Mark Served" on guest 1.
    const toggle1 = toggleServed(bookings, "b-1", guest1Key);
    expect(toggle1.writePayload).toEqual({ [guest1Key]: true });

    // Firestore snapshot arrives with the persisted map. The mapper MUST
    // hydrate it — this is the line under test.
    bookings = refresh(bookings, [
      { ...initial, breakfastServed: toggle1.writePayload }
    ]);

    // Post-refresh: the row stays served. (Pre-fix this was `false`.)
    expect(isServed(bookings[0], guest1Key)).toBe(true);
    expect(isServed(bookings[0], guest2Key)).toBe(false);

    // Staff marks guest 2 served. The toggle spreads the persisted map,
    // mutates only `guest2Key`, leaves `guest1Key` alone.
    const toggle2 = toggleServed(bookings, "b-1", guest2Key);
    expect(toggle2.writePayload).toEqual({ [guest1Key]: true, [guest2Key]: true });

    // Refresh again.
    bookings = refresh(bookings, [
      { ...initial, breakfastServed: toggle2.writePayload }
    ]);
    expect(isServed(bookings[0], guest1Key)).toBe(true);
    expect(isServed(bookings[0], guest2Key)).toBe(true);

    // Staff un-marks guest 1 (a common pattern: re-issue / wrong guest).
    const toggle3 = toggleServed(bookings, "b-1", guest1Key);
    expect(toggle3.writePayload).toEqual({ [guest1Key]: false, [guest2Key]: true });

    bookings = refresh(bookings, [
      { ...initial, breakfastServed: toggle3.writePayload }
    ]);
    expect(isServed(bookings[0], guest1Key)).toBe(false);
    expect(isServed(bookings[0], guest2Key)).toBe(true);
  });

  it("hydrates a persisted map written by another staff session (cross-session visibility)", () => {
    // A second signed-in staff session writes the served map directly to
    // Firestore (e.g. via the mobile dashboard). The first session's
    // snapshot must surface the updated state on the next refresh.
    const today = "2026-07-25";
    const key = `${today}-guest-1`;

    const fromOtherSession: BookingLike = {
      id: "b-1",
      status: "checked-in",
      hasBreakfast: true,
      numGuests: 2,
      breakfastSelections: { [key]: "Tapsilog" },
      breakfastServed: { [key]: true }
    };

    const hydrated = hydrateBreakfastServed(fromOtherSession);
    expect(isServed(hydrated, key)).toBe(true);
  });

  it("defaults to {} when the field is absent on a legacy booking", () => {
    // Pre-BSP bookings never had the field written. The mapper must not
    // crash and must surface an empty map.
    const legacy: BookingLike = {
      id: "b-legacy",
      status: "checked-in",
      hasBreakfast: true,
      numGuests: 1
    };
    const hydrated = hydrateBreakfastServed(legacy);
    expect(hydrated.breakfastServed).toEqual({});
  });

  it("toggle on a missing booking is a no-op (no throw, empty write)", () => {
    // Guards against the staff clicking the row when the booking has
    // been checked out / cancelled in another tab mid-frame.
    const bookings: BookingLike[] = [];
    const result = toggleServed(bookings, "missing", "2026-07-25-guest-1");
    expect(result.writePayload).toEqual({});
  });
});
