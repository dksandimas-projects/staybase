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
  | "nights-clamped"
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
  /**
   * Hard cap on stay length. Pass the output of
   * `resolveMaxStayNights` — `Infinity` means "no limit" and is
   * supported at every clamp site below (`n > Infinity` is never true,
   * and `min(Infinity, horizonNights)` correctly degrades to the
   * horizon). Do NOT pass the raw Firestore value: a literal `0` would
   * reach `Math.max(Math.min(0, horizon), 1)` and collapse every stay
   * to one night.
   */
  maxNights?: number;
  /**
   * Latest legal check-out (booking horizon). Defaults to
   * `minCheckIn + DEFAULT_BOOKING_HORIZON_DAYS` — deliberately NOT
   * `maxNights`, which is the stay-LENGTH cap (DR-03).
   */
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

// DR-03 (2026-10-15): how far AHEAD a guest may book. This is a
// DIFFERENT limit from `DEFAULT_MAX_STAY_NIGHTS` (how long a single
// stay may run). They were conflated, which made the calendar stop at
// 30 days out. Booking.com's horizon is ~a year; 365 days matches
// that and matches how far ahead a boutique hotel realistically sells.
export const DEFAULT_BOOKING_HORIZON_DAYS = 365;

// ---------------------------------------------------------------------------
// MSL-01 (2026-10-15): the stay-length cap becomes a per-hotel setting.
//
// The cap moves from a compile-time constant to
// `settings/hotelConfig.maxStayNights` so the hotel decides it from
// Settings instead of a code deploy. `resolveMaxStayNights` is the ONE
// place that Firestore value crosses into stay-length arithmetic, and it
// owns the whole mapping — including the two traps below, which is why
// no call site ever passes a raw setting straight through.
// ---------------------------------------------------------------------------

/** Bounds for the admin-editable cap. `0` (unlimited) bypasses them entirely. */
export const MIN_MAX_STAY_NIGHTS = 1;
/**
 * The effective cap is always `min(maxStayNights, horizonNights)` —
 * a stay longer than the 365-day horizon is unreachable by
 * construction, so capping the input at the horizon keeps the stored
 * value honest instead of letting the operator store a number the
 * horizon silently overrides.
 */
export const MAX_MAX_STAY_NIGHTS = DEFAULT_BOOKING_HORIZON_DAYS;

/**
 * Resolves the raw `settings/hotelConfig.maxStayNights` value into the
 * number the clamp sites use. Returns `Infinity` for "no limit".
 *
 * Four distinct inputs, four distinct answers — collapsing any pair of
 * them is the bug this function exists to prevent:
 *
 *   | Firestore value        | Result        | Why                                    |
 *   |------------------------|---------------|----------------------------------------|
 *   | absent / `null` / `""` | `30`          | legacy installs keep today's behavior  |
 *   | `0`                    | `Infinity`    | admin explicitly chose "no limit"      |
 *   | `0.5`                  | `1`           | floors, but MUST NOT floor to `0`      |
 *   | `NaN` / negative       | `30`          | hand-edited garbage — never fail OPEN  |
 *
 * The `0.5 -> 1` row is the subtle one. Flooring happens after the
 * `0` test, so a fractional value would floor to `0` and be read as
 * "unlimited" — inverting the admin's intent. The `floored < MIN`
 * guard runs last for exactly that reason.
 *
 * Note the absent-vs-zero asymmetry: `Number(undefined)` is `NaN`, so
 * a naive resolver would read every un-migrated install as unlimited
 * and quietly open every existing hotel to unbounded stays.
 */
export function resolveMaxStayNights(raw: unknown): number {
  // Absent / null / empty -> the historical default, NOT unlimited.
  if (raw === undefined || raw === null || raw === "") return DEFAULT_MAX_STAY_NIGHTS;

  const value = Number(raw);
  // Non-finite or negative = a hand-edited doc. Fail to the default,
  // never to unlimited — failing open here is the expensive direction.
  if (!Number.isFinite(value) || value < 0) return DEFAULT_MAX_STAY_NIGHTS;

  // Explicit zero is the admin's "no limit" choice. This is the ONLY
  // input that produces `Infinity`.
  if (value === 0) return Infinity;

  const floored = Math.floor(value);
  // Guards the fractional trap: `0.5` floors to `0` here, which would
  // otherwise re-enter as an unlimited cap.
  if (floored < MIN_MAX_STAY_NIGHTS) return MIN_MAX_STAY_NIGHTS;
  return Math.min(floored, MAX_MAX_STAY_NIGHTS);
}

/**
 * Human-readable cap for guest- and staff-facing copy. Returns
 * `"no maximum"` when unlimited so the server's 400 and the picker's
 * inline banner describe the same policy in the same words.
 */
export function describeMaxStayNights(maxNights: number): string {
  return Number.isFinite(maxNights) ? `${maxNights} nights` : "no maximum";
}

/**
 * True when the cap refuses nothing. Used to SKIP clamp messaging
 * entirely — an unlimited hotel should never render "a single stay
 * can run at most no maximum nights".
 */
export function isUnlimitedStay(maxNights: number): boolean {
  return !Number.isFinite(maxNights);
}

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
      : addDaysToIsoDate(
          today,
          DEFAULT_BOOKING_HORIZON_DAYS,
          addDaysToIsoDate(today, defaultNights, today)
        );

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

  // --- maximum stay length ---
  // The stay-length cap is INDEPENDENT of the booking horizon, and both
  // are enforced. A guest may legitimately book nine months out; what
  // they may not do is book a 90-night stay. Before DR-03 these were
  // the SAME number (`MAX_STAY_NIGHTS` doubling as the horizon), which
  // capped reachable dates at 30 days ahead — so December was
  // unreachable — while `stayCap` was applied ONLY on the inverted
  // branch above, letting a long-but-valid range through unchecked.
  //
  // Deliberately clamps to `maxNights`, NOT `stayCap`: `stayCap` is
  // `min(maxNights, horizonNights)`, so clamping to it would fold the
  // horizon back into this branch and every over-long range would
  // report `nights-clamped`, hiding which limit actually bound. The
  // horizon is applied as its own step immediately below, so each
  // limit gets its own honest reason.
  if (diffNightsBetweenIso(nextIn, checkOutCandidate) > maxNights) {
    checkOutCandidate = addDaysToIsoDate(nextIn, maxNights, addDaysToIsoDate(nextIn, 1, nextIn));
    adjustment = "nights-clamped";
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
// ---------------------------------------------------------------------------
// DR-02 (2026-10-15): range-calendar selection resolution.
//
// The range calendar replaces two independent date fields with one
// two-step selection. This resolver is deliberately PURE and
// separate from the component so the two-step contract — which is
// where the real bugs live — is unit-testable without a DOM.
// ---------------------------------------------------------------------------

export type StaySelection =
  /** First click landed. Check-in is chosen; check-out still pending. */
  | { status: "pending"; checkIn: string }
  /** Both clicks landed and the range is bookable. */
  | { status: "complete"; checkIn: string; checkOut: string; nights: number }
  /** Nothing selected (the guest cleared the range). */
  | { status: "cleared" };

export interface ResolveRangeSelectionOptions {
  /** Check-in picked in the calendar (ISO key, may be invalid or absent). */
  from?: string | null;
  /** Check-out picked in the calendar (ISO key, may be invalid or absent). */
  to?: string | null;
  /** Earliest legal check-in, property timezone. */
  minCheckIn: string;
  /** Latest legal check-out (the booking horizon). */
  maxCheckOut: string;
  /**
   * Longest stay the guest may book. Defaults to
   * `DEFAULT_MAX_STAY_NIGHTS`; `Infinity` disables the length cap
   * entirely (the horizon below still applies). Same resolve-first
   * contract as `normalizeStayRange`'s `maxNights`.
   */
  maxNights?: number;
}

/**
 * Turns a raw calendar selection into a booking decision.
 *
 * The non-obvious rule, and the one that caused a real bug: a
 * calendar's range mode reports the FIRST click of a brand-new
 * selection as `{ from: day, to: day }` — same day, NOT `to:
 * undefined`. Treating any `to` as "complete" therefore committed a
 * 1-night range on a single click. That commit fires an availability
 * refetch, which swaps the booking page for a full-page loader and
 * unmounts the picker, silently discarding the half-made selection.
 * A same-day pair is therefore ALWAYS "pending", never "complete".
 */
export function resolveRangeSelection({
  from,
  to,
  minCheckIn,
  maxCheckOut,
  maxNights = DEFAULT_MAX_STAY_NIGHTS
}: ResolveRangeSelectionOptions): StaySelection {
  if (!isValidIsoDate(from ?? "")) return { status: "cleared" };

  const checkIn = (from as string) < minCheckIn ? minCheckIn : (from as string);

  if (!isValidIsoDate(to ?? "")) return { status: "pending", checkIn };

  const checkOut = to as string;

  // Same day is a single click, not a zero-night stay. Never complete.
  if (checkOut === checkIn) return { status: "pending", checkIn };

  // A range that runs backwards means the guest clicked a day at or
  // before the check-in — that starts a NEW selection, it does not
  // invert the current one.
  if (checkOut < checkIn) return { status: "pending", checkIn };

  const clampedCheckIn = checkIn < minCheckIn ? minCheckIn : checkIn;
  const nights = diffNightsBetweenIso(clampedCheckIn, checkOut);
  if (nights < 1) return { status: "pending", checkIn: clampedCheckIn };
  if (checkOut > maxCheckOut) return { status: "pending", checkIn: clampedCheckIn };
  // DR-03: the stay LENGTH cap is independent of the horizon. Widening
  // the horizon to a year must not also allow a 200-night booking.
  if (nights > maxNights) return { status: "pending", checkIn: clampedCheckIn };

  return { status: "complete", checkIn: clampedCheckIn, checkOut, nights };
}
