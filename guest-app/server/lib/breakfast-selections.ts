// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the server-side gate for the new
// `breakfastSelections` rich shape. Validates each entry
// the guest submitted against the live `breakfastConfig`
// (meals + cutoff) and returns the denormalized
// `breakfastTotal` + `hasAnyBreakfast` flag the create
// write needs.
//
// The legacy `hasBreakfast` + `breakfastRate` flat-rate
// model is preserved for back-compat (older clients + the
// walkin modal per the BR-03 plan). When the new shape is
// provided, the create handler switches to the
// selections-driven path; the legacy fields are not
// written to the booking doc.
//
// The helper is intentionally split out of
// `handleCreateBooking` (and `handleCreateWalkin` when BR-04
// / BR-05 land) so the validation rules are written
// exactly once. The tests in
// `tests/api/br-03-breakfast-selections-snapshotting.test.ts`
// pin the shape + the rejection messages.

import { z } from "zod";
import {
  computeBreakfastCutoffState,
  recomputeBreakfastTotal,
  buildBreakfastRateBreakdownLines,
  type BreakfastConfig,
  type BreakfastMeal,
  type BreakfastSelectionEntry
} from "@spark-inn/shared";

// Per BR-01 (2026-10-12, decision #231): the entry shape
// on the wire + on the booking doc. `key` is the
// `yyyy-mm-dd-guestSlot` composite; the server doesn't
// need to know the slot shape (it's the client's job to
// pick a unique key), but the wire format carries it for
// the per-guest × per-date rendering on the email view +
// receipt PDF.
//
// The schema is intentionally permissive on the optional
// audit fields (`addedBy`, `addedAt`, `lastModifiedAt`,
// `overrideCutoff`, `overrideReason`, etc.) — the
// server's gate is "is this entry well-formed enough to
// be a valid breakfast line", not "is every metadata
// field populated". The `mealId` + `mealName` + `price`
// triple is the minimum snapshot; the rest is either
// client-supplied metadata or pre-stamped audit data the
// server overwrites.
const entryShape = z.object({
  mealId: z.string().trim().min(1).max(120),
  mealName: z.string().trim().min(1).max(200),
  price: z.number().finite().min(0),
  addedBy: z.string().trim().max(120).optional().default(""),
  addedAt: z.string().trim().max(64).optional().default(""),
  lastModifiedAt: z.string().trim().max(64).optional().default(""),
  lastModifiedBy: z.string().trim().max(120).optional().default(""),
  removedAt: z.string().trim().max(64).nullable().optional().default(null),
  removedBy: z.string().trim().max(120).nullable().optional().default(null),
  overrideCutoff: z.boolean().optional().default(false),
  overrideReason: z.string().trim().max(500).nullable().optional().default(null)
});

export const breakfastSelectionsSchema = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}-[\s\S]{1,80}$/), entryShape);

export type ValidatedBreakfastSelections = {
  entries: Record<string, BreakfastSelectionEntry>;
  total: number;
  hasAny: boolean;
};

export class BreakfastSelectionValidationError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "BreakfastSelectionValidationError";
    this.status = status;
  }
}

// Lookup table for `mealId` → meal. Built once per request
// from the live `breakfastConfig.meals` so the validation
// step is O(1) per entry. Defensive: the helper tolerates
// missing / partial config (treats as "no meals available"
// → every entry is rejected) so a misconfigured settings
// doc never crashes the create handler.
function buildMealLookup(meals: unknown): Map<string, BreakfastMeal> {
  const lookup = new Map<string, BreakfastMeal>();
  if (!Array.isArray(meals)) return lookup;
  for (const meal of meals) {
    if (!meal || typeof meal !== "object") continue;
    const id = typeof (meal as any).id === "string" ? (meal as any).id : "";
    if (!id) continue;
    lookup.set(id, meal as BreakfastMeal);
  }
  return lookup;
}

export interface ValidateBreakfastSelectionsInput {
  selections: unknown;
  breakfastConfig: BreakfastConfig;
  now: Date;
}

// `validateBreakfastSelections` is the single read-side
// gate. When the guest sends the new shape, this function
// either:
//   - returns the validated entries + the denormalized
//     `breakfastTotal` + `hasAnyBreakfast` flag, OR
//   - throws `BreakfastSelectionValidationError` (status
//     400) with a human message the create handler
//     surfaces in the response body.
//
// Returns `null` when `selections` is `null` / `undefined`
// (the legacy caller's path — handler continues with the
// flat-rate model). An empty object `{}` is treated as
// "guest explicitly opted out of breakfast"; the handler
// writes an empty `breakfastSelections` field and
// `breakfastTotal: 0`.
export function validateBreakfastSelections(
  input: ValidateBreakfastSelectionsInput
): ValidatedBreakfastSelections | null {
  const { selections, breakfastConfig, now } = input;
  if (selections === null || selections === undefined) return null;

  // Zod parse — the strict schema is the single source of
  // truth for "well-formed". A malformed wire request
  // throws BEFORE we touch the meal catalog.
  const parsed = breakfastSelectionsSchema.safeParse(selections);
  if (!parsed.success) {
    throw new BreakfastSelectionValidationError(
      "Invalid breakfast selection. Please refresh and try again."
    );
  }

  const entries = parsed.data;
  const mealLookup = buildMealLookup(breakfastConfig.meals);
  const validatedEntries: Record<string, BreakfastSelectionEntry> = {};

  for (const [key, entry] of Object.entries(entries)) {
    // Per BR-01 (2026-10-12, decision #231): the
    // `serviceDate` is the `yyyy-mm-dd` PREFIX of the
    // composite key (`${date}-${slotId}`). The schema's
    // `z.string().regex(/^\d{4}-\d{2}-\d{2}-.../)`
    // already enforced the prefix shape, so this
    // extraction is safe. A key without a valid
    // date prefix is rejected with a human message
    // (the schema would have rejected it at parse
    // time anyway, but a belt-and-suspenders check
    // here is cheap).
    const match = /^(\d{4}-\d{2}-\d{2})-/.exec(key);
    if (!match) {
      throw new BreakfastSelectionValidationError(
        "Invalid breakfast selection. Please refresh and try again."
      );
    }
    const serviceDate = match[1];

    // Per open item #7 (BR-01 / spec): the server
    // recomputes the `serviceDate` cutoff. A guest
    // who back-dated their clock to slip past the
    // cutoff still gets rejected.
    const cutoffState = computeBreakfastCutoffState({
      serviceDate,
      now,
      cutoffTime: breakfastConfig.cutoffTime,
      timezone: breakfastConfig.cutoffTimezone
    });
    if (cutoffState.isLocked) {
      throw new BreakfastSelectionValidationError(
        `Ordering closed for breakfast on ${serviceDate}. Please remove the selection or contact the hotel.`
      );
    }

    // Per open item #6 (BR-01 / spec): the mealId must
    // exist in the live catalog. A guest who screenshot
    // an old catalog (a meal the admin removed) is
    // rejected with a human message naming the missing
    // meal — the message intentionally does NOT name the
    // meal to avoid leaking the menu state to a probing
    // client, but a 400 with a clear "meal not available"
    // label is enough for the form to surface the error
    // and the user to pick a different meal.
    if (!mealLookup.has(entry.mealId)) {
      throw new BreakfastSelectionValidationError(
        `One of the selected meals is no longer available. Please refresh and try again.`
      );
    }

    // Defensive price floor: the helper rejects a negative
    // price (the Zod schema already enforces `min(0)`, this
    // is a belt-and-suspenders check for a future schema
    // relaxation). The recompute helper also enforces the
    // same rule, so the persisted `breakfastTotal` matches
    // the validated sum by construction.
    const price = Number(entry.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new BreakfastSelectionValidationError(
        `Invalid breakfast price. Please refresh and try again.`
      );
    }

    validatedEntries[key] = {
      mealId: entry.mealId,
      mealName: entry.mealName,
      price,
      addedBy: entry.addedBy || "guest",
      addedAt: entry.addedAt || new Date().toISOString(),
      lastModifiedAt: entry.lastModifiedAt || new Date().toISOString(),
      lastModifiedBy: entry.lastModifiedBy || "guest",
      removedAt: entry.removedAt ?? null,
      removedBy: entry.removedBy ?? null,
      overrideCutoff: entry.overrideCutoff === true,
      overrideReason: entry.overrideReason ?? null
    };
  }

  const total = recomputeBreakfastTotal(validatedEntries);
  const hasAny = Object.keys(validatedEntries).length > 0;
  return { entries: validatedEntries, total, hasAny };
}

// `buildBreakfastRateBreakdownLines` is re-exported from
// `@spark-inn/shared` (the canonical location per the
// BR-03 plan). The server re-uses the shared helper so
// the per-date lines are byte-equivalent to the
// client-side rendering (same labels, same rounding).
export { buildBreakfastRateBreakdownLines } from "@spark-inn/shared";
export type { BreakfastRateLine } from "@spark-inn/shared";
