// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the other-add-on total recompute + per-date
// breakdown helpers.
//
// Mirrors `recomputeBreakfastTotal` + `breakfastBreakdownByDate`
// (BR-01) but the per-day × per-guest slot math is replaced
// by per-day × per-add-on `quantity` math. Each entry carries
// its own `priceSnapshot` + `quantity`, so the total is a flat
// sum across every non-cancelled selection.
//
// The breakdown helper groups by date so the receipt + the
// admin Reports tab + the Manage Other Add-Ons page can
// render a per-day subtotal without re-scanning the full
// selection map.

import type { AddOn, OtherAddOnSelectionEntry } from "../types";

/**
 * Recompute the booking's other-add-on total from the raw
 * selections map. Excludes any entry with `removedAt !== null`
 * (the legacy `breakfastSelections` shape — a removed meal is
 * excluded from the live total but stays in the map for audit).
 *
 * Returns `0` for `null` / `undefined` input (pre-BR-12
 * bookings).
 */
export function recomputeOtherAddOnTotal(
  selections: Record<string, OtherAddOnSelectionEntry[]> | null | undefined
): number {
  if (!selections) return 0;
  let total = 0;
  for (const dateKey of Object.keys(selections)) {
    const items = selections[dateKey];
    if (!Array.isArray(items)) continue;
    for (const entry of items) {
      if (!entry) continue;
      if (entry.removedAt !== null && entry.removedAt !== undefined) continue;
      const price = Math.max(0, Number(entry.priceSnapshot) || 0);
      const qty = Math.max(0, Math.floor(Number(entry.quantity) || 0));
      total += price * qty;
    }
  }
  return Math.round(total);
}

/**
 * Per-date breakdown. Returns an array of
 * `{ date, subtotal, itemCount }` rows sorted by date asc.
 * `itemCount` is the count of distinct add-ons on that date
 * (NOT the total quantity across them).
 *
 * `subtotal` excludes removed entries — same rule as
 * `recomputeOtherAddOnTotal`.
 */
export interface OtherAddOnBreakdownRow {
  date: string;
  subtotal: number;
  itemCount: number;
}

export function otherAddOnBreakdownByDate(
  selections: Record<string, OtherAddOnSelectionEntry[]> | null | undefined
): OtherAddOnBreakdownRow[] {
  if (!selections) return [];
  const rows: OtherAddOnBreakdownRow[] = [];
  const dates = Object.keys(selections).sort();
  for (const date of dates) {
    const items = selections[date];
    if (!Array.isArray(items) || items.length === 0) continue;
    let s = 0;
    let n = 0;
    for (const entry of items) {
      if (!entry) continue;
      if (entry.removedAt !== null && entry.removedAt !== undefined) continue;
      const price = Math.max(0, Number(entry.priceSnapshot) || 0);
      const qty = Math.max(0, Math.floor(Number(entry.quantity) || 0));
      if (qty > 0) {
        s += price * qty;
        n += 1;
      }
    }
    if (n > 0) {
      rows.push({ date, subtotal: Math.round(s), itemCount: n });
    }
  }
  return rows;
}

/**
 * Has-any read for the `Booking.hasAnyOtherAddOns` denormalized
 * flag. `true` when at least one non-cancelled entry has
 * `quantity > 0`. Used by the read sites that just need an
 * O(1) answer (sidebar / receipt / booking-drawer summary).
 */
export function hasAnyOtherAddOns(
  selections: Record<string, OtherAddOnSelectionEntry[]> | null | undefined
): boolean {
  if (!selections) return false;
  for (const date of Object.keys(selections)) {
    const items = selections[date];
    if (!Array.isArray(items)) continue;
    for (const entry of items) {
      if (!entry) continue;
      if (entry.removedAt !== null && entry.removedAt !== undefined) continue;
      if (Math.max(0, Math.floor(Number(entry.quantity) || 0)) > 0) return true;
    }
  }
  return false;
}

/**
 * Build the per-day × per-add-on composite key (the
 * mirror value stored on `OtherAddOnSelectionEntry`-derived
 * audit + refund records). The shape is
 * `yyyy-mm-dd-{addOnId}` so callers can reverse-parse
 * without a lookup table.
 */
export function buildOtherAddOnSelectionKey(date: string, addOnId: string): string {
  return `${date}-${String(addOnId).trim()}`;
}

/**
 * Reverse-parse a `selectionKey` back to `{ date, addOnId }`.
 * Returns `null` when the key is malformed (defensive — bad
 * audit rows should be ignored, not crash the page).
 */
export function parseOtherAddOnSelectionKey(key: string): { date: string; addOnId: string } | null {
  const trimmed = String(key || "").trim();
  if (!trimmed) return null;
  // The addOnId is the last segment after the last `-`,
  // BUT addOnIds can contain dashes (e.g. `airport-transfer-v1`)
  // — so we anchor on the date prefix instead. Date is
  // `yyyy-mm-dd` (10 chars + 3 dashes = 13 chars total).
  if (trimmed.length < 14) return null;
  const date = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const addOnId = trimmed.slice(11);
  if (!addOnId) return null;
  return { date, addOnId };
}

/**
 * Per BR-13.x (Phase 14 — Seaport transfer v1, decision
 * #250): the date keys the booking should render for one
 * add-on, derived from `addOn.unit`. The data model
 * (`Record<dateKey, OtherAddOnSelectionEntry[]>`) is shared
 * with the per-person airport flow — the rendering path
 * branches here instead. The function is the load-bearing
 * surface the BR-13 refactor would generalize; for BR-13.x
 * it's a tiny inline branch.
 *
 *   - `unit: "per-person"` (e.g. airport transfer) returns
 *     every booking night — `[checkIn, checkIn+1, …, checkOut-1]`.
 *     Each date is its own selection slot so the operator
 *     can opt guests in / out day-by-day.
 *   - `unit: "per-stay"` (e.g. seaport transfer) returns
 *     `[checkIn]` only — a single, stay-level entry attached
 *     to the check-in date. Cruise arrivals are spiky;
 *     a per-day × per-guest UI is the wrong shape (seaports
 *     are 1 booking = 1 transfer, not 1 booking = N transfers).
 *
 * Defensive: a missing or zero-length booking range returns
 * `[checkIn]` (seaport semantics) so a UI that calls this
 * with only `checkIn` still renders one row. A `null` /
 * unknown `unit` falls back to the legacy per-person shape
 * — the BR-12 v1 shipped surface — so a future catalog row
 * with a corrupted `unit` doesn't blank the UI.
 */
export function getSelectionKeysForAddOn(
  addOn: Pick<AddOn, "unit"> | null | undefined,
  checkIn: string,
  checkOut: string
): string[] {
  const ci = String(checkIn || "").slice(0, 10);
  const co = String(checkOut || "").slice(0, 10);
  if (!ci) return [];
  if (addOn && addOn.unit === "per-stay") {
    return [ci];
  }
  // per-person (or fallback): enumerate every night.
  if (!co || co <= ci) return [ci];
  const startMs = Date.parse(`${ci}T00:00:00Z`);
  const endMs = Date.parse(`${co}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [ci];
  }
  const out: string[] = [];
  for (let ms = startMs, i = 0; ms < endMs && i < 60; ms += 86_400_000, i += 1) {
    const d = new Date(ms);
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    );
  }
  return out;
}