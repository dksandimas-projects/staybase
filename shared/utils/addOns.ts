// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the add-on catalog normalizer + the pre-seed
// helper used by the admin Settings tab + the public
// `/api/bookings/addons/config` endpoint.
//
// Mirrors `normalizeBreakfastConfig` (BR-03) but for the new
// `addOns/{addOnId}` collection. The pre-seed pattern is the
// same one the legacy breakfast setup used: when no docs exist
// in the catalog, the Settings tab "Other Add-Ons" loads with a
// single row — "Airport transfer", ₱500/person, 24h cutoff —
// and the admin can edit or extend it from there.
//
// `normalizeAddOn` strips admin-only fields (none today, but
// reserved), defaults missing booleans to the safe value, and
// enforces the `unit` union so a legacy / corrupt doc never
// leaks through with an unknown unit.
//
// `getEnabledAddOnsByHotel` is the public-API filter — the
// guest-app `/api/bookings/addons/config` endpoint serves only
// the `isEnabled === true` rows, sorted by `displayOrder` asc.

import type { AddOn } from "../types";

/**
 * Per the BR-12 spec: the pre-seed catalog row used by the
 * admin Settings tab when `addOns/` is empty. The name +
 * price + cutoff are intentionally conservative defaults —
 * the admin can edit everything from the UI.
 */
export const AIRPORT_TRANSFER_PRESEED: Omit<AddOn, "id" | "updatedAt" | "updatedBy"> = {
  name: "Airport transfer",
  description:
    "One-way airport pickup or drop-off at Panglao International Airport (TAG). Driver meets you at arrivals with a name board. Price is per guest.",
  price: 500,
  unit: "per-person",
  isEnabled: true,
  cutoffHoursBeforeCheckIn: 24,
  displayOrder: 10
};

/**
 * Normalize one `addOns/{id}` doc into the canonical
 * `AddOn` shape. Defensive against missing fields so
 * legacy / partial docs from a partial BR-12 rollout
 * don't crash the public config endpoint. Returns
 * `null` when the doc is structurally broken (e.g.
 * missing name — readers can skip without a UI block).
 */
export function normalizeAddOn(raw: unknown, fallbackId?: string): AddOn | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, any>;
  const id = String(obj.id || fallbackId || "").trim();
  const name = String(obj.name || "").trim();
  if (!id || !name) return null;
  const price = Math.max(0, Number(obj.price) || 0);
  const unit: AddOn["unit"] = obj.unit === "per-stay" ? "per-stay" : "per-person";
  const cutoffHoursBeforeCheckIn = Math.max(
    0,
    Math.min(168, Math.floor(Number(obj.cutoffHoursBeforeCheckIn) || 24))
  );
  return {
    id,
    name,
    description: String(obj.description || "").trim().slice(0, 500),
    price,
    unit,
    isEnabled: obj.isEnabled !== false,
    cutoffHoursBeforeCheckIn,
    displayOrder: Math.floor(Number(obj.displayOrder) || 0),
    updatedAt: obj.updatedAt || new Date().toISOString(),
    updatedBy: String(obj.updatedBy || "")
  };
}

/**
 * Filter + sort the catalog for the public
 * `/api/bookings/addons/config` response. Returns ONLY the
 * `isEnabled === true` rows, sorted by `displayOrder` asc
 * then `name` asc as a stable tiebreaker.
 */
export function getEnabledAddOnsByHotel(addOns: AddOn[] | null | undefined): AddOn[] {
  if (!Array.isArray(addOns)) return [];
  return addOns
    .filter((a) => a && a.isEnabled === true)
    .slice()
    .sort((a, b) => {
      const da = Math.floor(Number(a.displayOrder) || 0);
      const db = Math.floor(Number(b.displayOrder) || 0);
      if (da !== db) return da - db;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
}

/**
 * Sort the full catalog (including disabled rows) for the
 * admin Settings tab list. Mirrors `getEnabledAddOnsByHotel`
 * but without the `isEnabled` filter.
 */
export function sortAddOnsByDisplayOrder(addOns: AddOn[] | null | undefined): AddOn[] {
  if (!Array.isArray(addOns)) return [];
  return addOns
    .slice()
    .sort((a, b) => {
      const da = Math.floor(Number(a.displayOrder) || 0);
      const db = Math.floor(Number(b.displayOrder) || 0);
      if (da !== db) return da - db;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
}