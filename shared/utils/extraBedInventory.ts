// Per EXB-10 (2026-08-01, per decision #157): the
// hotel-wide rollaway-bed inventory check. The
// inventory is configured in `settings/hotelConfig.extraBedInventory`
// (a positive integer = the count of rollaway beds the
// hotel physically owns; 0 or absent = the historical
// "any number" behavior, no constraint). The check
// runs INSIDE the same Firestore transaction that
// assigns the room — a read-then-write check outside
// the transaction would race exactly like RTS-01
// (two concurrent bookings both see "1 bed free" and
// both take it).
//
// The helper is intentionally pure — it takes a
// pre-fetched list of candidate bookings and returns
// the in-use count. The Firestore query lives at the
// call site (3 transactions: handleCreateBooking +
// handleCreateWalkin + handleRescheduleBooking) so
// the helper stays unit-testable without a Firestore
// mock. The query is a single `where("extraBedCount", ">", 0)
// .where("status", "in", BOOKING_OCCUPYING_STATUSES)`
// + an in-memory date-overlap filter; the candidate
// set is bounded (any booking with an extra bed is
// rare — single-digit per week for most hotels) so
// the per-doc filter is cheap.
//
// `excludeBookingId` is the reschedule case: the
// current booking's own extra-bed count must be
// excluded from the in-use sum, otherwise every
// reschedule would always "use" its own bed and
// reject the new configuration.
//
// Per EXB-03 (per decision #153): the date-overlap
// check uses the same shape as the room-occupancy
// loop — `existingEnd > rangeStart AND existingStart < rangeEnd`.
// The function is byte-equivalent to the in-line
// in-use computation the caller would write by hand,
// so the unit test is the only place the math needs
// to be verified.

import { isBookingOccupyingRoom } from "./bookingOccupancy";

export interface InventoryBooking {
  id?: string;
  extraBedCount?: number | null;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
  status?: string | null;
  // Per PEX-04 / `isBookingOccupyingRoom`:
  // `Date | string | null` (no `number` — Firestore
  // timestamps are converted to Date at the boundary
  // by `toDateOrNull` or the transaction read path).
  holdExpiresAt?: Date | string | null;
}

export interface InventoryCheckResult {
  // The total `extraBedCount` across all overlapping,
  // occupying bookings. Includes every non-cancelled,
  // non-expired-hold, non-checked-out booking that
  // shares any night with the new range.
  inUse: number;
  // The number of beds still available (0 or negative
  // when over capacity; the caller should reject).
  available: number;
  // `true` when `inUse + requestedCount <= inventory`
  // (or `inventory <= 0` per the "0 = no constraint"
  // semantics). `false` when over capacity.
  ok: boolean;
}

export function countExtraBedsInUse(
  bookings: InventoryBooking[],
  rangeStart: Date,
  rangeEnd: Date,
  excludeBookingId?: string,
  now: Date = new Date()
): number {
  // Per EXB-10: a defensive `Number(x) || 0` per
  // `extraBedCount` + a `isBookingOccupyingRoom` gate
  // + a date-overlap filter. Three guards, in that
  // order — same precedence as the existing
  // room-occupancy loop in `handleCreateBooking`.
  let total = 0;
  for (const b of bookings) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (!isBookingOccupyingRoom(
      { status: b.status, holdExpiresAt: b.holdExpiresAt },
      now
    )) continue;
    if (!b.checkIn || !b.checkOut) continue;
    const existingStart = b.checkIn instanceof Date
      ? b.checkIn
      : new Date(b.checkIn as any);
    const existingEnd = b.checkOut instanceof Date
      ? b.checkOut
      : new Date(b.checkOut as any);
    if (isNaN(existingStart.getTime()) || isNaN(existingEnd.getTime())) continue;
    // Standard half-open date overlap:
    // `existingEnd > rangeStart AND existingStart < rangeEnd`.
    // The boundaries use the canonical "checkout day is
    // not a stay night" convention (a booking from
    // Mon..Wed shares a night with Mon..Wed; a booking
    // from Wed..Thu does NOT share a night with
    // Mon..Wed because the existing check-out is
    // the same calendar day as the new check-in, and
    // checkout-day doesn't count as a stay night).
    if (existingEnd.getTime() <= rangeStart.getTime()) continue;
    if (existingStart.getTime() >= rangeEnd.getTime()) continue;
    total += Number(b.extraBedCount) || 0;
  }
  return total;
}

export function checkExtraBedInventory(
  inventory: number,
  inUse: number,
  requestedCount: number
): InventoryCheckResult {
  // Per EXB-10: 0 or absent = "no constraint" (the
  // historical "any number" behavior, byte-equivalent
  // to pre-EXB-10). A positive inventory enforces
  // `inUse + requested <= inventory`. The available
  // count is the unsigned remainder; `ok` is true
  // when the inventory is non-positive OR the
  // requested fits.
  const safeInventory = Math.max(0, Math.floor(Number(inventory) || 0));
  const safeInUse = Math.max(0, Math.floor(Number(inUse) || 0));
  const safeRequested = Math.max(0, Math.floor(Number(requestedCount) || 0));
  if (safeInventory <= 0) {
    return { inUse: safeInUse, available: Number.POSITIVE_INFINITY, ok: true };
  }
  const available = Math.max(0, safeInventory - safeInUse);
  return {
    inUse: safeInUse,
    available,
    ok: safeRequested <= available
  };
}
