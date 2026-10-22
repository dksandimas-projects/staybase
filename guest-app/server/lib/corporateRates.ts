// Per F09 / SEC-6 / SEC-5 (2026-10-22, P2 revenue leak): the hotel's
// corporate rate ladder — SERVER-SIDE ONLY.
//
// The ladder used to live in `shared/constants/index.ts`
// (`DEFAULT_ROOM_TYPES[].corporateRate`). That module is imported by
// the guest app, so the negotiated corporate prices (1600 / 2200 /
// 2300 / 2800 / 3900) were compiled into the JavaScript every guest
// downloaded. Closing the anonymous Firestore read was NOT enough —
// the numbers were still in the bundle.
//
// This module is the server-side home of the ladder:
//
//   - it lives under `guest-app/server/`, which is bundled by esbuild
//     into the Vercel catch-all function and is NEVER part of the
//     guest app's Vite build (`guest-app/src/**` is the only browser
//     entry surface), so no guest bundle can reach it;
//   - it is imported with a RELATIVE path, so it never enters the
//     `@spark-inn/shared` module graph (which the guest app imports
//     through the barrel).
//
// The staff admin app does NOT need this module: the corporate rate
// calendar reads the LIVE `settings/hotelConfig.roomTypes[]` through
// the staff-only Firestore rules, which is the authoritative source.
// The ladder here is the seed used when a hotel has no stored room
// types at all (a fresh deployment) and the fallback for the public
// corporate rate card.

import type { RoomTypeEntry } from "@spark-inn/shared";

/**
 * The seed corporate rate per room type (nightly, in the hotel's
 * currency). Mirrors the rates the admin seeded for Spark Inn.
 *
 * NEGOTIATED PRICING — staff + server only. Never import this from
 * anything under `guest-app/src/`.
 */
export const DEFAULT_CORPORATE_RATES: Readonly<Record<string, number>> = Object.freeze({
  single: 1600,
  "standard-double": 2200,
  "standard-twin": 2300,
  executive: 2800,
  family: 3900
});

/**
 * Resolve the corporate rate for one room type from a raw
 * `settings/hotelConfig.roomTypes[]` entry.
 *
 * Order: the STORED entry wins (the admin's live number), then the
 * seed ladder, then 0. A 0 rate means "no corporate rate configured"
 * and the booking server falls back to the standard rate (never ₱0).
 */
export function resolveCorporateRate(entry: unknown, typeValue: string): number {
  const stored = entry && typeof entry === "object"
    ? Number((entry as Record<string, unknown>).corporateRate)
    : 0;
  if (Number.isFinite(stored) && stored > 0) return stored;
  const seeded = Number(DEFAULT_CORPORATE_RATES[typeValue]);
  return Number.isFinite(seeded) && seeded > 0 ? seeded : 0;
}

/**
 * Build the published flat corporate rate card
 * (`ratePerRoomType`) from a raw `settings/hotelConfig` payload.
 *
 * Only types with a rate strictly greater than 0 appear in the map.
 * The NEGOTIATED per-company rates live in the `corporateCodes`
 * collection and are never part of this payload.
 */
export function buildCorporateRateCard(source: unknown): Record<string, number> {
  const card: Record<string, number> = {};
  const roomTypes = source && typeof source === "object"
    ? (source as Record<string, unknown>).roomTypes
    : null;
  if (!Array.isArray(roomTypes)) {
    for (const [typeValue, rate] of Object.entries(DEFAULT_CORPORATE_RATES)) {
      card[typeValue] = rate;
    }
    return card;
  }
  for (const entry of roomTypes) {
    if (!entry || typeof entry !== "object") continue;
    const typeValue = String((entry as Record<string, unknown>).value ?? "");
    if (!typeValue) continue;
    const rate = resolveCorporateRate(entry, typeValue);
    if (rate > 0) card[typeValue] = rate;
  }
  return card;
}

/**
 * Seed the corporate rate onto a room-type list that carries no
 * corporate rate (the shared `DEFAULT_ROOM_TYPES` seed now ships
 * `corporateRate: 0` so the guest bundle never carries the ladder).
 *
 * Server-side only — see the module header.
 */
export function applyCorporateRateSeed(
  types: readonly RoomTypeEntry[]
): RoomTypeEntry[] {
  return types.map((type) => ({
    ...type,
    corporateRate:
      Number(type.corporateRate) > 0
        ? Number(type.corporateRate)
        : Number(DEFAULT_CORPORATE_RATES[type.value]) || 0
  }));
}
