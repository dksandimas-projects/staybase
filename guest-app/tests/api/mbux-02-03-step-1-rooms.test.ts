// MBUX-02 + MBUX-03 — Step 1 room discovery and the mobile
// multi-room cart tray.
//
// Phase 15 / decision #255. Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Step 1 — Select Rooms`.
//
// MBUX-02's own selection-surface pins live in
// `exb-11-5-rate-option-toggle.test.ts`, which was rewritten to record
// the supersession of the rate-option toggle. This file covers MBUX-03
// (the tray) and the cross-cutting invariants that the Step 1 rewrite
// had to preserve: the CHD-11 capacity chip, the CHD-12 grouped cart,
// the CHD-11 occupancy gate, and the EXB-11.4 extra-bed stepper.
//
// The visual matrix (320/375/390/430px) is MBUX-10's manual pass; these
// guards pin the STRUCTURE that matrix depends on.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const cartLinesSrc = read("guest-app/src/components/RoomCartLines.tsx");
const cartTraySrc = read("guest-app/src/components/RoomCartTray.tsx");
const stickyFooterSrc = read("guest-app/src/components/BookingStickyFooter.tsx");

/**
 * Strip JS comments so an assertion about CODE cannot be tripped by prose
 * in a doc comment. Several of these components carry long rationale
 * blocks that quote the very strings they removed ("Room 1 / Room 2",
 * "Click a rate to add a room"), and a naive negative regex would match
 * the quotation and report a false failure.
 */
function stripComments(source: string): string {
  // LINE comments first, THEN block comments. The order matters.
  //
  // A `//` comment may contain `/*` — the booking page literally has
  // one ("Guest clients cannot read `bookings/*` directly"). Stripping
  // blocks FIRST treated that as a block opener and swallowed the next
  // ~170 lines of REAL code, which made every source-text pin inside
  // that window silently vacuous — and made a new pin fail for no
  // visible reason.
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

const cartLinesCode = stripComments(cartLinesSrc);
const cartTrayCode = stripComments(cartTraySrc);
const bookingPageCode = stripComments(bookingPageSrc);
const stickyFooterCode = stripComments(stickyFooterSrc);

describe("MBUX-03 — RoomCartLines is the single grouped-cart read surface", () => {
  it("groups by room TYPE, never by positional room name (CHD-12)", () => {
    expect(cartLinesSrc).toMatch(/export function groupCartByType\(/);
    expect(cartLinesSrc).toMatch(/export function RoomCartLines\(/);
    // CHD-12 rejected "Room 1 / Room 2 / Room N" because positional
    // names are meaningless to a guest who picked three of the same
    // type. The grouped line renders `N× <type label>` instead.
    expect(cartLinesSrc).toMatch(/\{agg\.quantity\}× \{agg\.label\}/);
    expect(cartLinesCode).not.toMatch(/Room \{|Room \d/);
  });

  it("derives capacity state through the one shared helper, not a second derivation", () => {
    expect(cartLinesSrc).toMatch(/import \{ deriveRoomTypeCapacityFit \} from "@shared\/utils\/roomTypes"/);
    expect(cartLinesSrc).toMatch(/const fit = deriveRoomTypeCapacityFit\(\{/);
  });

  it("the desktop sidebar consumes the shared component instead of an inline IIFE", () => {
    expect(bookingPageCode).toMatch(/<RoomCartLines\s+rooms=\{distributedRoomCart\}\s+roomTypes=\{roomTypes\}\s+idPrefix="cart-line"/);
    // The per-type grouping IIFE must not survive in BookingPage.
    expect(bookingPageCode).not.toMatch(/const byType = new Map<string, \{ quantity: number/);
  });

  it("both surfaces render the same component — the two cannot drift", () => {
    expect(cartTrayCode).toMatch(/import \{ RoomCartLines, groupCartByType \} from "\.\/RoomCartLines"/);
    expect(cartTrayCode).toMatch(/<RoomCartLines rooms=\{rooms\} roomTypes=\{roomTypes\} idPrefix="cart-tray-line"/);
  });

  it("takes the idPrefix so two instances can coexist on one page", () => {
    expect(cartLinesSrc).toMatch(/idPrefix = "cart-line"/);
    expect(cartLinesSrc).toMatch(/data-testid=\{`\$\{idPrefix\}-\$\{agg\.roomType\}`\}/);
  });
});

describe("MBUX-03 — the mobile cart tray", () => {
  it("mounts INSIDE the sticky footer's action area, gated to below `lg:`", () => {
    // From `lg:` up the sticky sidebar already shows the full cart;
    // rendering both would duplicate every line on screen.
    //
    // Per OCT-L1 (2026-10-20, decision #299): the tray used to be the
    // LAST element of the Step 1 page body. The footer is `fixed`, so
    // the tray scrolled away while the footer stayed pinned — on a
    // phone with 4+ room types the guest tapped "+" and got no
    // aggregate feedback near the thumb. MBUX-03 allows "above the
    // footer **or as part of the action area**"; the tray now renders
    // in the footer's `aboveAction` slot, so it is ALWAYS reachable.
    expect(bookingPageCode).toMatch(
      /aboveAction=\{\s*<div className="lg:hidden">\s*<RoomCartTray/
    );
    expect(bookingPageCode).toMatch(/aggregateTotal=\{displayTotal\}/);
    expect(bookingPageCode).toMatch(/fitComplete=\{cartDistributionComplete\}/);

    // The tray must NOT be back in the page body. This is the
    // negative half of the OCT-L1 contract and the reason the test
    // name says "INSIDE the sticky footer's action area" rather than
    // "above the sticky footer" (the old name described a placement
    // the code never had).
    const trayMounts = bookingPageCode.match(/<RoomCartTray/g) || [];
    expect(trayMounts.length).toBe(1);
    expect(bookingPageCode).not.toMatch(/pb-4 lg:hidden">\s*<RoomCartTray/);
  });

  it("the footer renders `aboveAction` inside the fixed bar", () => {
    // The slot is only useful if it is inside the `fixed` container —
    // a slot rendered outside it would put the tray back in the flow.
    expect(stickyFooterCode).toMatch(/fixed bottom-0 left-0 z-40/);
    expect(stickyFooterCode).toMatch(/aboveAction \? \(/);
    expect(stickyFooterCode).toMatch(/\{aboveAction\}/);
  });

  it("Step 1's bottom reserve grows to cover the taller footer", () => {
    // The fixed bar hides whatever sits under it. Step 1's footer now
    // carries the tray, so the reserve on `<main>` has to grow with it
    // or the last room card hides behind the bar on a phone.
    expect(bookingPageCode).toMatch(/isSelectRoomStep/);
    expect(bookingPageCode).toMatch(/pb-\[calc\(13rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it("carries the aggregate total from the same `displayTotal` the footer uses", () => {
    // One price source. A second total derivation on the tray would be
    // free to disagree with the sticky footer's figure.
    expect(bookingPageCode).toMatch(/const displayTotal = distributedRoomCart\.length > 0/);
    expect(bookingPageSrc).toMatch(/aggregateTotal=\{displayTotal\}/);
  });

  it("renders nothing when no room is selected", () => {
    expect(cartTrayCode).toMatch(/if \(rooms\.length === 0\) return null;/);
  });

  it("is collapsed by default and expands via a labelled control", () => {
    expect(cartTrayCode).toMatch(/const \[isExpanded, setIsExpanded\] = useState\(false\)/);
    expect(cartTrayCode).toMatch(/aria-expanded=\{isExpanded\}/);
    expect(cartTrayCode).toMatch(/aria-controls="room-cart-tray-lines"/);
    expect(cartTrayCode).toMatch(/id="room-cart-tray-lines"/);
  });

  it("the expanded region is genuinely hidden when collapsed", () => {
    // `hidden` (not just visually clipped) keeps the grouped lines out
    // of the accessibility tree, so a screen reader is not read the
    // same cart twice per change.
    //
    // Per OCT-L1: the region also carries a `max-h-[40vh]` cap +
    // internal scroll. Inside a FIXED bar an uncapped list grows the
    // footer until it swallows the screen.
    expect(cartTrayCode).toMatch(/id="room-cart-tray-lines"[\s\S]{0,120}hidden=\{!isExpanded\}/);
    expect(cartTrayCode).toMatch(/max-h-\[40vh\] overflow-y-auto/);
  });

  it("the collapsed row names the fit state when the group is short", () => {
    expect(cartTrayCode).toMatch(/\{!fitComplete \? " · still need a room" : ""\}/);
  });

  it("gives the expand control a 44px touch target", () => {
    expect(cartTrayCode).toMatch(/className="flex min-h-11 w-full items-center gap-3 text-left"/);
  });
});

describe("Step 1 invariants preserved across the MBUX-02/03 rewrite", () => {
  it("CHD-11 — the per-type Fits / Tight / Doesn't fit chip stays on the card", () => {
    expect(bookingPageSrc).toMatch(/data-testid=\{`room-type-fit-\$\{type\.value\}`\}/);
    expect(bookingPageSrc).toMatch(/deriveRoomTypeCapacityFit\(\{/);
    expect(bookingPageSrc).toMatch(/const fit = deriveRoomTypeCapacityFit\(\{/);
  });

  it("CHD-11 — the rooms-needed nudge survives", () => {
    expect(bookingPageSrc).toMatch(/data-testid=\{`room-type-rooms-needed-\$\{type\.value\}`\}/);
    expect(bookingPageSrc).toMatch(/You&apos;d need \{fit\.roomsNeeded\} of/);
  });

  it("CHD-11 — the occupancy gate still gates Submit, not the card", () => {
    expect(bookingPageSrc).toMatch(/id="step-one-occupancy-error"/);
    expect(bookingPageSrc).toMatch(/data-testid="adjust-room-cta"/);
    expect(bookingPageSrc).toMatch(/aria-describedby="step-one-occupancy-error"/);
  });

  it("availability still bounds the increment (the cap is not the fit state)", () => {
    expect(bookingPageSrc).toMatch(/disabled=\{typeQuantity >= entry\.availableCount\}/);
  });

  it("EXB-11.4 — the extra-bed stepper and its soft floor are untouched", () => {
    expect(bookingPageSrc).toMatch(/data-testid=\{`extras-stepper-\$\{type\.value\}`\}/);
    expect(bookingPageSrc).toMatch(/data-testid=\{`extras-soft-floor-warning-\$\{type\.value\}`\}/);
  });

  it("BR-03 — the room-card breakfast preview still shows the room rate only", () => {
    // The removed rate panel used to carry the breakfast preview
    // figures; the card keeps showing the room rate alone.
    expect(bookingPageSrc).toMatch(/const breakfastOptionTotal = roomOnlyTotal;/);
  });

  it("WRV-01 — the mixed-rate breakdown panel still renders when rates are non-regular", () => {
    expect(bookingPageSrc).toMatch(/\{hasNonRegularRate \? \(/);
  });
});