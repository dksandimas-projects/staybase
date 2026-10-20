export type DateLike = Date | { toDate: () => unknown } | { _seconds: number; _nanoseconds: number } | string | number | null | undefined;

export function toDateOrNow(value: DateLike): Date {
  const d = toDateOrNull(value);
  return d ?? new Date();
}

export function toDateOrNull(value: DateLike): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    const result = (value as { toDate: () => unknown }).toDate();
    if (result instanceof Date) return new Date(result.getTime());
    if (result && typeof (result as { toDate?: unknown }).toDate === "function") {
      const nested = (result as { toDate: () => unknown }).toDate();
      if (nested instanceof Date) return new Date(nested.getTime());
    }
    if (typeof value === "object" && value !== null) {
      const obj = value as { _seconds?: number; _nanoseconds?: number };
      if (typeof obj._seconds === "number") {
        const ms = obj._seconds * 1000 + Math.floor((obj._nanoseconds ?? 0) / 1_000_000);
        return new Date(ms);
      }
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as { _seconds?: number; _nanoseconds?: number };
    if (typeof obj._seconds === "number") {
      const ms = obj._seconds * 1000 + Math.floor((obj._nanoseconds ?? 0) / 1_000_000);
      return new Date(ms);
    }
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Per OCT-M5 (2026-10-20, decision #292): the UTC calendar-date
 * key (`YYYY-MM-DD`) of a booking date field.
 *
 * The other add-on cut-off helper
 * (`computeOtherAddOnCutoffState`) anchors the cut-off at
 * `${checkInDate}T00:00:00Z` — UTC midnight — so the date key it
 * consumes MUST be the UTC calendar date of the booking's
 * check-in. The Manage Add-Ons page already derived that key
 * inline (a local `isIsoDate` + a `toDate()` + a UTC Y/M/D
 * format); the two WRITE paths had no derivation at all, which
 * is why the lock slid forward one day per service date (the
 * per-date key was used as the "check-in" anchor instead of the
 * booking's real check-in).
 *
 * This helper is the ONE derivation, so the read path, the two
 * write paths and the admin drawer all agree on the anchor.
 *
 * @param value A booking date field — a Firestore Timestamp, a
 *   `Date`, an ISO string, or `null`.
 * @returns The `YYYY-MM-DD` UTC key, or `""` when the value is
 *   missing or unparseable.
 */
export function toUtcDateKey(value: DateLike): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  const date = toDateOrNull(value);
  if (!date) return "";
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Per BF-42 (booking-flow audit 2026-06-26): the
// `getManilaDateInfo()` helper was duplicated in
// `bookings.ts`, `store.ts`, `corporate-inquiries.ts`,
// `email.ts`, and `reference.ts`. Single source of truth lives
// here. Returns today's date in the property's configured
// timezone (default "Asia/Manila" — see hotel.config.ts:
// `timezone: "Asia/Manila"`).
export interface ManilaDateInfo {
  /** Today's date in the property's timezone, formatted as `YYYY-MM-DD`. */
  todayStr: string;
  /** Today's date in the property's timezone, formatted as `YYYYMMDD`. */
  todayCompact: string;
  /** A `Date` object representing today's date in the property's timezone (at 00:00 local). */
  manilaDate: Date;
}

export function getManilaDateInfo(timezone: string = "Asia/Manila"): ManilaDateInfo {
  const now = new Date();
  // The `toLocaleString` trick converts `now` (UTC) into the
  // property's local wall-clock string, then `new Date(...)`
  // parses that string as a Date anchored in the local
  // timezone. This is the same approach the previous
  // inlined copies used.
  const localString = now.toLocaleString("en-US", { timeZone: timezone });
  const localDate = new Date(localString);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");
  return {
    todayStr: `${year}-${month}-${day}`,
    todayCompact: `${year}${month}${day}`,
    manilaDate: localDate
  };
}

export function getDateKeyInTimezone(timezone: string = "Asia/Manila", offsetDays = 0): string {
  const { manilaDate } = getManilaDateInfo(timezone);
  const date = new Date(manilaDate);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
