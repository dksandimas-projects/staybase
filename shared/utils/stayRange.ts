// Per DR-01 (date-range normalization, 2026-10-14): the single
// source of truth for "is this stay range actually bookable?".
//
// The bug this closes: the guest-facing `DateRangePicker` only
// guarded ONE direction. It clamped a typed check-out that fell
// before `checkIn + 1`, but nothing handled check-in being moved
// to a date on/after an already-set check-out. Native
// `<input type="date" min>` constrains what the picker lets you
// CLICK — it does not correct a value that is already out of
// bounds, so a guest could set check-in Oct 16 with check-out
// Oct 9 and submit it. The server then computed
// `Math.max(checkOut - checkIn, 0)` → a 0-night booking.
//
// This module is deliberately PURE and string-based. Every date
// crossing the guest-app boundary is an ISO `YYYY-MM-DD` hotel-
// local date key (see `getDateKeyInTimezone`). Two consequences:
//
//   1. ISO date keys compare correctly with `<` / `>` as plain
//      strings (zero-padding is fixed-width), so the clamp logic
//      needs no `Date` parsing at all for its comparisons.
//   2. Arithmetic is done by re-anchoring at `T00:00:00Z` and
//      mutating via `setUTCDate`, which keeps day math free of
//      DST/timezone drift for any real-world timezone offset.
//
// Every helper here is safe to import from both the Vite apps and
// the Vercel API handlers (see GOTCHAS.md §npm Workspaces).

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict `YYYY-MM-DD` validation. Rejects malformed strings AND
 * calendar-impossible dates that `Date` would silently roll over
 * (e.g. `2026-02-31` → Mar 3).
 */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** Adds (or subtracts) whole days to an ISO date key. Invalid input returns `fallback`. */
export function addDaysToIsoDate(value: string, days: number, fallback = ""): string {
  if (!isValidIsoDate(value)) return fallback;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole nights between two ISO date keys. Negative when the range is inverted. */
export function diffNightsBetweenIso(first: string, second: string): number {
  if (!isValidIsoDate(first) || !isValidIsoDate(second)) return 0;
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${second}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Why `normalizeStayRange` changed the caller's input. The UI
 * surfaces this as a short inline hint so an auto-corrected date
 * reads as "the picker helped you" rather than "the picker ate
 * my input".
 */
export type StayRangeAdjustmentReason =
  | "empty"
  | "check-in-clamped-to-today"
  | "check-out-clamped-after-check-in"
  | "nights-preserved"
  | "horizon-capped"
  | "invalid-check-in"
  | "invalid-check-out";

export interface NormalizeStayRangeOptions {
  /** Requested check-in ISO key (may be blank / malformed / past). */
  checkIn?: string | null;
  /** Requested check-out ISO key (may be blank / malformed / inverted). */
  checkOut?: string | null;
  /** Today's date in the property's timezone — the earliest legal check-in. */
  minCheckIn: string;
  /**
   * Night count to preserve when the requested range is inverted.
   * The picker passes the last *valid* range length so moving
   * check-in past check-out keeps the stay length the guest
   * already chose (Booking.com / Airbnb convention) instead of
   * silently collapsing a 2-night stay into 1 night.
   */
  previousNights?: number | null;
  /** Stay length used when there is no prior valid range to preserve. */
  defaultNights?: number;
  /** Hard cap on stay length. */
  maxNights?: number;
  /** Latest legal check-out (booking horizon). Defaults to `minCheckIn + maxNights`. */
  maxCheckOut?: string;
}

export interface NormalizeStayRangeResult {
  checkIn: string;
  checkOut: string;
  nights: number;
  /** `null` when the input was already valid and untouched. */
  adjustment: StayRangeAdjustmentReason | null;
}

export const DEFAULT_STAY_NIGHTS = 1;
export const DEFAULT_MAX_STAY_NIGHTS = 30;

/**
 * The one function every date surface should call before trusting a
 * check-in/check-out pair.
 *
 * Guarantees on the returned value:
 *   - `checkIn` is a valid ISO key and `>= minCheckIn`
 *   - `checkOut` is a valid ISO key and `>= checkIn + 1` night
 *   - `checkOut <= maxCheckOut` (horizon cap)
 *   - `nights === diffNightsBetweenIso(checkIn, checkOut)`
 *
 * @see DR-01 in plan/docs/GOTCHAS.md
 */
export function normalizeStayRange({
  checkIn,
  checkOut,
  minCheckIn,
  previousNights = null,
  defaultNights = DEFAULT_STAY_NIGHTS,
  maxNights = DEFAULT_MAX_STAY_NIGHTS,
  maxCheckOut
}: NormalizeStayRangeOptions): NormalizeStayRangeResult {
  const today = isValidIsoDate(minCheckIn)
    ? minCheckIn
    : new Date().toISOString().slice(0, 10);

  const horizon =
    isValidIsoDate(maxCheckOut ?? "") && (maxCheckOut as string) > today
      ? (maxCheckOut as string)
      : addDaysToIsoDate(today, maxNights, addDaysToIsoDate(today, defaultNights, today));

  // The longest stay the horizon can actually accommodate.
  const horizonNights = Math.max(diffNightsBetweenIso(today, horizon), defaultNights);
  const stayCap = Math.max(Math.min(maxNights, horizonNights), 1);

  const rawIn = isValidIsoDate(checkIn ?? "") ? (checkIn as string) : null;
  const rawOut = isValidIsoDate(checkOut ?? "") ? (checkOut as string) : null;

  // Nothing usable supplied at all — seed a clean default range.
  if (!rawIn && !rawOut) {
    const seededCheckOut = addDaysToIsoDate(today, defaultNights, today);
    return {
      checkIn: today,
      checkOut: seededCheckOut <= today ? addDaysToIsoDate(today, 1, today) : seededCheckOut,
      nights: defaultNights,
      adjustment: "empty"
    };
  }

  let adjustment: StayRangeAdjustmentReason | null = null;

  // --- check-in: never in the past, never malformed ---
  let checkInCandidate: string;
  if (!rawIn) {
    const derived = rawOut && rawOut > today ? addDaysToIsoDate(rawOut, -defaultNights, "") : "";
    checkInCandidate = !derived || derived < today ? today : derived;
    adjustment = "invalid-check-in";
  } else if (rawIn < today) {
    checkInCandidate = today;
    adjustment = "check-in-clamped-to-today";
  } else {
    checkInCandidate = rawIn;
  }
  const nextIn: string = checkInCandidate;

  // --- check-out: must land at least one night after check-in ---
  let checkOutCandidate: string;
  if (!rawOut) {
    checkOutCandidate = addDaysToIsoDate(nextIn, defaultNights, addDaysToIsoDate(nextIn, 1, nextIn));
    if (adjustment === null) adjustment = "invalid-check-out";
  } else if (rawOut <= nextIn) {
    // Preserve the guest's intended stay length when we know it.
    const preserveable =
      typeof previousNights === "number" && Number.isFinite(previousNights)
        ? Math.floor(previousNights)
        : null;
    const nights =
      preserveable !== null && preserveable >= 1
        ? Math.min(preserveable, stayCap)
        : Math.min(defaultNights, stayCap);
    checkOutCandidate = addDaysToIsoDate(nextIn, nights, addDaysToIsoDate(nextIn, 1, nextIn));
    adjustment =
      preserveable !== null && preserveable >= 1
        ? "nights-preserved"
        : "check-out-clamped-after-check-in";
  } else {
    checkOutCandidate = rawOut;
  }

  // --- booking horizon ---
  if (checkOutCandidate > horizon) {
    checkOutCandidate = horizon;
    adjustment = "horizon-capped";
  }

  // --- final guard: the two must never be inverted or zero-night ---
  if (checkOutCandidate <= nextIn) {
    checkOutCandidate = addDaysToIsoDate(nextIn, 1, nextIn);
    adjustment = "check-out-clamped-after-check-in";
  }

  const nextOut: string = checkOutCandidate;

  return {
    checkIn: nextIn,
    checkOut: nextOut,
    nights: Math.max(diffNightsBetweenIso(nextIn, nextOut), 1),
    adjustment
  };
}

/** True only when the pair is a real, bookable stay (no normalization needed). */
export function isValidStayRange(
  checkIn: unknown,
  checkOut: unknown,
  minCheckIn: string
): boolean {
  if (!isValidIsoDate(checkIn) || !isValidIsoDate(checkOut)) return false;
  if (checkIn < minCheckIn) return false;
  return diffNightsBetweenIso(checkIn, checkOut) >= 1;
}