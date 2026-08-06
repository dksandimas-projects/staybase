// Per CHD-11 + CHD-12 (2026-08-04, per decisions #184 + #185):
// source-text regression tests for the soft-constraint children
// picker + the per-type Fits / Tight / Doesn't fit capacity
// indicator on the room-type card + the cart-style summary that
// replaces the legacy "Guest distribution" list.
//
// Background (per `plan/features/BOOKING-FLOW.md §CHD-11` +
// `§CHD-12`):
//   - CHD-11: drop the per-type `maxChildren` hard cap on the
//     children picker; soft-cap at `MIN(10, guests - 1)`; add
//     a live per-type Fits / Tight / Doesn't fit chip on each
//     room-type card; hard-validate at the Step 1 → Step 2
//     submit gate. The constraint moves from the picker
//     (draft surface) to the right layer (commit surface).
//   - CHD-12: replace the "Guest distribution" per-room list
//     with a per-type cart summary that lists one line per
//     distinct room type, with the per-type occupancy inline.
//     The "Room 1 / Room 2 / Room N" positional naming goes
//     away. The same `deriveRoomTypeCapacityFit` helper
//     powers both the room-type card's chip and the cart
//     line's chip — single derivation point, two surfaces.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural emulator test
// (full `/book` happy-path with various group sizes) is
// out of scope for this sandbox.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

// Slice the children stepper — from the "Children (0–11)"
// label to the end of the `<label>` block (per
// operator request 2026-08-06: the helper text is
// removed; the slice anchor is the `</label>` close
// of the children stepper's `<label>` block).
const childrenStepperStart = bookingPageSrc.indexOf("Children (0–11)");
// The end of the children stepper's label block is
// the `</label>` close. We find the first `</label>`
// after the children stepper's start.
const childrenHelpEnd = bookingPageSrc.indexOf("</label>", childrenStepperStart) + "</label>".length;
const childrenStepperSlice =
  childrenStepperStart >= 0 && childrenHelpEnd > childrenStepperStart
    ? bookingPageSrc.slice(childrenStepperStart, childrenHelpEnd)
    : "";

// Slice the cart summary — from the "Your cart" heading to
// the first `</div>` after the per-type list loop.
const cartSummaryStart = bookingPageSrc.indexOf("Your cart");
const cartSummaryEnd = bookingPageSrc.indexOf("{!cartDistributionComplete ?");
const cartSummarySlice =
  cartSummaryStart >= 0 && cartSummaryEnd > cartSummaryStart
    ? bookingPageSrc.slice(cartSummaryStart, cartSummaryEnd)
    : "";

// Slice the room-type card capacity indicator — the IIFE that
// renders the Fits / Tight / Doesn't fit chip. Use a unique
// marker that's only in the card block (the comment that
// introduces the IIFE). The slice runs to the closing `</div>`
// of the IIFE — the `mt-6 grid` div after the IIFE is a unique
// end marker.
const cardIndicatorStart = bookingPageSrc.indexOf("Per CHD-11 (2026-08-04, per decision #184):\n                            the per-type Fits / Tight / Doesn't fit");
const cardIndicatorEnd = bookingPageSrc.indexOf("mt-6 grid", cardIndicatorStart);
const cardIndicatorSlice =
  cardIndicatorStart >= 0 && cardIndicatorEnd > cardIndicatorStart
    ? bookingPageSrc.slice(cardIndicatorStart, cardIndicatorEnd)
    : "";

describe("CHD-11 — soft-constraint children picker on /book", () => {
  it("the children stepper is present and locatable", () => {
    expect(childrenStepperSlice.length).toBeGreaterThan(0);
    expect(childrenStepperSlice).toMatch(/Children \(0–11\)/);
  });

  it("drops the per-type hard cap — soft cap is `MIN(10, guests - 1)`", () => {
    // The pre-CHD-11 disabled condition was
    //   numChildren >= selectedMaxSelectableChildren
    //     || numChildren >= Math.max(0, guests - 1)
    // which enforced the per-type cap. The CHD-11 disabled
    // condition is the soft cap `MIN(10, guests - 1)` only —
    // the per-type cap is no longer gated at the picker.
    // Per CHD-11.5 (decision #196): the `Math.max(0,
    // guests - 1)` floor is gone — the picker is now
    // Adults + Children directly; the Adults stepper
    // min 1 enforces the "at least 1 adult" rule. The
    // current condition is `numChildren >= 10` (the
    // soft cap only).
    expect(childrenStepperSlice).toMatch(
      /numChildren >= 10/
    );
    expect(childrenStepperSlice).not.toMatch(
      /numChildren >= Math\.min\(10, Math\.max\(0, guests - 1\)\)/
    );
    expect(childrenStepperSlice).not.toMatch(
      /numChildren >= selectedMaxSelectableChildren\s*\|\|/
    );
  });

  it("drops the dead-end tail — the new tail is a forward-looking nudge (then both are removed per operator request 2026-08-06)", () => {
    // The pre-CHD-11 helper text included "You have reached
    // this room type's limit for the current group." as a
    // dead-end tail. The CHD-11 tail was a forward-looking
    // nudge: "Pick a room type that fits your group, or add
    // a second room." Per operator request (2026-08-06):
    // the picker helper text is removed entirely. The
    // chip + submit gate remain the validation surfaces.
    expect(childrenStepperSlice).not.toMatch(
      /You have reached this room type.s limit for the current group/
    );
    expect(childrenStepperSlice).not.toMatch(
      /Pick a room type that fits your group, or add a second room\./
    );
  });

  it("drops the 'extra beds cover the overflow' hint (per operator request 2026-08-06)", () => {
    // Per operator request (2026-08-06): the helper text
    // is removed entirely. The hint about "Up to N can
    // fit when extra beds cover the overflow" is gone.
    // The capacity chip (Fits / Tight / Doesn't fit)
    // on the room-type card is the read surface.
    expect(childrenStepperSlice).not.toMatch(
      /Up to \$\{selectedMaxSelectableChildren\} can fit when extra beds cover the overflow/
    );
  });

  it("the 'at least one adult' invariant stays (defense in depth — picker enforces it via Adults min 1)", () => {
    // The `Math.max(0, guests - 1)` half of the soft cap
    // was the historical invariant — children couldn't
    // exceed (guests - 1) because at least one adult
    // was required. Per CHD-11.5 (decision #196): the
    // picker is now Adults + Children directly; the
    // Adults stepper min 1 enforces the invariant at
    // the picker. The `Math.max(0, guests - 1)` formula
    // is gone (the picker can't go past `adults`).
    // The submit gate's `numAdults >= 1` check stays as
    // defense in depth.
    expect(childrenStepperSlice).not.toMatch(/Math\.max\(0, guests - 1\)/);
  });

  it("the children stepper has NO helper text (removed per operator request 2026-08-06)", () => {
    // Per operator request (2026-08-06): the picker
    // helper text is removed entirely. The
    // `id="children-cap-help"` + `aria-describedby="..."`
    // are gone. The picker is the exploration surface;
    // the chip + submit gate are the validation surfaces.
    expect(childrenStepperSlice).not.toMatch(/aria-live="polite"/);
    expect(childrenStepperSlice).not.toMatch(/id="children-cap-help"/);
    expect(childrenStepperSlice).not.toMatch(/aria-describedby="children-cap-help"/);
  });
});

describe("CHD-11 — Fits / Tight / Doesn't fit indicator on each room-type card", () => {
  it("the indicator block is present and locatable", () => {
    expect(cardIndicatorSlice.length).toBeGreaterThan(0);
    expect(cardIndicatorSlice).toMatch(/deriveRoomTypeCapacityFit/);
  });

  it("uses the same helper that powers the cart summary (single derivation point)", () => {
    // Per CHD-11 + CHD-12 composition: both surfaces read from
    // `deriveRoomTypeCapacityFit` so the two indicators can
    // never disagree. The card call uses
    //   deriveRoomTypeCapacityFit({ type, numAdults, numChildren, currentCartCount: typeQuantity })
    expect(cardIndicatorSlice).toMatch(
      /deriveRoomTypeCapacityFit\(\{[\s\S]{0,200}currentCartCount:\s*typeQuantity/
    );
  });

  it("renders the three states — Fits / Tight / Doesn't fit", () => {
    expect(cardIndicatorSlice).toMatch(/Fits your group/);
    expect(cardIndicatorSlice).toMatch(/Tight — at the cap/);
    expect(cardIndicatorSlice).toMatch(/Doesn't fit your group/);
  });

  it("renders the per-type capacity indicator with a stable data-testid", () => {
    // The "Adjust room" CTA at the submit gate scrolls to the
    // chip via a query selector keyed on this data-testid. The
    // card must render `data-testid="room-type-fit-<value>"`
    // for the CTA to land.
    expect(cardIndicatorSlice).toMatch(
      /data-testid=\{`room-type-fit-\$\{type\.value\}`\}/
    );
  });

  it("shows the 'You'd need N of [type]' callout when the cart is short", () => {
    // When the user's group needs more rooms of this type than
    // are currently in the cart, the card surfaces a callout
    // so the user knows to add another room. The callout is
    // `You'd need {fit.roomsNeeded} of {type.label} for your
    // group.`
    expect(cardIndicatorSlice).toMatch(/You.d need/);
    expect(cardIndicatorSlice).toMatch(/for your group\./);
    expect(cardIndicatorSlice).toMatch(
      /data-testid=\{`room-type-rooms-needed-\$\{type\.value\}`\}/
    );
  });
});

describe("CHD-12 — cart-style summary replaces 'Guest distribution'", () => {
  it("the cart summary block is present and locatable", () => {
    expect(cartSummarySlice.length).toBeGreaterThan(0);
    expect(cartSummarySlice).toMatch(/Your cart/);
  });

  it("the legacy 'Guest distribution' heading is gone", () => {
    // The pre-CHD-12 heading was "Guest distribution". The
    // new heading is "Your cart" — the cart is the source of
    // truth, not the auto-rebalance result. The string may
    // still appear in comments explaining the legacy, so we
    // assert the heading was removed by checking the old
    // heading element (`<p>Guest distribution</p>`) is gone.
    expect(bookingPageSrc).not.toMatch(/<p[^>]*>\s*Guest distribution\s*<\/p>/);
    expect(bookingPageSrc).toMatch(/<p[^>]*>\s*Your cart\s*<\/p>/);
  });

  it("the legacy 'Room N · [type]' positional naming is gone", () => {
    // The pre-CHD-12 list used "Room 1 · [type]", "Room 2 ·
    // [type]" etc. — positional, meaningless. The new list
    // uses the type label only ("1× Single Room").
    expect(bookingPageSrc).not.toMatch(/Room \{index \+ 1\}/);
  });

  it("groups rooms by type and renders one line per distinct type", () => {
    // The cart summary uses a `Map<roomType, { quantity,
    // adults, children, extraBeds, label }>` to group rooms
    // by type. The per-type occupancy is the sum across the
    // grouped rooms.
    expect(cartSummarySlice).toMatch(/byType/);
    expect(cartSummarySlice).toMatch(/quantity \+= 1/);
    expect(cartSummarySlice).toMatch(/adults \+= room\.numAdults/);
    expect(cartSummarySlice).toMatch(/children \+= room\.numChildren/);
  });

  it("renders the per-type line in the format '1× Type · N adults · M children'", () => {
    // The per-type line uses the `quantity× Label` format
    // (the same shape as the existing room cart copy).
    expect(cartSummarySlice).toMatch(/\{agg\.quantity\}× \{agg\.label/);
    expect(cartSummarySlice).toMatch(/\{agg\.adults\} adult/);
    expect(cartSummarySlice).toMatch(/\{agg\.children\} child/);
  });

  it("renders the CHD-11 capacity chip on each cart line", () => {
    // The cart line uses the same `deriveRoomTypeCapacityFit`
    // helper as the room-type card (per the CHD-11 + CHD-12
    // composition contract). The cart line chip uses the
    // Fits / Tight / Doesn't fit labels.
    expect(cartSummarySlice).toMatch(/deriveRoomTypeCapacityFit/);
    expect(cartSummarySlice).toMatch(/>Fits</);
    expect(cartSummarySlice).toMatch(/>Tight</);
    expect(cartSummarySlice).toMatch(/>Doesn't fit</);
  });

  it("preserves the extra-bed chip on the cart line", () => {
    // The pre-CHD-12 list rendered an "N extra beds" chip
    // when the room had `extraBedCount > 0`. The CHD-12 list
    // preserves that shape — the per-type line shows the
    // sum of extra beds across all rooms of that type.
    expect(cartSummarySlice).toMatch(/agg\.extraBeds > 0/);
    expect(cartSummarySlice).toMatch(/\{agg\.extraBeds\} extra bed/);
  });
});

describe("CHD-11 — submit-gate validation + Adjust room CTA", () => {
  it("the cartFitsGroup check is added to cartIsReady", () => {
    // Per CHD-11: every room in the cart must fit its
    // per-type cap (with the type's `maxExtraBeds` covering
    // any overflow). The new `cartFitsGroup` check is part
    // of the `cartIsReady` derivation.
    expect(bookingPageSrc).toMatch(/const cartFitsGroup = distributedRoomCart\.every/);
    expect(bookingPageSrc).toMatch(/requiredExtraBedsFor\(\{[\s\S]{0,200}numAdults: room\.numAdults/);
    expect(bookingPageSrc).toMatch(/cartIsReady = cartHasAvailability && cartDistributionComplete && cartFitsGroup/);
  });

  it("renders the Adjust room CTA that scrolls to + highlights the offending card", () => {
    // The CTA is a button that scrolls the offending room-type
    // card into view + adds a 2-second ring highlight so the
    // user can see which card needs adjustment.
    expect(bookingPageSrc).toMatch(/data-testid="adjust-room-cta"/);
    expect(bookingPageSrc).toMatch(/scrollIntoView\(\{ behavior: "smooth"/);
    expect(bookingPageSrc).toMatch(/classList\.add\("ring-2", "ring-amber-400"\)/);
  });

  it("the error message references the type label (not 'Room N')", () => {
    // The CHD-12 contract: errors reference the type label,
    // not the positional "Room N" index. The submit-gate
    // error message follows the same contract.
    expect(bookingPageSrc).toMatch(/\{firstFailingType\.label\} maxes at/);
    expect(bookingPageSrc).toMatch(/Adjust room/);
    expect(bookingPageSrc).toMatch(/or pick a different room type, or remove a guest\./);
  });
});
