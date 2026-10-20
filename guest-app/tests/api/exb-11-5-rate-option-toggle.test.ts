// MBUX-02 supersession of EXB-11.5 (2026-08-06, decision #198).
//
// WHAT CHANGED AND WHY
// --------------------
// EXB-11.5 built a per-type rate-option TOGGLE on the `/book` Step 1
// room-type card: click a rate option → add a room; click the same one
// again → remove every room of that type; click a different one → swap
// the rate in place. It was a three-branch `selectRoomType` handler plus
// instructional copy — "Click a rate to add a room. Click the same rate
// again to remove it." — and this file pinned all of it.
//
// That surface stopped being a decision as soon as BR-03 (2026-10-12,
// decision #232) deleted the "Room + Breakfast" rate option. With one
// option left, `Room Only` was no longer a CHOICE:
//
//   - the "untick" branch was reachable only by clicking the single
//     lone panel twice — a gesture with no meaning, because there was
//     nothing to toggle BETWEEN;
//   - the "switch rate in place" branch became unreachable entirely;
//   - the panel duplicated the "Rooms" quantity stepper that already sat
//     directly above it — two controls for one decision.
//
// MBUX-02 (2026-10-15, decision #255) makes the CARD the selection
// target and deletes the panel, the handler, and the copy. `Room Only`
// survives as the INTERNAL `rateChoice` value on the cart item — API
// shape, URL serialization, and server validation are all unchanged.
//
// WHY THIS FILE STILL EXISTS
// --------------------------
// Deleting it would drop coverage of the EXB-11.3 invariant that the
// EXB-11.5 suite also asserted: **no room may be pre-selected on page
// load.** That invariant is the reason this suite is rewritten rather
// than removed, and it is re-pinned below against the new surface — the
// `Select this room` button is the user-explicit add action, and no
// effect may auto-select on mount.
//
// WHAT MUST NOT COME BACK
// -----------------------
// A future refactor that reinstates a rate-option panel (or a
// "click-the-same-card-again-to-remove" gesture) has reintroduced the
// duplication MBUX-02 removed. The negative pins below are deliberate.
//
// Source-text guards per `plan/docs/CONTRIBUTING.md §Testing`:
// cheap, deterministic, <5s.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("MBUX-02 — the visible rate-option panel is gone from /book Step 1", () => {
  it("no `RateOption` component is rendered anywhere", () => {
    expect(bookingPageSrc).not.toMatch(/<RateOption/);
    expect(bookingPageSrc).not.toMatch(/function RateOption\(/);
    expect(bookingPageSrc).not.toMatch(/interface RateOptionProps/);
  });

  it("the dead `selectRoomType` handler is deleted", () => {
    // It had exactly one call site (the removed panel). With that
    // gone it was unreachable, and its "untick" branch duplicated the
    // quantity stepper's decrement.
    expect(bookingPageSrc).not.toMatch(/function selectRoomType\(/);
    expect(bookingPageSrc).not.toMatch(/onSelect=\{\(\) => selectRoomType\(/);
  });

  it("the EXB-11.5 instructional copy is gone (it taught a control that no longer exists)", () => {
    expect(bookingPageSrc).not.toMatch(/Click a rate to add a room\. Click the same rate again to remove it\./);
    expect(bookingPageSrc).not.toMatch(/Select Room Only or Room \+ Breakfast to lock the Step 1 summary\./);
  });

  it("no visible `Room Only` rate label is rendered on the card", () => {
    // The internal `rateChoice: "room-only"` VALUE is untouched; only
    // the guest-facing label is gone.
    expect(bookingPageSrc).not.toMatch(/label="Room Only"/);
  });
});

describe("MBUX-02 — the card is the selection target", () => {
  it("an unselected card offers one full-width `Select this room` action", () => {
    expect(bookingPageSrc).toMatch(/Select this room/);
    expect(bookingPageSrc).toMatch(
      /onClick=\{\(\) => updateRoomQuantity\(type\.value, 1, entry\.availableCount\)\}/
    );
  });

  it("a selected card shows the count, the per-type total, and the stepper", () => {
    expect(bookingPageSrc).toMatch(/\{typeQuantity\} selected/);
    expect(bookingPageSrc).toMatch(/data-testid=\{`room-type-selected-\$\{type\.value\}`\}/);
    expect(bookingPageSrc).toMatch(/data-testid=\{`room-type-quantity-\$\{type\.value\}`\}/);
  });

  it("`updateRoomQuantity` is the single mutation path for add AND remove", () => {
    // Add from the `Select this room` button, and both directions of
    // the stepper. No second code path may add a room.
    expect(bookingPageSrc).toMatch(/updateRoomQuantity\(type\.value, 1, entry\.availableCount\)/);
    expect(bookingPageSrc).toMatch(/updateRoomQuantity\(type\.value, typeQuantity \+ 1, entry\.availableCount\)/);
    expect(bookingPageSrc).toMatch(/updateRoomQuantity\(type\.value, typeQuantity - 1, entry\.availableCount\)/);
  });

  it("decrementing to zero restores the unselected state", () => {
    // `updateRoomQuantity` clamps to 0 and filters the type out of the
    // cart, so `isSelected` (derived from `cartQuantityByType`) flips
    // back to false on its own — no separate clear path.
    expect(bookingPageSrc).toMatch(
      /const isSelected = typeQuantity > 0/
    );
  });

  it("a selected card is visually marked on the card itself", () => {
    expect(bookingPageSrc).toMatch(/isSelected \? "ring-primary shadow-md" : "ring-gray-200"/);
    // Deliberately NOT `aria-current="step"` — the card is a selection,
    // not a navigation position.
    expect(bookingPageSrc).toMatch(/aria-current=\{isSelected \? "true" : undefined\}/);
  });

  it("the duplicate type pill is removed (it repeated the heading's label)", () => {
    const pill = /<span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">\s*\{type\.label\}/;
    expect(bookingPageSrc).not.toMatch(pill);
  });

  it("the inventory hint names the surviving control", () => {
    expect(bookingPageSrc).toMatch(/Choose a room to add it to your stay\./);
  });
});

describe("EXB-11.3 invariant (re-pinned against the MBUX-02 surface)", () => {
  it("no room is pre-selected on page load — the add is user-explicit", () => {
    // The invariant EXB-11.3 (decision #197) established and
    // EXB-11.5 refined. MBUX-02 changes WHICH control performs the
    // add; it must not change THAT the add requires a click.
    expect(bookingPageSrc).toMatch(/const \[roomCart, setRoomCart\] = useState<BookingRoomCartItem\[\]>\(\(\) => \{/);
    // The cart's lazy initialiser must not seed a room type.
    const init = bookingPageSrc.slice(
      bookingPageSrc.indexOf("const [roomCart, setRoomCart]"),
      bookingPageSrc.indexOf("const [roomCart, setRoomCart]") + 900
    );
    expect(init).not.toMatch(/roomType: "/);
  });

  it("the selection-sync effect still clears `selectedRoomType` when the type leaves the cart", () => {
    // MBUX-02 removed the untick branch that explicitly skipped this
    // sync, so the effect is now the ONLY thing keeping the selection
    // coherent after a decrement-to-zero.
    expect(bookingPageSrc).toMatch(/setSelectedRoomType\(/);
    expect(bookingPageSrc).toMatch(/setRateChoice\(roomCart\[0\]\.rateChoice\)/);
  });

  it("the internal `rateChoice` value is still carried on every cart item", () => {
    // API + URL-serialization compatibility: "room-only" is the value
    // the server sees, independent of the removed panel.
    expect(bookingPageSrc).toMatch(/rateChoice: templateChoice/);
    expect(bookingPageSrc).toMatch(/serializeBookingRoomCart\(next\)/);
  });
});