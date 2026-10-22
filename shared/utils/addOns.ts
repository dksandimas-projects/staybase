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
import type { OtherAddOnsCatalogResponse } from "./otherAddOnDrafts";

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
 * Per OCT-M1 (2026-10-20, decision #295): the hotel-wide
 * "Add-ons enabled" master switch.
 *
 * The Settings → Other Add-Ons tab has shown a hotel-wide toggle
 * since BR-12.1 (2026-10-15), but it was a bare `useState(true)` —
 * no Firestore read, no write, no localStorage mirror. The copy
 * under it claimed that turning it off would empty every
 * `getEnabledAddOnsByHotel` call, so an admin who flipped it
 * believed other add-ons were off sale while guests kept buying
 * the airport transfer.
 *
 * The switch is now real. It persists to
 * `settings/hotelConfig.otherAddOnsEnabled` and the public
 * `/api/bookings/addons/config` endpoint reads it, so turning it
 * off genuinely empties the catalog the guest app renders.
 *
 * The default is `true` — the pre-OCT-M1 behaviour was "add-ons are
 * on", and a legacy settings doc with no field must not silently
 * switch a hotel's revenue stream off.
 */
export const OTHER_ADD_ONS_ENABLED_DEFAULT = true;

/**
 * Normalize the raw `settings/hotelConfig.otherAddOnsEnabled` value.
 *
 * Defensive on purpose: the field is absent on every settings doc
 * written before OCT-M1, and a hand-edited doc could carry a
 * string. Only an explicit `false` disables the catalog.
 */
export function normalizeOtherAddOnsEnabled(raw: unknown): boolean {
  if (raw === false) return false;
  if (raw === true) return true;
  // A string "false" is the shape a hand-edited Firestore doc or a
  // legacy form field tends to land on. Treat it as the boolean it
  // spells rather than falling back to the default.
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "false") return false;
    if (normalized === "true") return true;
  }
  return OTHER_ADD_ONS_ENABLED_DEFAULT;
}

/**
 * Filter + sort the catalog for the public
 * `/api/bookings/addons/config` response. Returns ONLY the
 * `isEnabled === true` rows, sorted by `displayOrder` asc
 * then `name` asc as a stable tiebreaker.
 *
 * Per OCT-M1 (decision #295) the second argument is the hotel-wide
 * master switch. When it is explicitly `false` the catalog is empty
 * regardless of the per-row `isEnabled` flags — that is the whole
 * point of the switch. `undefined` (the pre-OCT-M1 call shape) means
 * "no master switch" and keeps the old per-row-only behaviour, so
 * every existing caller keeps working.
 */
export function getEnabledAddOnsByHotel(
  addOns: AddOn[] | null | undefined,
  hotelEnabled?: boolean
): AddOn[] {
  if (!Array.isArray(addOns)) return [];
  if (hotelEnabled === false) return [];
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
 * Build the PUBLIC other-add-ons catalog payload — the exact envelope
 * `GET /api/bookings/addons/config` answers.
 *
 * PURE (no Firestore), so the endpoint stays a thin adapter and the
 * payload rules are unit-testable instead of only observable through
 * a live request:
 *
 *  1. The hotel-wide master switch + the per-row `isEnabled` filter are
 *     applied HERE, exactly once. The rows are never re-filtered by a
 *     client: the public payload carries no `isEnabled`, so a client
 *     that re-filters would drop EVERY row (decision #313).
 *  2. Each row carries EXACTLY seven fields. `isEnabled` is
 *     deliberately dropped — the disabled rows are already gone — and
 *     `updatedAt`/`updatedBy` are admin-only metadata.
 *  3. `preSeeded` means ONE thing: "these rows came from the hard-coded
 *     fallback because the collection was EMPTY". It must NOT be
 *     derived from the row's id — a hotel that saved a REAL
 *     `airport-transfer` row in Settings → Other Add-Ons was being told
 *     (through this flag) that it was looking at a read-only
 *     placeholder.
 */
export function buildPublicAddOnsCatalog(input: {
  /** The normalized catalog rows (collection rows + the fallback row, if one was added). */
  rows: AddOn[] | null | undefined;
  /** The hotel-wide master switch (OCT-M1). `false` = the catalog is empty for every surface. */
  hotelEnabled: boolean;
  /** True when the rows came from the hard-coded fallback (the collection was empty). */
  usedFallback: boolean;
}): OtherAddOnsCatalogResponse {
  const enabled = getEnabledAddOnsByHotel(input.rows, input.hotelEnabled !== false);
  return {
    success: true,
    addOns: enabled.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      price: a.price,
      unit: a.unit,
      cutoffHoursBeforeCheckIn: a.cutoffHoursBeforeCheckIn,
      displayOrder: a.displayOrder
    })),
    otherAddOnsEnabled: input.hotelEnabled !== false,
    preSeeded: input.usedFallback === true
  };
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

/**
 * Per OCT-M3 (2026-10-20, decision #291): may the other-add-on
 * selections on a booking in this status still be EDITED?
 *
 * Per `plan/features/OTHER-ADD-ONS.md` §Edge cases: "Booking
 * checked-out / cancelled | **Both guest and staff update endpoints
 * reject with 400 "Booking is read-only."**"
 *
 * The guest endpoint (`addons-manage-save.ts`) enforced the rule
 * from day one, but the STAFF endpoint
 * (`addons-staff-update.ts`) never inspected `status` at all —
 * so the front desk could add an airport transfer to a checked-out
 * booking, and (when `paidAmount > 0`) write a
 * `category: "otherAddOn"` PENDING REFUND LIABILITY against a
 * closed booking, inflating the Liability tab with a refund for
 * something that was already served. `addons-mark-served.ts` had
 * the same gap (it never read the booking's status).
 *
 * This helper is the ONE rule, so the guest path, the staff
 * update path and the staff mark-served path can never drift
 * apart again.
 *
 * A `checked-in` booking is still mutable — a guest can arrive
 * and still buy an airport transfer for the next day.
 */
export function isOtherAddOnBookingMutable(status: unknown): boolean {
  // Case-insensitive on purpose: the rule exists to REFUSE edits on
  // a closed booking, so a status that differs only in case ("Cancelled",
  // "Checked-Out") must still be refused. Failing closed is the only
  // safe direction — the alternative lets a hand-edited doc reopen a
  // closed booking.
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized !== "checked-out" && normalized !== "cancelled";
}

/**
 * The canonical error message + HTTP status for a read-only
 * booking. The guest path's copy is preserved verbatim (it is the
 * one the guest already sees).
 */
export const OTHER_ADD_ON_READ_ONLY_ERROR = "Booking is read-only.";