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
      displayOrder: nonNegativeFinite(entry.displayOrder)
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
    cutoffTime: safeString(raw.cutoffTime, "20:00"),
    cutoffTimezone: safeString(raw.cutoffTimezone, "Asia/Manila"),
    defaultMealInstructions: safeString(raw.defaultMealInstructions, ""),
    meals: safeMeals(raw.meals)
  };
}
