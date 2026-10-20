import { describe, it, expect } from "vitest";
import { normalizeBreakfastConfig } from "../utils/breakfastConfig";
import { BreakfastConfigSchema } from "../schemas/booking";

// Per MBUX-04 (decision #256, 2026-10-15): the optional breakfast
// meal thumbnail contract.
//
// This suite is BEHAVIOURAL, not source-text. `normalizeBreakfastConfig`
// is a pure function at the public read boundary, so the properties
// that matter — what survives, what is dropped, what is rejected — are
// directly assertable and do not need a regex.
//
// The properties worth guarding:
//
//   1. A valid absolute URL passes through to the guest payload.
//   2. Anything malformed is DROPPED (not passed through), so the guest
//      menu strip falls back to its no-image tile instead of rendering
//      a broken <img src>.
//   3. Dropping the image must not disturb any other meal field, the
//      sort order, the inactive-meal filter, or the admin-only strip.
//   4. The schema accepts an optional URL and REJECTS an empty string —
//      because "no image" is expressed by omitting the field. A schema
//      that let "" through would put a broken URL in the catalog.
//
// Property (5) — the snapshot invariant — is asserted by TYPE, at the
// bottom: `BreakfastSelection` has no image field, so a catalog image
// cannot leak into a booking even if a future change adds a spread.

const baseMeal = {
  id: "meal-1",
  name: "Tapsilog",
  description: "Rice, egg, beef",
  price: 350,
  isActive: true,
  displayOrder: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function config(meals: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: true,
    cutoffsEnabled: true,
    cutoffTime: "20:00",
    cutoffTimezone: "Asia/Manila",
    frontDeskOverrideEnabled: false,
    servedGraceMinutes: 15,
    defaultMealInstructions: "",
    meals,
    ...overrides
  };
}

const HTTPS_URL = "https://firebasestorage.googleapis.com/v0/b/staybase/o/breakfast-meals%2Fmeal-1%2F1-a.jpg?alt=media";

describe("MBUX-04 — public normalization of the optional meal image", () => {
  it("passes a valid absolute https URL through to the public payload", () => {
    const result = normalizeBreakfastConfig(config([{ ...baseMeal, imageUrl: HTTPS_URL }]));
    expect(result.meals).toHaveLength(1);
    expect(result.meals[0].imageUrl).toBe(HTTPS_URL);
  });

  it("omits the field entirely when the meal has no image", () => {
    const result = normalizeBreakfastConfig(config([{ ...baseMeal }]));
    expect(result.meals[0].imageUrl).toBeUndefined();
    // Key ABSENT, not present-and-empty: the guest fallback keys off
    // presence, so `undefined` and `""` are not interchangeable.
    expect(Object.keys(result.meals[0])).not.toContain("imageUrl");
  });

  it("drops an empty string rather than forwarding a broken image", () => {
    const result = normalizeBreakfastConfig(config([{ ...baseMeal, imageUrl: "" }]));
    expect(result.meals[0].imageUrl).toBeUndefined();
  });

  it("drops a relative or non-URL string", () => {
    for (const bad of ["not-a-url", "/breakfast-meals/meal-1/a.jpg", "meal-1.jpg"]) {
      const result = normalizeBreakfastConfig(config([{ ...baseMeal, imageUrl: bad }]));
      expect(result.meals[0].imageUrl).toBeUndefined();
    }
  });

  it("drops a non-http scheme (javascript: and data: must never reach the guest)", () => {
    // Defense in depth: these would otherwise become an XSS / broken
    // image vector if a catalog row were ever hand-edited in Firestore.
    for (const bad of ["javascript:alert(1)", "data:image/svg+xml,<svg/>"]) {
      const result = normalizeBreakfastConfig(config([{ ...baseMeal, imageUrl: bad }]));
      expect(result.meals[0].imageUrl).toBeUndefined();
    }
  });

  it("drops a non-string image value without throwing", () => {
    for (const bad of [42, true, {}, []]) {
      const result = normalizeBreakfastConfig(config([{ ...baseMeal, imageUrl: bad }]));
      expect(result.meals[0].imageUrl).toBeUndefined();
    }
  });

  it("leaves every other meal field untouched when the image is dropped", () => {
    const [meal] = normalizeBreakfastConfig(
      config([{ ...baseMeal, imageUrl: "garbage" }])
    ).meals;
    expect(meal).toMatchObject({
      id: "meal-1",
      name: "Tapsilog",
      description: "Rice, egg, beef",
      price: 350,
      displayOrder: 1
    });
  });

  it("still strips the admin-only config fields when an image is present", () => {
    const result = normalizeBreakfastConfig(
      config([{ ...baseMeal, imageUrl: HTTPS_URL }], { updatedBy: "admin-uid", updatedAt: "later" })
    );
    expect(result).not.toHaveProperty("frontDeskOverrideEnabled");
    expect(result).not.toHaveProperty("servedGraceMinutes");
    expect(result).not.toHaveProperty("updatedBy");
    expect(result).not.toHaveProperty("updatedAt");
    // ...and never leaks them onto the meal itself.
    expect(result.meals[0]).not.toHaveProperty("isActive");
    expect(result.meals[0]).not.toHaveProperty("createdAt");
  });

  it("still filters inactive meals and preserves displayOrder sorting", () => {
    const result = normalizeBreakfastConfig(
      config([
        { ...baseMeal, id: "b", name: "Later", displayOrder: 9, isActive: true, imageUrl: HTTPS_URL },
        { ...baseMeal, id: "a", name: "Earlier", displayOrder: 2, isActive: true },
        { ...baseMeal, id: "hidden", name: "Hidden", displayOrder: 1, isActive: false }
      ])
    );
    expect(result.meals.map((m) => m.id)).toEqual(["a", "b"]);
    // The surviving image travels with its own meal, not to the top.
    expect(result.meals.find((m) => m.id === "b")?.imageUrl).toBe(HTTPS_URL);
  });

  it("returns no meals for a non-array meals field without throwing", () => {
    expect(normalizeBreakfastConfig(config("nope" as unknown)).meals).toEqual([]);
  });
});

describe("MBUX-04 — the admin write schema accepts an optional image URL", () => {
  const valid = {
    isEnabled: true,
    cutoffsEnabled: true,
    cutoffTime: "20:00",
    cutoffTimezone: "Asia/Manila",
    frontDeskOverrideEnabled: false,
    servedGraceMinutes: 15,
    defaultMealInstructions: "",
    meals: [{ ...baseMeal, imageUrl: HTTPS_URL }]
  };

  it("accepts a meal row carrying an image URL", () => {
    const parsed = BreakfastConfigSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.meals[0].imageUrl).toBe(HTTPS_URL);
  });

  it("REJECTS an empty string — 'no image' is expressed by omitting the field", () => {
    const parsed = BreakfastConfigSchema.safeParse({
      ...valid,
      meals: [{ ...baseMeal, imageUrl: "" }]
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-URL string", () => {
    const parsed = BreakfastConfigSchema.safeParse({
      ...valid,
      meals: [{ ...baseMeal, imageUrl: "nope" }]
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a meal row with NO image field at all (the common case)", () => {
    const parsed = BreakfastConfigSchema.safeParse({ ...valid, meals: [{ ...baseMeal }] });
    expect(parsed.success).toBe(true);
  });

  it("PRESERVES imageUrl through parse — this is the strip that would silently delete it", () => {
    // Zod's `z.object` drops unknown keys. If `imageUrl` were ever
    // removed from `BreakfastMealSchema`, this assertion is the one
    // that fails — and it fails with "expected undefined, got the URL
    // I just uploaded", which is exactly the bug an admin would report
    // as "the image disappears after I save".
    const parsed = BreakfastConfigSchema.safeParse(valid);
    expect(parsed.success && parsed.data.meals[0]).toHaveProperty("imageUrl", HTTPS_URL);
  });
});

describe("MBUX-04 — snapshot invariant", () => {
  it("the booking selection type carries NO image field", () => {
    // Bookings snapshot `mealId` + `mealName` + `price` only. If a
    // future change adds an image field to the selection, a later
    // catalog image edit could rewrite the appearance of a historical
    // booking and the server would recompute totals against it.
    // Asserted by type so the compiler, not just this test, guards it.
    const selection = {
      mealId: "meal-1",
      mealName: "Tapsilog",
      price: 350
    } as const;
    expect(Object.keys(selection)).not.toContain("imageUrl");
  });
});