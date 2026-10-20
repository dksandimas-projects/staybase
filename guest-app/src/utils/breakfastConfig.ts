// Per OCT-L5 (2026-10-20, decision #299): a typed + normalized read
// path for the guest booking page's `breakfastConfig`.
//
// **What was wrong.** `BookingPage` declared its own inline shape
// for the local `breakfastConfig` state and that shape did NOT
// include `imageUrl` — the MBUX-04 meal thumbnail that
// `BreakfastMenuStrip` renders. The field survived only because the
// Firestore snapshot was read with `bSnap.data() as any`: one type
// edit away from silently dropping every meal photo on the booking
// flow, and the compiler could not see it.
//
// **What this module does.** It owns the shape and the normalizer.
// The page no longer casts the snapshot; it normalizes it. The
// `as any` is gone, and `imageUrl` is declared, so the thumbnails are
// part of the contract rather than a runtime accident.
//
// **Why not reuse `shared/types` `BreakfastConfig` directly?** The
// shared type marks `cutoffsEnabled` / `cutoffTime` /
// `cutoffTimezone` as REQUIRED, because the admin write path always
// writes them. The guest read path must tolerate a doc that
// pre-dates BR-10 (those fields absent) — the read sites already
// defaulted them (`!== false`, `|| "20:00"`). This module keeps that
// tolerance explicitly rather than widening the shared type or
// asserting the doc into a shape it may not have.

/**
 * One meal in the guest booking page's breakfast catalog.
 *
 * Mirrors `BreakfastMeal` from `shared/types`, but every field is
 * optional-tolerant because the guest reads a raw Firestore doc that
 * may have been written before a given field existed.
 */
export interface BookingBreakfastMeal {
  id: string;
  name: string;
  /** Optional marketing copy. */
  description?: string;
  /** PHP. Coerced to a finite number by {@link normalizeBreakfastConfig}. */
  price: number;
  /** Asc; drives the meal-picker sort. */
  displayOrder?: number;
  /** `false` hides the meal from the picker. */
  isActive?: boolean;
  /**
   * MBUX-04 (decision #256): optional guest-safe download URL for a
   * meal thumbnail. OMITTED (not an empty string) when no image is set.
   */
  imageUrl?: string;
}

/**
 * The guest booking page's local `breakfastConfig` shape.
 *
 * The cut-off fields stay optional because the snapshot may pre-date
 * BR-10 (decision #244); every read site already defaults them.
 */
export interface BookingBreakfastConfig {
  isEnabled: boolean;
  cutoffsEnabled?: boolean;
  cutoffTime?: string;
  cutoffTimezone?: string;
  defaultMealInstructions?: string;
  meals?: BookingBreakfastMeal[];
}

/** The defaults the booking page renders before the config loads. */
export const DEFAULT_BOOKING_BREAKFAST_CONFIG: BookingBreakfastConfig = {
  isEnabled: false,
  cutoffsEnabled: true,
  cutoffTime: "20:00",
  cutoffTimezone: "Asia/Manila",
  defaultMealInstructions: "",
  meals: []
};

/**
 * Normalize a raw `settings/breakfastConfig` Firestore snapshot into
 * the guest booking page's typed shape.
 *
 * Behaviour-preserving against the pre-fix `bSnap.data() as any` read:
 *
 *   • `isEnabled` keeps truthiness semantics — the read sites gate on
 *     truthiness, so `Boolean()` matches exactly.
 *   • `cutoffsEnabled` defaults to `true` when absent (the read site
 *     is `!== false`).
 *   • `cutoffTime` / `cutoffTimezone` default to the same literals the
 *     read sites used (`|| "20:00"`, `|| "Asia/Manila"`).
 *   • `isActive` on a meal keeps the `!== false` semantics the meal
 *     filter used.
 *
 * The ONE deliberate tightening: `price` is coerced to a finite number
 * (defaulting to `0`). The read sites multiply and format it, so an
 * absent price previously rendered `₱NaN`.
 */
export function normalizeBreakfastConfig(raw: unknown): BookingBreakfastConfig {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawMeals = Array.isArray(source.meals) ? source.meals : [];
  const meals: BookingBreakfastMeal[] = rawMeals
    .filter((meal): meal is Record<string, unknown> => !!meal && typeof meal === "object")
    .map((meal) => {
      const displayOrder = Number(meal.displayOrder);
      const normalized: BookingBreakfastMeal = {
        id: String(meal.id ?? ""),
        name: String(meal.name ?? ""),
        price: Number.isFinite(Number(meal.price)) ? Number(meal.price) : 0,
        isActive: meal.isActive !== false
      };
      if (typeof meal.description === "string") normalized.description = meal.description;
      if (Number.isFinite(displayOrder)) normalized.displayOrder = displayOrder;
      // Per MBUX-04: an empty string means "no image" and is
      // normalized to `undefined` so the strip can test it with a
      // single truthy check.
      if (typeof meal.imageUrl === "string" && meal.imageUrl) normalized.imageUrl = meal.imageUrl;
      return normalized;
    });

  return {
    isEnabled: Boolean(source.isEnabled),
    cutoffsEnabled: source.cutoffsEnabled !== false,
    cutoffTime: typeof source.cutoffTime === "string" ? source.cutoffTime : "20:00",
    cutoffTimezone: typeof source.cutoffTimezone === "string" ? source.cutoffTimezone : "Asia/Manila",
    defaultMealInstructions:
      typeof source.defaultMealInstructions === "string" ? source.defaultMealInstructions : "",
    meals
  };
}
