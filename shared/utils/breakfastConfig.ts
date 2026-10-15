// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the public breakfast-config
// normalizer for `GET /api/bookings/breakfast/config`.
// Strips admin-only fields and the disabled entries the
// guest UI never sees, then returns the same shape
// `usePublicSiteContent().breakfastConfig` exposes
// client-side. The data model is locked by BR-01 — this
// helper is a thin wrapper, not a new schema.

import type { BreakfastConfig, BreakfastMeal } from "../types";

export interface PublicBreakfastConfig {
  isEnabled: boolean;
  /**
   * Per BR-10 (decision #244 reserved, 2026-10-14 — Phase 14):
   * the cut-off enforcement toggle mirrored to the public
   * payload. The guest-side + server-side callers read this
   * flag and forward it to `computeBreakfastCutoffState`,
   * which short-circuits when it is `false`. Public visibility
   * is intentional — the Add-ons step and Manage Breakfast
   * page both render the "Cut-offs disabled — order any time"
   * hint when this is off.
   */
  cutoffsEnabled: boolean;
  cutoffTime: string;
  cutoffTimezone: string;
  defaultMealInstructions: string;
  meals: PublicBreakfastMeal[];
}

export interface PublicBreakfastMeal {
  id: string;
  name: string;
  description: string;
  price: number;
  displayOrder: number;
  /**
   * Per MBUX-04 (decision #256, 2026-10-15): the guest-safe meal
   * thumbnail URL, or omitted when the catalog has no image.
   *
   * Only the rendered reference crosses the public boundary — the
   * Storage object path, metadata, size, and content type stay on the
   * admin side. The guest needs the URL and nothing else.
   */
  imageUrl?: string;
}

const ADMIN_ONLY_FIELDS: ReadonlySet<keyof BreakfastConfig> = new Set([
  "frontDeskOverrideEnabled",
  "servedGraceMinutes",
  "updatedBy",
  "updatedAt"
]);

// Defensive coerce — the source settings doc may have
// legacy / partially-migrated shapes. A missing field
// falls back to the BR-01 default (per `BreakfastConfig`)
// so the public endpoint never returns undefined for a
// required field. Defensive number coercion matches the
// existing `nonNegativeFinite` pattern used in the rest
// of the rate helpers.
function nonNegativeFinite(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function safeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Per MBUX-04: normalize an optional image URL down to either a
 * syntactically valid absolute URL or "absent".
 *
 * Returning `undefined` (rather than "") matters because the guest
 * fallback thumbnail keys off the field's PRESENCE. A meal with
 * `imageUrl: ""` would render a broken `<img src>` instead of the
 * fallback, so a malformed value is dropped here at the read boundary
 * rather than crashing the Step 2 menu strip later.
 */
function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function safeMeals(meals: unknown): PublicBreakfastMeal[] {
  if (!Array.isArray(meals)) return [];
  return meals
    .filter((entry): entry is BreakfastMeal => Boolean(entry) && typeof entry === "object")
    .filter((entry) => entry.isActive === true)
    .map((entry) => ({
      id: safeString(entry.id, ""),
      name: safeString(entry.name, "Unnamed meal"),
      description: safeString(entry.description, ""),
      price: nonNegativeFinite(entry.price),
      displayOrder: nonNegativeFinite(entry.displayOrder),
      // `undefined` keys are dropped by JSON.stringify on the wire, so
      // a meal without an image costs nothing in the public payload.
      ...(safeImageUrl(entry.imageUrl) ? { imageUrl: safeImageUrl(entry.imageUrl) } : {})
    }))
    .filter((entry) => entry.id.length > 0)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}

// `normalizeBreakfastConfig` is the single read-side
// boundary for the public breakfast config. The admin
// app writes the rich `BreakfastConfig` shape (per
// BR-01); the public read returns the trimmed
// `PublicBreakfastConfig` shape — the admin-only fields
// (e.g. `servedGraceMinutes`, `frontDeskOverrideEnabled`,
// `updatedBy`, `updatedAt`) are dropped so the guest
// never sees them via the API.
export function normalizeBreakfastConfig(source: unknown): PublicBreakfastConfig {
  const raw = (source && typeof source === "object" ? source : {}) as Record<string, unknown> & Partial<BreakfastConfig>;
  // Walk every field explicitly so the noUncheckedIndexedAccess
  // linter is happy + the field list is grep-able. The
  // ADMIN_ONLY_FIELDS set documents what we DROP — not
  // what we keep.
  void ADMIN_ONLY_FIELDS;
  return {
    isEnabled: safeBool(raw.isEnabled, false),
    // Per BR-10 (decision #244 reserved, 2026-10-14 — Phase 14):
    // legacy / pre-BR-10 settings docs may not have a
    // `cutoffsEnabled` field. Default to `true` (the
    // pre-BR-10 behaviour — cut-offs always enforced).
    // New writers always pass this explicitly.
    cutoffsEnabled: safeBool(raw.cutoffsEnabled, true),
    cutoffTime: safeString(raw.cutoffTime, "20:00"),
    cutoffTimezone: safeString(raw.cutoffTimezone, "Asia/Manila"),
    defaultMealInstructions: safeString(raw.defaultMealInstructions, ""),
    meals: safeMeals(raw.meals)
  };
}
