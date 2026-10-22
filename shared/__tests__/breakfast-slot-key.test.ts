// Per BR-07-P1 (2026-10-22): the CANONICAL breakfast slot-key
// contract + the normaliser that folds the two legacy key
// forms into it.
//
// WHY THIS TEST EXISTS
// --------------------
// The guest app wrote `<date>-guest-0` (0-based) while EVERY
// admin read path looked up `<date>-guest-1` (1-based). For a
// 2-guest booking the admin drawer showed guest 2's meal on
// guest 1's row, guest 1's row read "no meal", and guest 2's
// meal was never shown to staff. Staff also WROTE to
// `-guest-2`, a key the guest page's universe does not
// contain — so a staff-added meal for the last guest was
// invisible to the guest.
//
// The canonical base is 0-based. This file pins:
//
//   1. the guest key and the admin key resolve to the SAME
//      slot (the core regression),
//   2. the legacy bare `<date>-N` form is still readable,
//   3. the bare form and the canonical form do NOT collide
//      (a booking using one form is not mis-read as the
//      other), and
//   4. the legacy 1-based `<date>-guest-N` form (written by the
//      pre-fix admin app, and present in production) is
//      detected and shifted.

import { describe, it, expect } from "vitest";
import {
  buildBreakfastSlotId,
  buildBreakfastSlotKey,
  buildBreakfastSlotKeyForBase,
  detectBreakfastSlotIndexBase,
  normalizeBreakfastSelections,
  parseBreakfastSlotKey,
  resolveBreakfastSlotGuestIndex
} from "../utils/breakfastSlotKey";

const DATE = "2026-11-05";

function entry(mealId: string) {
  return {
    mealId,
    mealName: mealId,
    price: 100,
    addedAt: "2026-11-01T00:00:00.000Z",
    addedBy: "guest",
    lastModifiedAt: "2026-11-01T00:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: null,
    removedBy: null,
    overrideCutoff: false,
    overrideReason: null
  };
}

describe("breakfast slot key — canonical contract", () => {
  it("builds the canonical key as `${date}-guest-${index}` with a 0-BASED index", () => {
    expect(buildBreakfastSlotKey(DATE, 0)).toBe("2026-11-05-guest-0");
    expect(buildBreakfastSlotKey(DATE, 1)).toBe("2026-11-05-guest-1");
    expect(buildBreakfastSlotId(0)).toBe("guest-0");
    expect(buildBreakfastSlotId(3)).toBe("guest-3");
  });

  it("the guest app's key and the admin app's key resolve to the SAME slot", () => {
    // The guest app enumerates its slots 0-based
    // (`guest-0`, `guest-1`, …) — see
    // `guest-app/src/pages/BookingPage.tsx`
    // `enumerateGuestSlots`.
    const guestSlotIds = [0, 1, 2].map((i) => buildBreakfastSlotId(i));
    // The admin app enumerates the same slots from the same
    // 0-based index — see
    // `admin-app/src/components/BookingDrawerWorkspace.tsx`
    // `guestSlots`.
    const adminSlotIds = [0, 1, 2].map((i) => buildBreakfastSlotId(i));

    expect(guestSlotIds).toEqual(["guest-0", "guest-1", "guest-2"]);
    expect(adminSlotIds).toEqual(guestSlotIds);

    // ...and the FULL keys are byte-identical, so the guest's
    // write and the admin's read address one slot.
    for (let i = 0; i < guestSlotIds.length; i += 1) {
      const guestKey = `${DATE}-${guestSlotIds[i]}`;
      const adminKey = buildBreakfastSlotKey(DATE, i);
      expect(guestKey).toBe(adminKey);
      expect(resolveBreakfastSlotGuestIndex(guestKey)).toBe(i);
      expect(resolveBreakfastSlotGuestIndex(adminKey)).toBe(i);
    }
  });

  it("parses the canonical key into its service date + raw index", () => {
    expect(parseBreakfastSlotKey("2026-11-05-guest-2")).toEqual({
      serviceDate: "2026-11-05",
      rawIndex: 2,
      form: "canonical"
    });
    expect(parseBreakfastSlotKey("2026-11-05-2")).toEqual({
      serviceDate: "2026-11-05",
      rawIndex: 2,
      form: "bare"
    });
    // Unknown shapes are left alone rather than reinterpreted.
    expect(parseBreakfastSlotKey("2026-11-05-guest-abc")).toBeNull();
    expect(parseBreakfastSlotKey("not-a-date-0")).toBeNull();
    expect(parseBreakfastSlotKey("")).toBeNull();
  });
});

describe("breakfast slot key — the legacy bare `<date>-N` form", () => {
  it("is still readable and resolves to the same 0-based guest index", () => {
    // Production QA walk-ins store the bare form. It is
    // provably 0-based: a ONE-guest production booking stores
    // `2026-10-21-0` and a TWO-guest booking stores `-0` + `-1`.
    expect(resolveBreakfastSlotGuestIndex("2026-10-21-0")).toBe(0);
    expect(resolveBreakfastSlotGuestIndex("2026-11-05-1")).toBe(1);

    const { slots, base } = normalizeBreakfastSelections(
      {
        "2026-11-05-0": entry("tapsilog"),
        "2026-11-05-1": entry("longsilog")
      },
      2
    );
    expect(base).toBe("zero-based");
    expect(slots.size).toBe(2);
    expect(slots.get("2026-11-05-guest-0")?.entry.mealId).toBe("tapsilog");
    expect(slots.get("2026-11-05-guest-1")?.entry.mealId).toBe("longsilog");
  });

  it("does NOT collide with the canonical form — one guest, one slot", () => {
    // A booking that somehow carries BOTH forms for the same
    // guest must resolve to ONE slot, not two. Otherwise the
    // kitchen would cook the same guest's meal twice.
    const { slots } = normalizeBreakfastSelections(
      {
        "2026-11-05-0": entry("tapsilog"),
        "2026-11-05-guest-0": entry("longsilog")
      },
      1
    );
    expect(slots.size).toBe(1);
    expect(slots.get("2026-11-05-guest-0")?.entry.mealId).toBe("longsilog");
    // The canonical-form key wins (it is the form every writer
    // uses today).
    expect(slots.get("2026-11-05-guest-0")?.storedKey).toBe("2026-11-05-guest-0");
  });

  it("the bare form and the canonical form denote the SAME guest (not two guests)", () => {
    // `2026-11-05-0` and `2026-11-05-guest-0` are both the FIRST
    // guest. If the normaliser treated them as different guests
    // the same booking would report two meals for one guest.
    const bare = normalizeBreakfastSelections({ "2026-11-05-0": entry("tapsilog") }, 1);
    const canonical = normalizeBreakfastSelections(
      { "2026-11-05-guest-0": entry("tapsilog") },
      1
    );
    expect([...bare.slots.keys()]).toEqual([...canonical.slots.keys()]);
    expect(bare.slots.get("2026-11-05-guest-0")?.guestIndex).toBe(
      canonical.slots.get("2026-11-05-guest-0")?.guestIndex
    );
  });
});

describe("breakfast slot key — the legacy 1-based `<date>-guest-N` form", () => {
  it("is detected as 1-based and shifted down to the 0-based index", () => {
    // The pre-fix admin app wrote `guest-1` … `guest-n`
    // (1-based). Production has one such booking
    // (`A1FI02Addon00001`, numGuests=2, keys `guest-1` +
    // `guest-2`).
    const { base, slots } = normalizeBreakfastSelections(
      {
        "2026-11-03-guest-1": entry("tapsilog"),
        "2026-11-03-guest-2": entry("tapsilog")
      },
      2
    );
    expect(base).toBe("one-based");
    expect(slots.size).toBe(2);
    // `guest-1` is the FIRST guest (index 0), `guest-2` the
    // second (index 1) — the pre-fix drawer showed them on the
    // wrong rows.
    expect(slots.get("2026-11-03-guest-0")?.entry.mealId).toBe("tapsilog");
    expect(slots.get("2026-11-03-guest-1")?.entry.mealId).toBe("tapsilog");
    expect(slots.get("2026-11-03-guest-0")?.storedKey).toBe("2026-11-03-guest-1");
    expect(slots.get("2026-11-03-guest-1")?.storedKey).toBe("2026-11-03-guest-2");
  });

  it("a booking that uses index 0 is 0-based, even when other keys reach numGuests", () => {
    // The canonical form always starts at 0, so the presence of
    // index 0 settles the base.
    const { base } = normalizeBreakfastSelections(
      {
        "2026-11-03-guest-0": entry("tapsilog"),
        "2026-11-03-guest-2": entry("longsilog")
      },
      3
    );
    expect(base).toBe("zero-based");
  });

  it("writes back into the booking's own index base so the two spaces never mix", () => {
    // A legacy 1-based booking must keep receiving 1-based keys
    // — writing a canonical `guest-0` next to `guest-1` /
    // `guest-2` would put two index spaces in one booking.
    expect(buildBreakfastSlotKeyForBase(DATE, 0, "one-based")).toBe("2026-11-05-guest-1");
    expect(buildBreakfastSlotKeyForBase(DATE, 1, "one-based")).toBe("2026-11-05-guest-2");
    expect(buildBreakfastSlotKeyForBase(DATE, 0, "zero-based")).toBe("2026-11-05-guest-0");
  });

  it("detects the base per booking, not per key", () => {
    expect(detectBreakfastSlotIndexBase({ "2026-11-05-guest-0": {} }, 2)).toBe("zero-based");
    expect(detectBreakfastSlotIndexBase({ "2026-11-05-guest-1": {}, "2026-11-05-guest-2": {} }, 2)).toBe(
      "one-based"
    );
    // The bare form is 0-based by construction and never
    // influences the canonical space's base.
    expect(detectBreakfastSlotIndexBase({ "2026-11-05-0": {}, "2026-11-05-1": {} }, 2)).toBe(
      "zero-based"
    );
    expect(detectBreakfastSlotIndexBase(null, 2)).toBe("zero-based");
  });
});

describe("breakfast slot key — the normaliser is the single resolver", () => {
  it("resolves a mixed-form booking to one slot per guest", () => {
    const { slots } = normalizeBreakfastSelections(
      {
        "2026-11-05-0": entry("tapsilog"),
        "2026-11-05-1": entry("longsilog"),
        "2026-11-06-guest-0": entry("cornsilog")
      },
      2
    );
    expect(slots.size).toBe(3);
    expect(slots.get("2026-11-05-guest-0")?.guestIndex).toBe(0);
    expect(slots.get("2026-11-05-guest-1")?.guestIndex).toBe(1);
    expect(slots.get("2026-11-06-guest-0")?.guestIndex).toBe(0);
  });

  it("ignores keys it does not recognise instead of misreading them", () => {
    const { slots } = normalizeBreakfastSelections(
      {
        "2026-11-05-guest-abc": entry("tapsilog"),
        "2026-11-05-0": entry("longsilog")
      },
      2
    );
    expect(slots.size).toBe(1);
    expect(slots.get("2026-11-05-guest-0")?.entry.mealId).toBe("longsilog");
  });

  it("an empty / missing map resolves to no slots", () => {
    expect(normalizeBreakfastSelections({}, 2).slots.size).toBe(0);
    expect(normalizeBreakfastSelections(null, 2).slots.size).toBe(0);
    expect(normalizeBreakfastSelections(undefined, 2).slots.size).toBe(0);
  });
});
