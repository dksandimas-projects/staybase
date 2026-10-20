import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  copyBreakfastDateToRemaining,
  breakfastSlotKey,
  type BreakfastSelections
} from "../../src/utils/breakfastCopy";

// MBUX-05 — Step 2 add-ons for phones.
//
// Phase 15 / decision #257. Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Step 2 — Add-ons`.
//
// TWO KINDS OF TEST IN ONE FILE, deliberately:
//
//   - The copy-to-remaining-days logic is asserted BEHAVIOURALLY.
//     It is a pure function and the four rules that matter (empty
//     slots copy as empty, locked dates are never touched, the
//     snapshot is re-stamped not shared, the count reflects real
//     changes) are invisible in a regex. A source-text pin would
//     pass happily while the helper quietly kept a stale target
//     value — exactly the bug this feature exists to remove.
//   - The UI surfaces are pinned source-text, per
//     `plan/docs/CONTRIBUTING.md §Testing`.
//
// The visual matrix (320/375/390/430px) is MBUX-10's manual pass.

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const menuStripSrc = read("guest-app/src/components/BreakfastMenuStrip.tsx");
const breakfastCopySrc = read("guest-app/src/utils/breakfastCopy.ts");

const NOW = "2026-10-20T09:00:00.000Z";

function entry(mealId: string, mealName: string, price: number) {
  return {
    mealId,
    mealName,
    price,
    addedBy: "guest",
    addedAt: "2026-10-19T09:00:00.000Z",
    lastModifiedAt: "2026-10-19T09:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: null,
    removedBy: null,
    overrideCutoff: false,
    overrideReason: null
  };
}

describe("MBUX-05 — breakfastSlotKey", () => {
  it("matches the composite key the selectors already write", () => {
    // The key format predates MBUX-05; the helper must not invent a
    // second one, or every copied selection would be orphaned.
    expect(breakfastSlotKey("2026-10-20", "slot-1")).toBe("2026-10-20-slot-1");
  });
});

describe("MBUX-05 — copy to remaining days: the happy path", () => {
  it("copies a filled slot onto every editable target date", () => {
    const selections: BreakfastSelections = {
      [breakfastSlotKey("2026-10-20", "s1")]: entry("tapsilog", "Tapsilog", 350)
    };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "2026-10-20",
      targetDates: ["2026-10-21", "2026-10-22"],
      slotIds: ["s1", "s2"],
      now: NOW
    });
    expect(result.selections[breakfastSlotKey("2026-10-21", "s1")]).toMatchObject({
      mealId: "tapsilog",
      mealName: "Tapsilog",
      price: 350
    });
    expect(result.selections[breakfastSlotKey("2026-10-22", "s1")]).toBeDefined();
    expect(result.updatedDates).toBe(2);
  });

  it("copies the snapshot triple verbatim", () => {
    const selections: BreakfastSelections = {
      [breakfastSlotKey("d1", "s1")]: entry("m1", "Old name", 300)
    };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2"],
      slotIds: ["s1"],
      now: NOW
    });
    expect(result.selections["d2-s1"]).toMatchObject({
      mealId: "m1",
      mealName: "Old name",
      price: 300
    });
  });

  it("re-stamps the audit fields instead of sharing the source entry", () => {
    // Copying by reference would let a later mutation of one date's
    // entry silently rewrite another's.
    const source = entry("m1", "Tapsilog", 350);
    const selections: BreakfastSelections = { "d1-s1": source };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2"],
      slotIds: ["s1"],
      now: NOW
    });
    const copied = result.selections["d2-s1"];
    expect(copied).not.toBe(source);
    expect(copied!.lastModifiedAt).toBe(NOW);
    expect(copied!.addedAt).toBe(NOW);
    expect(copied!.lastModifiedBy).toBe("guest");
    // The source entry is untouched.
    expect(source.lastModifiedAt).toBe("2026-10-19T09:00:00.000Z");
  });

  it("never mutates the caller's selections map", () => {
    const selections: BreakfastSelections = {
      "d1-s1": entry("m1", "Tapsilog", 350)
    };
    const snapshot = JSON.parse(JSON.stringify(selections));
    copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2"],
      slotIds: ["s1"],
      now: NOW
    });
    expect(selections).toEqual(snapshot);
  });
});

describe("MBUX-05 — copy to remaining days: `No breakfast` is a real choice", () => {
  it("an empty source slot CLEARS the target rather than leaving a stale meal", () => {
    const selections: BreakfastSelections = {
      "d1-s1": entry("m1", "Tapsilog", 350)
      // s2 deliberately empty — the guest chose "No breakfast"
      ,
      "d2-s1": entry("m1", "Tapsilog", 350),
      "d2-s2": entry("m2", "Longsilog", 380)
    };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2"],
      slotIds: ["s1", "s2"],
      now: NOW
    });
    expect(result.selections["d2-s1"]).toBeDefined();
    expect("d2-s2" in result.selections).toBe(false);
  });

  it("does not invent a selection for a slot that never had one", () => {
    const selections: BreakfastSelections = { "d1-s1": entry("m1", "Tapsilog", 350) };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2"],
      slotIds: ["s1", "s2"],
      now: NOW
    });
    expect("d2-s2" in result.selections).toBe(false);
  });
});

describe("MBUX-05 — copy to remaining days: guards", () => {
  it("no-ops when the source date has no explicit selection", () => {
    const selections: BreakfastSelections = { "d1-other": entry("m1", "X", 1) };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2"],
      slotIds: ["s1"],
      now: NOW
    });
    expect(result.selections).toBe(selections);
    expect(result.updatedDates).toBe(0);
  });

  it("no-ops when there are no editable targets (a single-night stay)", () => {
    const selections: BreakfastSelections = { "d1-s1": entry("m1", "X", 1) };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: [],
      slotIds: ["s1"],
      now: NOW
    });
    expect(result.updatedDates).toBe(0);
    expect(result.selections).toBe(selections);
  });

  it("only touches the dates it was given — the caller owns the lock filter", () => {
    const selections: BreakfastSelections = {
      "d1-s1": entry("m1", "Tapsilog", 350),
      "d3-s1": entry("locked-meal", "Locked", 500)
    };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      // d3 is LOCKED, so the caller must not pass it. Assert the
      // helper honours that contract rather than re-deriving locks.
      targetDates: ["d2"],
      slotIds: ["s1"],
      now: NOW
    });
    expect(result.selections["d3-s1"]).toMatchObject({ mealId: "locked-meal" });
  });

  it("counts only dates that ACTUALLY changed, so the confirmation cannot overstate", () => {
    const selections: BreakfastSelections = {
      "d1-s1": entry("m1", "Tapsilog", 350),
      "d2-s1": entry("m1", "Tapsilog", 350), // already identical
      "d3-s1": entry("m2", "Longsilog", 380) // different
    };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2", "d3"],
      slotIds: ["s1"],
      now: NOW
    });
    expect(result.updatedDates).toBe(1);
    expect(result.selections["d2-s1"]).toMatchObject({ mealId: "m1" });
    expect(result.selections["d3-s1"]).toMatchObject({ mealId: "m1" });
  });

  it("reports zero when every target already matches", () => {
    const selections: BreakfastSelections = {
      "d1-s1": entry("m1", "Tapsilog", 350),
      "d2-s1": entry("m1", "Tapsilog", 350)
    };
    const result = copyBreakfastDateToRemaining({
      selections,
      sourceDate: "d1",
      targetDates: ["d2"],
      slotIds: ["s1"],
      now: NOW
    });
    expect(result.updatedDates).toBe(0);
  });
});

describe("MBUX-05 — the Breakfast menu strip", () => {
  it("renders above the selectors, never inside a native option", () => {
    expect(bookingPageSrc).toMatch(/<BreakfastMenuStrip\s+meals=\{activeBreakfastMeals\}/);
    // The spec explicitly rejected photos inside <option>.
    expect(bookingPageSrc).not.toMatch(/<option[^>]*>\s*<img/);
  });

  it("renders the SAME active, display-ordered catalogue the selectors read", () => {
    // A photo for a meal that cannot be chosen would be a lie.
    expect(bookingPageSrc).toMatch(
      /const activeBreakfastMeals = \[\.\.\.\(breakfastConfig\.meals \|\| \[\]\)\]\s*\.filter\(\(meal\) => meal\.isActive !== false\)/
    );
  });

  it("uses a responsive grid (2 cols mobile / 3 sm: / 4 lg:) per MBUX-12", () => {
    // Per MBUX-12 (decision #265, 2026-10-16): the pre-MBUX-12
    // horizontal-scroll carousel was replaced with a responsive
    // grid because on a 375px phone the 128px cards cut the
    // third meal in half. The strip no longer carries
    // `overflow-x-auto` / `snap-x` / `overscroll-x-contain` —
    // see `tests/api/mbux-12-breakfast-menu-grid.test.ts` for
    // the negative pins. Here we pin the positive grid shape.
    expect(menuStripSrc).toMatch(/grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4/);
  });

  it("lazy-loads thumbnails", () => {
    expect(menuStripSrc).toMatch(/loading="lazy"/);
  });

  it("uses a consistent 4:3 crop", () => {
    expect(menuStripSrc).toMatch(/aspectRatio: "4 \/ 3"/);
  });

  it("falls back to a branded-neutral tile on missing or failed images", () => {
    expect(menuStripSrc).toMatch(/const showFallback = !meal\.imageUrl \|\| failedIds\[meal\.id\]/);
    expect(menuStripSrc).toMatch(/onError=/);
    expect(menuStripSrc).toMatch(/UtensilsCrossed/);
  });

  it("always renders the meal NAME as text, so a missing photo never removes information", () => {
    expect(menuStripSrc).toMatch(/\{meal\.name\}/);
  });

  it("cards are non-interactive — a thumbnail must never fill a slot", () => {
    expect(menuStripSrc).not.toMatch(/<button/);
    expect(menuStripSrc).not.toMatch(/onClick/);
  });
});

describe("MBUX-05 — responsive per-guest selectors", () => {
  it("stacks the label above a full-width select on mobile", () => {
    expect(bookingPageSrc).toMatch(
      /className="flex flex-col gap-1\.5 sm:flex-row sm:items-center sm:gap-3"/
    );
    expect(bookingPageSrc).toMatch(
      /className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1"/
    );
  });

  it("drops the fixed 160px label floor that squeezed the select on phones", () => {
    expect(bookingPageSrc).not.toMatch(/className="min-w-\[160px\] text-sm text-gray-700"/);
  });

  it("the empty option is short and self-explanatory (no extra reassurance paragraph needed above the grid)", () => {
    expect(bookingPageSrc).toMatch(/<option value="">No breakfast<\/option>/);
    expect(bookingPageSrc).not.toMatch(
      /<option value="">No meal — skip breakfast for this guest on this day<\/option>/
    );
  });

  it("the pre-MBUX-17 `Skipping a day is fine` reassurance line is REMOVED — MBUX-17 (decision #272) drops it because the default `No breakfast` option already implies it", () => {
    // The default `<option value="">No breakfast</option>` on every
    // guest slot makes the pre-MBUX-17 reassurance paragraph
    // redundant. MBUX-17 removes the line entirely so mobile gets
    // back the ~40px of vertical real estate it took above the
    // per-date grid.
    expect(bookingPageSrc).not.toMatch(/Skipping a day is fine/);
  });
});

describe("MBUX-05 — the copy action's placement rules", () => {
  it("appears only on a date with at least one explicit selection", () => {
    expect(bookingPageSrc).toMatch(
      /const sourceHasChoice = slots\.some\(\(slot\) =>\s*Boolean\(breakfastSelections\[`\$\{date\}-\$\{slot\.id\}`\]\)\s*\);/
    );
    expect(bookingPageSrc).toMatch(/if \(!sourceHasChoice \|\| cutoff\.isLocked\) return null;/);
  });

  it("never offers the action on a locked source date", () => {
    expect(bookingPageSrc).toMatch(/if \(!sourceHasChoice \|\| cutoff\.isLocked\) return null;/);
  });

  it("excludes locked dates from the targets", () => {
    expect(bookingPageSrc).toMatch(/const laterEditableDates = dates\.filter\(\(later\) => \{/);
    expect(bookingPageSrc).toMatch(/return !laterCutoff\.isLocked;/);
  });

  it("only targets LATER dates", () => {
    expect(bookingPageSrc).toMatch(/if \(later <= date\) return false;/);
  });

  it("confirms how many dates were updated, via an inline live region", () => {
    // The guest app has no toast system, so the confirmation is an
    // inline `role="status"` rather than a transient overlay.
    expect(bookingPageSrc).toMatch(/role="status"/);
    expect(bookingPageSrc).toMatch(/aria-live="polite"/);
    expect(bookingPageSrc).toMatch(/data-testid=\{`breakfast-copy-notice-\$\{date\}`\}/);
    // Per OCT-M8 (2026-10-20, decision #294) the message itself moved
    // into `buildBreakfastCopyNotice` — the count is interpolated there
    // so the notice can also carry the date it belongs to. The page
    // must call the helper, not re-derive the copy inline.
    expect(bookingPageSrc).toMatch(
      /buildBreakfastCopyNotice\(date, result\.updatedDates\)/
    );
    expect(breakfastCopySrc).toMatch(
      /Applied these choices to \$\{updatedDates\} remaining day/
    );
  });

  it("uses the helper rather than re-deriving the copy inline", () => {
    // The import is a named multi-line import — assert the binding, not
    // the exact brace layout, so adding another helper to the module
    // does not break this net.
    expect(bookingPageSrc).toMatch(
      /import \{[^}]*copyBreakfastDateToRemaining[^}]*\} from "\.\.\/utils\/breakfastCopy"/
    );
    expect(bookingPageSrc).toMatch(/const result = copyBreakfastDateToRemaining\(\{/);
  });
});

describe("MBUX-05 — one context-aware Add-ons CTA", () => {
  it("the corporate flow still has its BR-10 pair (MBUX-09 owns parity)", () => {
    const corporateSrc = read("guest-app/src/pages/CorporateBookingPage.tsx");
    expect(corporateSrc).toMatch(/No add-ons, continue/);
  });

  it("the public flow does not", () => {
    expect(bookingPageSrc).not.toMatch(/No add-ons, continue/);
  });

  it("the retired BR-10 ghost link is gone from the public flow", () => {
    expect(bookingPageSrc).not.toMatch(/booking-addons-skip-addons/);
  });

  it("no new step key is minted for the consolidated action", () => {
    expect(bookingPageSrc).not.toMatch(/STEP_KEYS\.skipAddOns/);
    expect(bookingPageSrc).not.toMatch(/"skip-addons"/);
  });

  it("still advances to guest-details via a client-side PrimaryButton", () => {
    expect(bookingPageSrc).toMatch(/data-testid="booking-addons-continue-primary"/);
    expect(bookingPageSrc).toMatch(/to=\{`\/book\?\$\{guestDetailsParams\.toString\(\)\}`\}/);
  });
});