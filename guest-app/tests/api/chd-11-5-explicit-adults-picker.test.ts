// Per CHD-11.5 (2026-08-05, per decision #196): source-text
// regression tests for the "explicit Adults + Children
// picker (replace Guests stepper with Adults stepper)"
// UX refinement. The pre-CHD-11.5 surface asked for
// Guests (the total) + Children (a sub-count), with
// `numAdults` derived as `guests - numChildren`. The
// new shape asks for Adults + Children directly, with
// the total `guests = adults + numChildren` derived.
//
// What the user sees:
//   1. The "Guests" stepper becomes the "Adults" stepper.
//      Min 1, max `maxGuestCapacity`. The "at least 1
//      adult" rule (per CHD-05) is enforced at the picker.
//   2. The Children stepper stays. Min 0, max 10
//      (CHD-11.2's soft cap).
//   3. The total `guests` is derived as
//      `adults + numChildren` (used by the server + the
//      cart summary + display).
//   4. URL contract: `?adults=N&children=N` (replaces
//      `?guests=N&children=N`). Backward compat: the
//      URL reader also accepts `?guests=N&children=N`
//      and derives `adults = max(1, guests - numChildren)`.
//   5. The `selectedMaxSelectableChildren` derivation
//      simplifies: for each candidate child count N,
//      the effective total is `adults + N` (no auto-bump).
//   6. The `HomePage` URL writing writes `?adults=N&children=N`
//      (no `guests` param).
//   7. The submit gate's `numAdults >= 1` check stays
//      as defense in depth.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

const homePageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/HomePage.tsx"),
  "utf8"
);

describe("CHD-11.5 — explicit Adults + Children picker (replace Guests stepper with Adults stepper)", () => {
  it("the picker has an 'Adults' label (the new primary control)", () => {
    // The pre-CHD-11.5 picker had a "Guests" label.
    // The new picker has an "Adults" label.
    expect(bookingPageSrc).toMatch(/>\s*Adults\s*</);
  });

  it("the picker has an 'Add one adult' + 'Remove one adult' aria-label (not 'Add one guest' / 'Remove one guest')", () => {
    // The Adults stepper's buttons have the
    // new aria-labels.
    expect(bookingPageSrc).toMatch(/aria-label="Add one adult"/);
    expect(bookingPageSrc).toMatch(/aria-label="Remove one adult"/);
    // The pre-CHD-11.5 aria-labels are gone.
    expect(bookingPageSrc).not.toMatch(/aria-label="Add one guest"/);
    expect(bookingPageSrc).not.toMatch(/aria-label="Remove one guest"/);
  });

  it("the Adults stepper has `disabled={adults <= 1}` (min 1) and `disabled={adults >= maxGuestCapacity}` (max)", () => {
    // The Adults stepper enforces the
    // "at least 1 adult" rule at the picker
    // (min 1). The max is `maxGuestCapacity`.
    expect(bookingPageSrc).toMatch(/disabled=\{adults <= 1\}/);
    expect(bookingPageSrc).toMatch(/disabled=\{adults >= maxGuestCapacity\}/);
  });

  it("the `updateAdults` function is defined (replaces `updateGuests`)", () => {
    // The pre-CHD-11.5 `updateGuests` function
    // is gone. The new `updateAdults` function
    // is the primary control.
    expect(bookingPageSrc).toMatch(
      /function updateAdults\(nextAdults: number\)/
    );
    expect(bookingPageSrc).not.toMatch(
      /function updateGuests\(nextGuests: number\)/
    );
  });

  it("the `setOccupancy(nextAdults, nextChildren)` helper is defined (replaces `setOccupancy(nextGuests, nextChildren)`)", () => {
    // The pre-CHD-11.5 `setOccupancy(nextGuests,
    // nextChildren)` helper is gone. The new
    // helper takes `nextAdults` + `nextChildren`.
    expect(bookingPageSrc).toMatch(
      /function setOccupancy\(nextAdults: number, nextChildren: number\)/
    );
    expect(bookingPageSrc).not.toMatch(
      /function setOccupancy\(nextGuests: number, nextChildren: number\)/
    );
  });

  it("the `setOccupancy` helper writes `?adults=N&children=N` (not `?guests=N&children=N`)", () => {
    // The pre-CHD-11.5 `setOccupancy` wrote
    // `?guests=N&children=N`. The new shape
    // writes `?adults=N&children=N`. The
    // `setOccupancy` body uses `next.set("adults", ...)`
    // (not `next.set("guests", ...)`).
    expect(bookingPageSrc).toMatch(
      /next\.set\("adults", String\(safeAdults\)\)/
    );
    // The pre-CHD-11.5 `next.set("guests", ...)`
    // is gone from `setOccupancy`.
    const setOccupancyStart = bookingPageSrc.indexOf(
      "function setOccupancy(nextAdults: number, nextChildren: number)"
    );
    const setOccupancyEnd = bookingPageSrc.indexOf(
      "}\n\n  function updateAdults(",
      setOccupancyStart
    );
    const setOccupancyBody = bookingPageSrc.slice(
      setOccupancyStart,
      setOccupancyEnd
    );
    expect(setOccupancyBody).not.toMatch(/next\.set\("guests",/);
  });

  it("the URL reader reads `searchParams.get(\"adults\")` first, falls back to `searchParams.get(\"guests\")` (backward compat)", () => {
    // The URL reader at line 214 reads
    // `?adults=N` first. If absent, it falls
    // back to `?guests=N` (the historical
    // contract) and derives `adults = max(1,
    // guests - children)`.
    expect(bookingPageSrc).toMatch(
      /searchParams\.get\("adults"\)/
    );
    expect(bookingPageSrc).toMatch(
      /searchParams\.get\("guests"\)/
    );
  });

  it("the `numAdults` state is `adults` (not derived from `guests - numChildren`)", () => {
    // The pre-CHD-11.5 derivation was
    // `const numAdults = Math.max(0, guests - numChildren)`.
    // The new shape is `const numAdults = adults`
    // (the state itself).
    expect(bookingPageSrc).toMatch(
      /const numAdults = adults/
    );
    // The pre-CHD-11.5 derivation is gone.
    expect(bookingPageSrc).not.toMatch(
      /const numAdults = Math\.max\(0, guests - numChildren\)/
    );
  });

  it("the `guests` value is derived as `adults + numChildren` (not state)", () => {
    // The pre-CHD-11.5 `guests` was the
    // state. The new shape derives `guests`
    // as `adults + numChildren`.
    expect(bookingPageSrc).toMatch(
      /const guests = numAdults \+ numChildren/
    );
  });

  it("the `selectedMaxSelectableChildren` derivation uses the user's `adults` (no auto-bump)", () => {
    // The pre-CHD-11.5 derivation used
    // `effectiveGuests = max(guests, children + 1)`
    // (the historical auto-bump scenario). The
    // new shape uses the user's `adults`
    // directly (no auto-bump).
    expect(bookingPageSrc).toMatch(
      /numAdults: adults,/
    );
    // The pre-CHD-11.5 auto-bump formula
    // `effectiveGuests = max(guests, children + 1)`
    // is gone.
    expect(bookingPageSrc).not.toMatch(
      /const effectiveGuests = Math\.max\(guests, children \+ 1\)/
    );
  });

  it("the Children stepper's `+` button's `disabled` condition is `numChildren >= 10` (CHD-11.2's soft cap, unchanged)", () => {
    // The soft cap of 10 is unchanged. The
    // picker is now Adults + Children directly;
    // the per-type cap is gone (CHD-11.3);
    // the auto-bump is gone (CHD-11.4); the
    // "at least 1 adult" rule is enforced at
    // the Adults stepper's min (1). The only
    // picker-side constraint on children is
    // the soft 10 cap.
    expect(bookingPageSrc).toMatch(
      /disabled=\{numChildren >= 10\}/
    );
  });

  it("the submit gate's `numAdults >= 1` check stays (defense in depth)", () => {
    // The submit gate catches the 0-adults
    // case (defense in depth — the picker
    // enforces it at the Adults min 1). The
    // Continue button is disabled with the
    // "Choose enough rooms..." error.
    expect(bookingPageSrc).toMatch(/numAdults >= 1/);
  });

  it("the `cartFitsGroup` over-capacity check stays (the picker is no longer the enforcement layer)", () => {
    // The submit gate catches the over-capacity
    // case. The picker is no longer the
    // enforcement layer; the chip + submit
    // gate are.
    expect(bookingPageSrc).toMatch(/cartFitsGroup/);
    expect(bookingPageSrc).toMatch(
      /cartIsReady = cartHasAvailability && cartDistributionComplete && cartFitsGroup/
    );
  });

  it("the `HomePage` URL writing uses `?adults=N&children=N` (no `guests` param)", () => {
    // The HomePage widget's `searchAvailability`
    // function writes the new URL contract.
    // The `guests: String(total)` line is
    // gone (no total derivation needed).
    expect(homePageSrc).toMatch(
      /adults: String\(adults\)/
    );
    // The pre-CHD-11.5 `guests: String(total)`
    // is gone.
    expect(homePageSrc).not.toMatch(
      /guests: String\(total\)/
    );
  });
});
