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
 * Per BR-13.x (Phase 14 — Seaport transfer v1, decision
 * #250): the second pre-seed catalog row. Cruise arrivals
 * are spikier than airports (a ferry from Cebu / Cagayan
 * de Oro / Manila / Palawan arrives in clusters), so the
 * cut-off is bumped to 48h instead of the 24h airport
 * default. The unit is `per-stay` (one transfer per
 * booking, NOT one per guest per day) — the structural
 * delta vs airport. Renders in the booking-drawer
 * "Other Add-Ons" tab + the WalkinOtherAddOnGrid as a
 * single row keyed on `checkIn`, not a per-day grid.
 *
 * Display order sits one above the airport row so the
 * catalog list reads transport-method-ascending on a
 * fresh install (airport first, seaport second).
 */
export const SEAPORT_TRANSFER_PRESEED: Omit<AddOn, "id" | "updatedAt" | "updatedBy"> = {
  name: "Seaport transfer",
  description:
    "Round-trip seaport transfer at Tagbilaran Pier (TAG) or the new Panglao Bay ferry terminal. Driver meets you at disembarkation with a name board. Price is per booking (one transfer covers the whole stay, regardless of guest count).",
  price: 1500,
  unit: "per-stay",
  isEnabled: true,
  cutoffHoursBeforeCheckIn: 48,
  displayOrder: 20
};

/**
 * Per BR-13.x: the ordered list of pre-seed rows the
 * admin Settings tab + the public `/api/bookings/addons/config`
 * endpoint write / fall back to when the catalog is empty.
 * The admin write path uses this list as the source of truth
 * (a single `writeBatch` writes every entry atomically); the
 * public read path concatenates a `SeaportTransferPreseed`
 * entry when the live `addOns` collection is missing or
 * truncated.
 */
export const ADDON_PRESEEDS: Array<
  Omit<AddOn, "updatedAt" | "updatedBy"> & { id: string }
> = [
  { id: "airport-transfer", ...AIRPORT_TRANSFER_PRESEED },
  { id: "seaport-transfer", ...SEAPORT_TRANSFER_PRESEED }
];

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