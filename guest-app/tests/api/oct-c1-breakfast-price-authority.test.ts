// Per OCT-C1 (2026-10-20, audit
// `plan/project/AUDIT-OCTOBER-2026.md`): the server must take
// the breakfast price + name from the LIVE catalog, never from
// the request.
//
// The pre-fix `validateBreakfastSelections` checked only
// `mealLookup.has(entry.mealId)` and then persisted
// `entry.price` — the CLIENT's wire value. A guest could POST
// `price: 0` and book free breakfasts; the tampered value
// flowed into `breakfastTotal` → `totalPrice` → VAT → the folio
// → the receipt PDF → the confirmation email.
//
// This is a REAL unit test of the pure validator (not a
// source-text pin), because the validator is a pure function
// and the bug was a data-flow bug, not a structural one. The
// source-text pins at the bottom guard the two places where the
// bug could be reintroduced.

import { describe, expect, it, vi } from "vitest";

// The lib imports `adminDb` for `auditBreakfastOp` (the write
// path). The validator itself never touches Firestore, so a
// minimal stub is enough to import the module.
vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({ doc: () => ({ set: async () => undefined }) })
      })
    })
  }
}));

const { validateBreakfastSelections, BreakfastSelectionValidationError } =
  await import("../../server/lib/breakfast-selections");

const HOTEL_TZ = "Asia/Manila";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: true,
    cutoffsEnabled: true,
    cutoffTime: "20:00",
    cutoffTimezone: HOTEL_TZ,
    frontDeskOverrideEnabled: false,
    meals: [
      { id: "tapsilog", name: "Tapsilog", price: 350, isActive: true, displayOrder: 1 },
      { id: "fruit", name: "Fresh Fruit", price: 180, isActive: true, displayOrder: 2 }
    ],
    ...overrides
  } as any;
}

const NOW = new Date("2026-10-01T12:00:00Z");

describe("OCT-C1 — the server owns the breakfast price + name", () => {
  it("ignores a client price of 0 and snapshots the catalog price", () => {
    const result = validateBreakfastSelections({
      selections: {
        "2026-10-14-guest-0": {
          mealId: "tapsilog",
          mealName: "Tapsilog",
          price: 0
        }
      },
      breakfastConfig: makeConfig(),
      now: NOW
    });

    expect(result).not.toBeNull();
    expect(result!.total).toBe(350);
    expect(result!.entries["2026-10-14-guest-0"].price).toBe(350);
  });

  it("ignores an inflated client price", () => {
    const result = validateBreakfastSelections({
      selections: {
        "2026-10-14-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 1 }
      },
      breakfastConfig: makeConfig(),
      now: NOW
    });

    expect(result!.entries["2026-10-14-guest-0"].price).toBe(350);
    expect(result!.total).toBe(350);
  });

  it("ignores a client-supplied meal name and snapshots the catalog name", () => {
    const result = validateBreakfastSelections({
      selections: {
        "2026-10-14-guest-0": { mealId: "tapsilog", mealName: "Free Lunch", price: 350 }
      },
      breakfastConfig: makeConfig(),
      now: NOW
    });

    expect(result!.entries["2026-10-14-guest-0"].mealName).toBe("Tapsilog");
  });

  it("accepts a request that omits the price entirely (the server fills it in)", () => {
    const result = validateBreakfastSelections({
      selections: {
        "2026-10-14-guest-0": { mealId: "tapsilog" }
      },
      breakfastConfig: makeConfig(),
      now: NOW
    });

    expect(result!.entries["2026-10-14-guest-0"].price).toBe(350);
  });

  it("totals the CATALOG prices across every slot", () => {
    const result = validateBreakfastSelections({
      selections: {
        "2026-10-14-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 0 },
        "2026-10-14-guest-1": { mealId: "fruit", mealName: "Fresh Fruit", price: 0 },
        "2026-10-15-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 0 }
      },
      breakfastConfig: makeConfig(),
      now: NOW
    });

    // 350 + 180 + 350
    expect(result!.total).toBe(880);
    expect(result!.hasAny).toBe(true);
  });

  it("still rejects a meal that is not in the live catalog", () => {
    expect(() =>
      validateBreakfastSelections({
        selections: {
          "2026-10-14-guest-0": { mealId: "not-a-real-meal", mealName: "Ghost", price: 0 }
        },
        breakfastConfig: makeConfig(),
        now: NOW
      })
    ).toThrow(BreakfastSelectionValidationError);
  });

  it("rejects a locked date for the public path", () => {
    // 2026-10-14 with a 20:00 Asia/Manila cut-off, `now` is
    // 2026-10-14T14:00Z (= 22:00 Manila) — past the cut-off.
    expect(() =>
      validateBreakfastSelections({
        selections: {
          "2026-10-14-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 350 }
        },
        breakfastConfig: makeConfig(),
        now: new Date("2026-10-14T14:00:00Z")
      })
    ).toThrow(BreakfastSelectionValidationError);
  });

  it("allows a locked date for a staff-created booking (OCT-C5: a walk-in has no prior selection to lock)", () => {
    const result = validateBreakfastSelections({
      selections: {
        "2026-10-14-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 350 }
      },
      breakfastConfig: makeConfig(),
      now: new Date("2026-10-14T14:00:00Z"),
      staffCreated: true
    });

    expect(result).not.toBeNull();
    expect(result!.total).toBe(350);
  });
});
